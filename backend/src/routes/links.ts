/**
 * Link Management Routes
 *
 * Handles creation and lookup of user links (kage.ink/username).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { config } from '../config/index.js'

// Validation schemas
const createLinkSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_-]+$/, 'Slug must be lowercase alphanumeric with - or _'),
  label: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  walletId: z.string().uuid(),
})

const updateLinkSchema = z.object({
  label: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
})

// Reserved slugs that cannot be used
const RESERVED_SLUGS = [
  'api',
  'admin',
  'app',
  'dashboard',
  'login',
  'logout',
  'signup',
  'settings',
  'help',
  'support',
  'about',
  'terms',
  'privacy',
  'contact',
]

export async function linkRoutes(app: FastifyInstance) {
  /**
   * POST /api/links/create
   * Create a new link
   */
  app.post('/create', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const parsed = createLinkSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Check reserved slugs
      if (RESERVED_SLUGS.includes(body.slug.toLowerCase())) {
        return reply.status(400).send({
          success: false,
          error: 'This username is reserved',
        })
      }

      // Check if slug is taken
      const existing = await prisma.userLink.findUnique({
        where: { slug: body.slug.toLowerCase() },
      })

      if (existing) {
        return reply.status(400).send({
          success: false,
          error: 'This username is already taken',
        })
      }

      // Verify wallet belongs to user and has stealth keys
      const wallet = await prisma.userWallet.findFirst({
        where: {
          id: body.walletId,
          userId,
        },
      })

      if (!wallet) {
        return reply.status(400).send({
          success: false,
          error: 'Wallet not found',
        })
      }

      if (!wallet.metaSpendPub || !wallet.metaViewPub) {
        return reply.status(400).send({
          success: false,
          error: 'Wallet does not have stealth keys registered. Please register stealth keys first.',
        })
      }

      // Create link
      const link = await prisma.userLink.create({
        data: {
          slug: body.slug.toLowerCase(),
          label: body.label,
          description: body.description,
          userId,
          walletId: body.walletId,
        },
        include: {
          wallet: {
            select: {
              metaSpendPub: true,
              metaViewPub: true,
            },
          },
        },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'LINK_CREATED',
          userId,
          metadata: { slug: body.slug, linkId: link.id },
        },
      })

      return reply.status(201).send({
        success: true,
        link: {
          id: link.id,
          slug: link.slug,
          label: link.label,
          fullUrl: `${config.appUrl}/${link.slug}`,
          metaSpendPub: link.wallet.metaSpendPub,
          metaViewPub: link.wallet.metaViewPub,
        },
      })
    } catch (error) {
      console.error('Create link error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to create link',
      })
    }
  })

  /**
   * GET /api/links/check/:slug
   * Check if a slug is available
   */
  app.get('/check/:slug', async (request, reply) => {
    try {
      const params = request.params as { slug: string }
      const normalizedSlug = params.slug.toLowerCase()

      // Check reserved
      if (RESERVED_SLUGS.includes(normalizedSlug)) {
        return reply.send({
          success: true,
          available: false,
          reason: 'reserved',
        })
      }

      // Check exists
      const existing = await prisma.userLink.findUnique({
        where: { slug: normalizedSlug },
      })

      return reply.send({
        success: true,
        available: !existing,
        reason: existing ? 'taken' : null,
      })
    } catch (error) {
      console.error('Check slug error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to check slug',
      })
    }
  })

  /**
   * GET /api/links/my-links
   * Get all links for authenticated user
   */
  app.get('/my-links', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }

      const links = await prisma.userLink.findMany({
        where: { userId },
        include: {
          wallet: {
            select: {
              address: true,
              chain: true,
              metaSpendPub: true,
              metaViewPub: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send({
        success: true,
        links: links.map((link) => ({
          id: link.id,
          slug: link.slug,
          label: link.label,
          description: link.description,
          fullUrl: `${config.appUrl}/${link.slug}`,
          isActive: link.isActive,
          positionsReceived: link.positionsReceived,
          wallet: link.wallet,
          createdAt: link.createdAt,
        })),
      })
    } catch (error) {
      console.error('Get my links error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch links',
      })
    }
  })

  /**
   * GET /api/links/:slug
   * Public endpoint - get meta-address for a link
   */
  app.get('/:slug', async (request, reply) => {
    try {
      const params = request.params as { slug: string }

      // Skip if it's a reserved route
      if (['check', 'my-links', 'create'].includes(params.slug)) {
        return reply.status(404).send({
          success: false,
          error: 'Link not found',
        })
      }

      const link = await prisma.userLink.findUnique({
        where: { slug: params.slug.toLowerCase() },
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
          error: 'Link not found',
        })
      }

      if (!link.wallet.metaSpendPub || !link.wallet.metaViewPub) {
        return reply.status(400).send({
          success: false,
          error: 'Link does not have valid stealth keys',
        })
      }

      return reply.send({
        success: true,
        metaAddress: {
          metaSpendPub: link.wallet.metaSpendPub,
          metaViewPub: link.wallet.metaViewPub,
        },
        label: link.label,
      })
    } catch (error) {
      console.error('Get link error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch link',
      })
    }
  })

  /**
   * PUT /api/links/:linkId/update
   * Update link settings
   */
  app.put('/:linkId/update', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const params = request.params as { linkId: string }
      const parsed = updateLinkSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify link belongs to user
      const link = await prisma.userLink.findFirst({
        where: { id: params.linkId, userId },
      })

      if (!link) {
        return reply.status(404).send({
          success: false,
          error: 'Link not found',
        })
      }

      // Update link
      const updated = await prisma.userLink.update({
        where: { id: params.linkId },
        data: {
          label: body.label ?? link.label,
          description: body.description ?? link.description,
          isActive: body.isActive ?? link.isActive,
        },
      })

      return reply.send({
        success: true,
        link: updated,
      })
    } catch (error) {
      console.error('Update link error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to update link',
      })
    }
  })

  /**
   * DELETE /api/links/:linkId
   * Deactivate a link (soft delete)
   */
  app.delete('/:linkId', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const params = request.params as { linkId: string }

      // Verify link belongs to user
      const link = await prisma.userLink.findFirst({
        where: { id: params.linkId, userId },
      })

      if (!link) {
        return reply.status(404).send({
          success: false,
          error: 'Link not found',
        })
      }

      // Soft delete (deactivate)
      await prisma.userLink.update({
        where: { id: params.linkId },
        data: { isActive: false },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'LINK_DEACTIVATED',
          userId,
          metadata: { slug: link.slug, linkId: params.linkId },
        },
      })

      return reply.send({
        success: true,
        message: 'Link deactivated',
      })
    } catch (error) {
      console.error('Delete link error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to delete link',
      })
    }
  })
}
