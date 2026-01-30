/**
 * Organization Routes
 *
 * Handles organization management and linking on-chain orgs to user accounts.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getUserRole, isOrganizationAdmin } from '../utils/roles.js'

// Validation schemas
const linkOrganizationSchema = z.object({
  pubkey: z.string().min(32).max(44), // Organization PDA
  adminWallet: z.string().min(32).max(44),
  nameHash: z.string(), // Hex encoded
  tokenMint: z.string().min(32).max(44),
  treasury: z.string().min(32).max(44),
})

const lookupEmployeeSchema = z.object({
  slug: z.string().min(3).max(30), // Link slug (e.g., "alice")
})

export async function organizationRoutes(app: FastifyInstance) {
  /**
   * POST /api/organizations/link
   * Link an on-chain organization to user account
   */
  app.post('/link', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }
      const parsed = linkOrganizationSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify the connected wallet is the admin
      if (body.adminWallet !== walletAddress) {
        return reply.status(403).send({
          success: false,
          error: 'Connected wallet is not the organization admin',
        })
      }

      // Check if organization already exists
      const existing = await prisma.organization.findUnique({
        where: { pubkey: body.pubkey },
      })

      if (existing) {
        // Update if same admin
        if (existing.adminWallet === walletAddress) {
          const updated = await prisma.organization.update({
            where: { pubkey: body.pubkey },
            data: {
              adminUserId: userId,
              nameHash: body.nameHash,
              tokenMint: body.tokenMint,
              treasury: body.treasury,
            },
          })
          return reply.send({
            success: true,
            organization: updated,
            message: 'Organization updated',
          })
        } else {
          return reply.status(403).send({
            success: false,
            error: 'Organization belongs to different admin',
          })
        }
      }

      // Create new organization record
      const organization = await prisma.organization.create({
        data: {
          pubkey: body.pubkey,
          adminWallet: body.adminWallet,
          adminUserId: userId,
          nameHash: body.nameHash,
          tokenMint: body.tokenMint,
          treasury: body.treasury,
          isActive: true,
        },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'ORGANIZATION_LINKED',
          userId,
          walletAddress,
          metadata: { organizationPubkey: body.pubkey },
        },
      })

      return reply.status(201).send({
        success: true,
        organization,
      })
    } catch (error) {
      console.error('Link organization error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to link organization',
      })
    }
  })

  /**
   * GET /api/organizations/mine
   * Get organization where user is admin
   */
  app.get('/mine', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }

      const organization = await prisma.organization.findFirst({
        where: { adminUserId: userId },
        include: {
          schedules: true,
          _count: {
            select: { positions: true },
          },
        },
      })

      if (!organization) {
        return reply.send({
          success: true,
          organization: null,
          message: 'No organization found. Create one on-chain first.',
        })
      }

      return reply.send({
        success: true,
        organization: {
          ...organization,
          positionCount: organization._count.positions,
        },
      })
    } catch (error) {
      console.error('Get my organization error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch organization',
      })
    }
  })

  /**
   * GET /api/organizations/role
   * Get current user's role (admin/employee/both/none)
   */
  app.get('/role', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const roleInfo = await getUserRole(userId)

      return reply.send({
        success: true,
        ...roleInfo,
      })
    } catch (error) {
      console.error('Get role error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to get role',
      })
    }
  })

  /**
   * POST /api/organizations/lookup-employee
   * Lookup employee by link slug (for creating positions)
   */
  app.post('/lookup-employee', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const parsed = lookupEmployeeSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify user is an admin
      const roleInfo = await getUserRole(userId)
      if (!roleInfo.isAdmin) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization admins can lookup employees',
        })
      }

      // Find link
      const link = await prisma.userLink.findUnique({
        where: { slug: body.slug.toLowerCase() },
        include: {
          wallet: {
            select: {
              metaSpendPub: true,
              metaViewPub: true,
            },
          },
        },
      })

      if (!link || !link.isActive) {
        return reply.status(404).send({
          success: false,
          error: 'Employee link not found',
        })
      }

      if (!link.wallet.metaSpendPub || !link.wallet.metaViewPub) {
        return reply.status(400).send({
          success: false,
          error: 'Employee has not set up stealth keys',
        })
      }

      return reply.send({
        success: true,
        employee: {
          slug: link.slug,
          label: link.label,
          metaAddress: {
            metaSpendPub: link.wallet.metaSpendPub,
            metaViewPub: link.wallet.metaViewPub,
          },
        },
      })
    } catch (error) {
      console.error('Lookup employee error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to lookup employee',
      })
    }
  })

  /**
   * GET /api/organizations/:pubkey/employees
   * Get all employees that have received positions from this org
   */
  app.get('/:pubkey/employees', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const params = request.params as { pubkey: string }

      // Verify user is admin of this organization
      const isAdmin = await isOrganizationAdmin(userId, params.pubkey)
      if (!isAdmin) {
        return reply.status(403).send({
          success: false,
          error: 'Not authorized to view this organization',
        })
      }

      // Get positions with resolved owners
      const positions = await prisma.vestingPosition.findMany({
        where: {
          organization: { pubkey: params.pubkey },
          ownerLinkId: { not: null },
        },
        include: {
          schedule: true,
        },
        distinct: ['ownerLinkId'],
      })

      // Get link details for each position
      const linkIds = positions
        .map((p) => p.ownerLinkId)
        .filter((id): id is string => id !== null)

      const links = await prisma.userLink.findMany({
        where: { id: { in: linkIds } },
        select: {
          id: true,
          slug: true,
          label: true,
          positionsReceived: true,
        },
      })

      return reply.send({
        success: true,
        employees: links,
        totalPositions: positions.length,
      })
    } catch (error) {
      console.error('Get employees error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch employees',
      })
    }
  })
}
