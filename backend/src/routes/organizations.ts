/**
 * Organization Routes
 *
 * Handles organization management and linking on-chain orgs to user accounts.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getUserRole, isOrganizationAdmin } from '../utils/roles.js'
import {
  getConnection,
  createProvider,
  getProgram,
  findSchedulePda,
  findPositionPda,
  findSignPda,
  createBeneficiaryCommitment,
  encryptAmount,
  fetchOrganization as fetchOrgOnChain,
  fetchPosition as fetchPositionOnChain,
  fetchSchedule as fetchScheduleOnChain,
  calculateVestingProgress,
  prepareClaimData,
} from '../lib/solana.js'
import { PublicKey, Keypair } from '@solana/web3.js'
import BN from 'bn.js'
import {
  getCompDefAccOffset,
  getArciumProgramId,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
} from '@arcium-hq/client'
import { randomBytes } from 'crypto'
import { config } from '../config/index.js'

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

const createScheduleSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  scheduleIndex: z.number().int().min(0),
  cliffDuration: z.number().int().min(0), // seconds
  totalDuration: z.number().int().min(1), // seconds
  vestingInterval: z.number().int().min(1), // seconds
})

const createPositionSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  scheduleId: z.string().min(1), // Can be UUID or schedule pubkey
  employeeSlug: z.string().min(3).max(30),
  amount: z.string(), // String to handle large numbers
  tokenSymbol: z.string().optional(), // For display purposes
})

const preparePositionOnChainSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  scheduleIndex: z.number().int().min(0),
  employeeSlug: z.string().min(3).max(30),
  amount: z.string(), // String to handle large numbers (in base units, e.g., lamports)
})

const getVestingProgressSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  positionId: z.number().int().min(0),
})

const prepareClaimSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  positionId: z.number().int().min(0),
  claimAmount: z.string(), // String to handle large numbers
  nullifier: z.string(), // Hex-encoded 32-byte nullifier
})

// Arcium cluster offset from env
const ARCIUM_CLUSTER_OFFSET = parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '456', 10)

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

  /**
   * POST /api/organizations/schedules/create
   * Create a vesting schedule (MVP: database only, no on-chain)
   */
  app.post('/schedules/create', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }
      const parsed = createScheduleSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Find organization and verify admin
      const organization = await prisma.organization.findUnique({
        where: { pubkey: body.organizationPubkey },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      if (organization.adminWallet !== walletAddress) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization admin can create schedules',
        })
      }

      // Generate a mock PDA for MVP (in production, this would be the on-chain PDA)
      const schedulePubkey = `schedule_${body.organizationPubkey.slice(0, 8)}_${body.scheduleIndex}`

      // Create schedule in database
      const schedule = await prisma.vestingSchedule.create({
        data: {
          pubkey: schedulePubkey,
          organizationId: organization.id,
          scheduleIndex: body.scheduleIndex,
          cliffDuration: BigInt(body.cliffDuration),
          totalDuration: BigInt(body.totalDuration),
          vestingInterval: BigInt(body.vestingInterval),
        },
      })

      // Update organization schedule count
      await prisma.organization.update({
        where: { id: organization.id },
        data: { scheduleCount: { increment: 1 } },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'SCHEDULE_CREATED',
          userId,
          walletAddress,
          metadata: {
            organizationPubkey: body.organizationPubkey,
            scheduleIndex: body.scheduleIndex,
          },
        },
      })

      return reply.status(201).send({
        success: true,
        schedule: {
          id: schedule.id,
          pubkey: schedule.pubkey,
          scheduleIndex: schedule.scheduleIndex,
          cliffDuration: schedule.cliffDuration.toString(),
          totalDuration: schedule.totalDuration.toString(),
          vestingInterval: schedule.vestingInterval.toString(),
        },
      })
    } catch (error) {
      console.error('Create schedule error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to create schedule',
      })
    }
  })

  /**
   * GET /api/organizations/:pubkey/schedules
   * Get all schedules for an organization
   */
  app.get('/:pubkey/schedules', { preHandler: [app.authenticate] }, async (request, reply) => {
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

      const organization = await prisma.organization.findUnique({
        where: { pubkey: params.pubkey },
        include: { schedules: true },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      return reply.send({
        success: true,
        schedules: organization.schedules.map((s) => ({
          id: s.id,
          pubkey: s.pubkey,
          scheduleIndex: s.scheduleIndex,
          cliffDuration: s.cliffDuration.toString(),
          totalDuration: s.totalDuration.toString(),
          vestingInterval: s.vestingInterval.toString(),
        })),
      })
    } catch (error) {
      console.error('Get schedules error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch schedules',
      })
    }
  })

  /**
   * POST /api/organizations/positions/create
   * Create a vesting position (MVP: database only, no on-chain)
   */
  app.post('/positions/create', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }
      const parsed = createPositionSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Find organization and verify admin
      const organization = await prisma.organization.findUnique({
        where: { pubkey: body.organizationPubkey },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      if (organization.adminWallet !== walletAddress) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization admin can create positions',
        })
      }

      // Find schedule - try by UUID first, then by pubkey
      let schedule = await prisma.vestingSchedule.findUnique({
        where: { id: body.scheduleId },
      })

      // If not found by UUID, try by pubkey (for on-chain schedules)
      if (!schedule) {
        schedule = await prisma.vestingSchedule.findUnique({
          where: { pubkey: body.scheduleId },
        })
      }

      // If still not found, create a placeholder for the on-chain schedule
      if (!schedule) {
        // This is an on-chain schedule not yet in our database
        // Create a placeholder entry
        schedule = await prisma.vestingSchedule.create({
          data: {
            pubkey: body.scheduleId,
            organizationId: organization.id,
            scheduleIndex: 0, // Will be updated when synced
            cliffDuration: BigInt(0),
            totalDuration: BigInt(0),
            vestingInterval: BigInt(0),
          },
        })
      }

      if (schedule.organizationId !== organization.id) {
        return reply.status(404).send({
          success: false,
          error: 'Schedule not found for this organization',
        })
      }

      // Find employee link
      const link = await prisma.userLink.findUnique({
        where: { slug: body.employeeSlug.toLowerCase() },
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

      // Generate mock stealth data for MVP
      const positionIndex = organization.positionCount
      const positionPubkey = `position_${body.organizationPubkey.slice(0, 8)}_${positionIndex}`
      const stealthOwner = `stealth_${link.wallet.metaSpendPub.slice(0, 16)}`
      const ephemeralPub = `ephemeral_${Date.now()}`

      // Create position in database
      const position = await prisma.vestingPosition.create({
        data: {
          pubkey: positionPubkey,
          organizationId: organization.id,
          scheduleId: schedule.id,
          stealthOwner,
          ephemeralPub,
          ownerLinkId: link.id,
          startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
          isActive: true,
        },
      })

      // Update counts
      await prisma.organization.update({
        where: { id: organization.id },
        data: { positionCount: { increment: 1 } },
      })

      await prisma.userLink.update({
        where: { id: link.id },
        data: { positionsReceived: { increment: 1 } },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'POSITION_CREATED',
          userId,
          walletAddress,
          metadata: {
            organizationPubkey: body.organizationPubkey,
            scheduleId: body.scheduleId,
            employeeSlug: body.employeeSlug,
            amount: body.amount,
            tokenSymbol: body.tokenSymbol,
          },
        },
      })

      return reply.status(201).send({
        success: true,
        position: {
          id: position.id,
          pubkey: position.pubkey,
          scheduleId: position.scheduleId,
          employeeSlug: body.employeeSlug,
          amount: body.amount,
          tokenSymbol: body.tokenSymbol,
          startTimestamp: position.startTimestamp.toString(),
        },
      })
    } catch (error) {
      console.error('Create position error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to create position',
      })
    }
  })

  /**
   * POST /api/organizations/positions/prepare-onchain
   * Prepare encrypted data for on-chain position creation with Arcium MPC
   * Returns all data needed for frontend to build and sign the transaction
   */
  app.post('/positions/prepare-onchain', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }
      const parsed = preparePositionOnChainSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify organization exists in our database
      const organization = await prisma.organization.findUnique({
        where: { pubkey: body.organizationPubkey },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      if (organization.adminWallet !== walletAddress) {
        return reply.status(403).send({
          success: false,
          error: 'Only organization admin can create positions',
        })
      }

      // Find employee link and get meta-address
      const link = await prisma.userLink.findUnique({
        where: { slug: body.employeeSlug.toLowerCase() },
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

      // Fetch on-chain organization to get position count
      const orgOnChain = await fetchOrgOnChain(body.organizationPubkey)
      if (!orgOnChain) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found on-chain',
        })
      }

      const positionId = orgOnChain.positionCount.toNumber()
      const programId = new PublicKey(config.shadowvestProgramId)
      const organizationPk = new PublicKey(body.organizationPubkey)

      // Derive PDAs
      const [positionPda] = findPositionPda(organizationPk, positionId)
      const [schedulePda] = findSchedulePda(organizationPk, body.scheduleIndex)
      const [signPda] = findSignPda()

      // Create beneficiary commitment from meta-address
      const beneficiaryCommitment = createBeneficiaryCommitment(
        link.wallet.metaSpendPub,
        link.wallet.metaViewPub
      )

      // Encrypt amount using Arcium MPC (this is why we need Node.js backend)
      const dummyKeypair = Keypair.generate()
      const prov = createProvider(dummyKeypair)
      const amountBigInt = BigInt(body.amount)
      const encrypted = await encryptAmount(prov, amountBigInt)

      // Generate computation offset
      const computationOffsetBytes = randomBytes(8)
      const computationOffset = new BN(computationOffsetBytes)

      // Build Arcium account addresses
      const arciumAccounts = {
        mxeAccount: getMXEAccAddress(programId).toBase58(),
        mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
        executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
        computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset).toBase58(),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset('init_position')).readUInt32LE()
        ).toBase58(),
        clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET).toBase58(),
        poolAccount: getFeePoolAccAddress().toBase58(),
        clockAccount: getClockAccAddress().toBase58(),
        arciumProgram: getArciumProgramId().toBase58(),
      }

      // Log for debugging
      console.log('Preparing on-chain position creation:')
      console.log('  Organization:', body.organizationPubkey)
      console.log('  Schedule Index:', body.scheduleIndex)
      console.log('  Position ID:', positionId)
      console.log('  Amount:', body.amount)
      console.log('  Employee:', body.employeeSlug)

      // Return all data needed for frontend to build transaction
      return reply.send({
        success: true,
        data: {
          // Position info
          positionId,
          positionPda: positionPda.toBase58(),
          schedulePda: schedulePda.toBase58(),
          signPda: signPda.toBase58(),

          // Encrypted data (Arcium MPC)
          beneficiaryCommitment: Array.from(beneficiaryCommitment),
          encryptedAmount: Array.from(encrypted.ciphertext),
          clientPubkey: Array.from(encrypted.publicKey),
          nonce: encrypted.nonce.toString(),
          computationOffset: computationOffset.toString(),

          // Arcium accounts
          arciumAccounts,

          // Program info
          programId: programId.toBase58(),
        },
      })
    } catch (error) {
      console.error('Prepare position on-chain error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare position',
      })
    }
  })

  /**
   * GET /api/organizations/:pubkey/positions
   * Get all positions for an organization
   */
  app.get('/:pubkey/positions', { preHandler: [app.authenticate] }, async (request, reply) => {
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

      const organization = await prisma.organization.findUnique({
        where: { pubkey: params.pubkey },
        include: {
          positions: {
            include: {
              schedule: true,
            },
          },
        },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      // Get link info for each position
      const linkIds = organization.positions
        .map((p) => p.ownerLinkId)
        .filter((id): id is string => id !== null)

      const links = await prisma.userLink.findMany({
        where: { id: { in: linkIds } },
        select: { id: true, slug: true, label: true },
      })

      const linkMap = new Map(links.map((l) => [l.id, l]))

      return reply.send({
        success: true,
        positions: organization.positions.map((p) => {
          const ownerLink = p.ownerLinkId ? linkMap.get(p.ownerLinkId) : null
          return {
            id: p.id,
            pubkey: p.pubkey,
            scheduleIndex: p.schedule.scheduleIndex,
            employee: ownerLink ? {
              slug: ownerLink.slug,
              label: ownerLink.label,
            } : null,
            startTimestamp: p.startTimestamp.toString(),
            isActive: p.isActive,
          }
        }),
      })
    } catch (error) {
      console.error('Get positions error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch positions',
      })
    }
  })

  /**
   * POST /api/organizations/vesting-progress
   * Get vesting progress for a position (from on-chain data)
   */
  app.post('/vesting-progress', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const parsed = getVestingProgressSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Fetch position from chain
      const position = await fetchPositionOnChain(body.organizationPubkey, body.positionId)
      if (!position) {
        return reply.status(404).send({
          success: false,
          error: 'Position not found on-chain',
        })
      }

      // Fetch organization to find the schedule
      const org = await fetchOrgOnChain(body.organizationPubkey)
      if (!org) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found on-chain',
        })
      }

      // Find the schedule that this position belongs to
      let schedule = null
      for (let i = 0; i < org.scheduleCount.toNumber(); i++) {
        const [schedulePda] = findSchedulePda(new PublicKey(body.organizationPubkey), i)
        if (schedulePda.equals(position.schedule)) {
          schedule = await fetchScheduleOnChain(body.organizationPubkey, i)
          break
        }
      }

      if (!schedule) {
        return reply.status(404).send({
          success: false,
          error: 'Schedule not found on-chain',
        })
      }

      // Calculate vesting progress
      const progress = calculateVestingProgress(position, schedule)

      return reply.send({
        success: true,
        progress: {
          ...progress,
          // Convert timestamps to ISO strings for better frontend handling
          startDate: new Date(progress.startTimestamp * 1000).toISOString(),
          cliffEndDate: new Date(progress.cliffEndTime * 1000).toISOString(),
          vestingEndDate: new Date(progress.vestingEndTime * 1000).toISOString(),
        },
      })
    } catch (error) {
      console.error('Get vesting progress error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get vesting progress',
      })
    }
  })

  /**
   * POST /api/organizations/claims/prepare
   * Prepare data for claim transaction (Arcium MPC encryption)
   * Returns all data needed for frontend to build authorize_claim + queue_process_claim
   */
  app.post('/claims/prepare', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const parsed = prepareClaimSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Convert nullifier from hex string to Buffer
      const nullifier = Buffer.from(body.nullifier, 'hex')
      if (nullifier.length !== 32) {
        return reply.status(400).send({
          success: false,
          error: 'Nullifier must be 32 bytes (64 hex characters)',
        })
      }

      // Prepare claim data with MPC encryption
      const claimData = await prepareClaimData(
        body.organizationPubkey,
        body.positionId,
        BigInt(body.claimAmount),
        nullifier
      )

      return reply.send({
        success: true,
        data: claimData,
      })
    } catch (error) {
      console.error('Prepare claim error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare claim',
      })
    }
  })
}
