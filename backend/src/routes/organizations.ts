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
import bs58 from 'bs58'
import { config } from '../config/index.js'
import {
  generateEphemeralKeypair,
  deriveStealthPub,
  encryptNote,
} from '../lib/stealth.js'

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
  isCompressed: z.boolean().optional().default(false),
})

const queueProcessClaimSchema = z.object({
  organizationPubkey: z.string().min(32).max(44),
  positionId: z.number().int().min(0),
  claimAuthPda: z.string().min(32).max(44),
  isCompressed: z.boolean().default(false),
  nullifier: z.array(z.number()).length(32), // 32-byte array
  destinationTokenAccount: z.string().min(32).max(44),
  claimAmount: z.string(), // Amount to claim (string for large numbers)
  beneficiaryCommitment: z.array(z.number()).length(32), // 32-byte commitment for scratch position
  scheduleIndex: z.number().int().min(0).optional(),
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

      // Generate real stealth data
      const positionIndex = organization.positionCount
      const positionPubkey = `position_${body.organizationPubkey.slice(0, 8)}_${positionIndex}`

      // Generate ephemeral keypair for this payment
      const { ephemeralPriv, ephemeralPub } = await generateEphemeralKeypair()

      // Derive stealth address from employee's meta-address
      const stealthOwnerPubkey = await deriveStealthPub(
        link.wallet.metaSpendPub!,
        link.wallet.metaViewPub!,
        ephemeralPriv
      )
      const stealthOwner = stealthOwnerPubkey.toBase58()

      // Encrypt the ephemeral private key for the employee
      // They will decrypt this using their metaViewPriv to derive their stealth private key
      const ephemeralPrivHex = Buffer.from(ephemeralPriv).toString('hex')
      const encryptedEphemeralPayload = await encryptNote(
        ephemeralPrivHex,
        ephemeralPriv,
        link.wallet.metaViewPub!
      )

      console.log('Creating position with stealth data:')
      console.log('  Ephemeral Pubkey:', ephemeralPub)
      console.log('  Stealth Owner:', stealthOwner)
      console.log('  Encrypted Payload Length:', encryptedEphemeralPayload.length)

      // Create position in database
      const position = await prisma.vestingPosition.create({
        data: {
          pubkey: positionPubkey,
          organizationId: organization.id,
          scheduleId: schedule.id,
          positionId: positionIndex, // Important: set the position ID for lookups
          stealthOwner,
          ephemeralPub,
          encryptedEphemeralPayload,
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

      // Generate ephemeral keypair for stealth address
      const { ephemeralPriv, ephemeralPub } = await generateEphemeralKeypair()

      // Derive stealth address for this position
      const stealthPub = await deriveStealthPub(
        link.wallet.metaSpendPub,
        link.wallet.metaViewPub,
        ephemeralPriv
      )

      // Beneficiary commitment is the stealth address (not the raw metaSpendPub)
      // This is what the signer's public key must match during claim verification
      const beneficiaryCommitment = Buffer.from(stealthPub.toBytes())

      // Encrypt the ephemeral private key for the employee
      // The employee will decrypt this using their view key to derive the stealth keypair
      const encryptedEphemeralPayload = await encryptNote(
        Buffer.from(ephemeralPriv).toString('hex'),
        ephemeralPriv,
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
      console.log('  Stealth Address:', stealthPub.toBase58())
      console.log('  Ephemeral Pubkey:', ephemeralPub)

      // Find or create schedule record in database
      let schedule = await prisma.vestingSchedule.findFirst({
        where: {
          organizationId: organization.id,
          scheduleIndex: body.scheduleIndex,
        },
      })

      if (!schedule) {
        // Create a placeholder schedule record
        schedule = await prisma.vestingSchedule.create({
          data: {
            pubkey: schedulePda.toBase58(),
            organizationId: organization.id,
            scheduleIndex: body.scheduleIndex,
            cliffDuration: BigInt(0), // Will be synced from chain
            totalDuration: BigInt(0),
            vestingInterval: BigInt(0),
          },
        })
      }

      // Create or update position record in database with stealth data
      // Using upsert to handle retries after failed on-chain transactions
      console.log('Creating/updating database record:')
      console.log('  pubkey:', positionPda.toBase58())
      console.log('  positionId:', positionId)
      console.log('  ephemeralPub:', ephemeralPub)

      const positionRecord = await prisma.vestingPosition.upsert({
        where: {
          pubkey: positionPda.toBase58(),
        },
        create: {
          pubkey: positionPda.toBase58(),
          organizationId: organization.id,
          scheduleId: schedule.id,
          positionId: positionId,
          stealthOwner: stealthPub.toBase58(),
          ephemeralPub: ephemeralPub,
          encryptedEphemeralPayload: encryptedEphemeralPayload,
          isCompressed: true,
          ownerLinkId: link.id,
          startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
          isActive: true,
        },
        update: {
          // Update ALL fields including positionId in case of retry
          positionId: positionId,
          stealthOwner: stealthPub.toBase58(),
          ephemeralPub: ephemeralPub,
          encryptedEphemeralPayload: encryptedEphemeralPayload,
          isCompressed: true,
          ownerLinkId: link.id,
          startTimestamp: BigInt(Math.floor(Date.now() / 1000)),
          isActive: true,
        },
      })

      console.log('Database record created/updated:', positionRecord.id)
      console.log('  Stored positionId:', positionRecord.positionId)

      // Update organization position count
      await prisma.organization.update({
        where: { id: organization.id },
        data: { positionCount: { increment: 1 } },
      })

      // Update link positions received count
      await prisma.userLink.update({
        where: { id: link.id },
        data: { positionsReceived: { increment: 1 } },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'POSITION_PREPARED',
          userId,
          walletAddress,
          metadata: {
            organizationPubkey: body.organizationPubkey,
            positionId,
            scheduleIndex: body.scheduleIndex,
            employeeSlug: body.employeeSlug,
            stealthAddress: stealthPub.toBase58(),
            isCompressed: true,
          },
        },
      })

      // Convert encryptedEphemeralPayload to byte array for on-chain use
      // The on-chain instruction expects 128 bytes for StealthPaymentEvent
      const encryptedPayloadBytes = Buffer.from(
        bs58.decode(encryptedEphemeralPayload)
      )
      // Pad or truncate to exactly 128 bytes (on-chain constraint)
      const encryptedPayload128 = Buffer.alloc(128, 0)
      encryptedPayloadBytes.copy(encryptedPayload128, 0, 0, Math.min(128, encryptedPayloadBytes.length))

      // Return all data needed for frontend to build transaction
      return reply.send({
        success: true,
        data: {
          // Position info
          positionId,
          positionPda: positionPda.toBase58(),
          schedulePda: schedulePda.toBase58(),
          signPda: signPda.toBase58(),

          // Stealth address data (for StealthPaymentEvent emission)
          stealthAddress: stealthPub.toBase58(),
          ephemeralPub: ephemeralPub,
          encryptedPayload: Array.from(encryptedPayload128), // 128 bytes for on-chain

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

          // Database reference
          positionDbId: positionRecord.id,
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
   * Supports both regular and Light Protocol compressed positions
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

      if (body.isCompressed) {
        // For compressed positions, fetch from database (cached from Light Protocol)
        const organization = await prisma.organization.findUnique({
          where: { pubkey: body.organizationPubkey },
        })

        if (!organization) {
          return reply.status(404).send({
            success: false,
            error: 'Organization not found',
          })
        }

        const position = await prisma.vestingPosition.findFirst({
          where: {
            organizationId: organization.id,
            positionId: body.positionId,
            isCompressed: true,
          },
          include: {
            schedule: true,
          },
        })

        if (!position) {
          return reply.status(404).send({
            success: false,
            error: 'Compressed position not found',
          })
        }

        // Calculate progress from database cached data
        const now = Math.floor(Date.now() / 1000)
        const startTime = Number(position.startTimestamp)
        const cliffDuration = Number(position.schedule.cliffDuration)
        const totalDuration = Number(position.schedule.totalDuration)
        const vestingInterval = Number(position.schedule.vestingInterval)

        const cliffEndTime = startTime + cliffDuration
        const vestingEndTime = startTime + totalDuration

        let vestingProgress = 0
        let status: 'cliff' | 'vesting' | 'vested' = 'cliff'
        let isInCliff = false
        let isFullyVested = false

        if (now < cliffEndTime) {
          vestingProgress = 0
          status = 'cliff'
          isInCliff = true
        } else if (now >= vestingEndTime) {
          vestingProgress = 100
          status = 'vested'
          isFullyVested = true
        } else {
          const elapsed = now - cliffEndTime
          const intervals = Math.floor(elapsed / vestingInterval)
          const vestedSeconds = intervals * vestingInterval
          const vestingDuration = totalDuration - cliffDuration
          vestingProgress = vestingDuration > 0
            ? Math.floor((vestedSeconds * 100) / vestingDuration)
            : 100
          status = 'vesting'
        }

        return reply.send({
          success: true,
          progress: {
            positionId: body.positionId,
            startTimestamp: startTime,
            cliffEndTime,
            vestingEndTime,
            currentTime: now,
            vestingProgress,
            vestingNumerator: Math.floor(vestingProgress * 10000),
            isInCliff,
            isFullyVested,
            status,
            timeUntilCliff: isInCliff ? cliffEndTime - now : 0,
            timeUntilFullyVested: isFullyVested ? 0 : Math.max(0, vestingEndTime - now),
            startDate: new Date(startTime * 1000).toISOString(),
            cliffEndDate: new Date(cliffEndTime * 1000).toISOString(),
            vestingEndDate: new Date(vestingEndTime * 1000).toISOString(),
            isCompressed: true,
          },
        })
      }

      // Regular (uncompressed) position - fetch from chain
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
          isCompressed: false,
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

  /**
   * POST /api/organizations/claims/prepare-scratch
   * Prepare data for frontend to create a scratch position
   *
   * The scratch position is needed as a callback target for MPC.
   * Since createVestingPosition requires admin signature, the FRONTEND
   * must create it (user is the admin, not the backend service).
   *
   * Returns all data needed to call createVestingPosition from the frontend.
   */
  app.post('/claims/prepare-scratch', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { walletAddress } = request.user as { userId: string; walletAddress: string }

      const schema = z.object({
        organizationPubkey: z.string().min(32).max(44),
        scheduleIndex: z.number().int().min(0),
        beneficiaryCommitment: z.array(z.number()).length(32), // 32-byte array
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data
      const organizationPk = new PublicKey(body.organizationPubkey)
      const programId = new PublicKey(config.shadowvestProgramId)

      // Note: We don't check admin here because:
      // 1. The actual on-chain createVestingPosition will verify admin signature
      // 2. For claims, the claimant (employee) needs to create scratch position
      //    but they sign with the org admin's wallet (if they are the admin)
      // 3. If they're not the admin, the on-chain tx will fail anyway

      // Fetch on-chain org to get position count
      const orgOnChain = await fetchOrgOnChain(body.organizationPubkey)
      if (!orgOnChain) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found on-chain',
        })
      }

      const positionId = orgOnChain.positionCount.toNumber()
      const [positionPda] = findPositionPda(organizationPk, positionId)
      const [schedulePda] = findSchedulePda(organizationPk, body.scheduleIndex)
      const [signPda] = findSignPda()

      // Setup Arcium encryption
      const dummyKeypair = Keypair.generate()
      const prov = createProvider(dummyKeypair)

      // Encrypt zero as the initial amount (scratch position)
      const encrypted = await encryptAmount(prov, BigInt(0))

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

      console.log('Preparing scratch position:')
      console.log('  Organization:', body.organizationPubkey)
      console.log('  Position ID:', positionId)
      console.log('  Position PDA:', positionPda.toBase58())

      return reply.send({
        success: true,
        data: {
          positionId,
          positionPda: positionPda.toBase58(),
          schedulePda: schedulePda.toBase58(),
          signPda: signPda.toBase58(),
          beneficiaryCommitment: body.beneficiaryCommitment,
          encryptedAmount: Array.from(encrypted.ciphertext),
          clientPubkey: Array.from(encrypted.publicKey),
          nonce: encrypted.nonce.toString(),
          computationOffset: computationOffset.toString(),
          arciumAccounts,
          programId: programId.toBase58(),
        },
      })
    } catch (error) {
      console.error('Prepare scratch position error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare scratch position',
      })
    }
  })

  /**
   * POST /api/organizations/claims/queue-process
   * Queue MPC process_claim computation and complete the full claim flow
   *
   * After the frontend successfully submits authorize_claim,
   * this endpoint handles the complete claim flow:
   * 1. Verify scratch position exists (created by frontend)
   * 2. Queue process_claim_v2 MPC computation
   * 3. Wait for MPC callback
   * 4. Update compressed position
   * 5. Withdraw tokens to destination
   */
  app.post('/claims/queue-process', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }
      const parsed = queueProcessClaimSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify the position exists
      const organization = await prisma.organization.findUnique({
        where: { pubkey: body.organizationPubkey },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      // Find the position in our database
      const position = await prisma.vestingPosition.findFirst({
        where: {
          organizationId: organization.id,
          positionId: body.positionId,
        },
        include: {
          schedule: true,
        },
      })

      // Generate a job ID for tracking
      const jobId = `claim_${body.organizationPubkey.slice(0, 8)}_${body.positionId}_${Date.now()}`

      console.log('Queue process claim:')
      console.log('  Job ID:', jobId)
      console.log('  Organization:', body.organizationPubkey)
      console.log('  Position ID:', body.positionId)
      console.log('  Claim Auth PDA:', body.claimAuthPda)
      console.log('  Is Compressed:', body.isCompressed)
      console.log('  Claim Amount:', body.claimAmount)
      console.log('  Destination:', body.destinationTokenAccount)

      // Log the claim request
      await prisma.auditLog.create({
        data: {
          action: 'CLAIM_QUEUED',
          userId,
          walletAddress,
          metadata: {
            organizationPubkey: body.organizationPubkey,
            positionId: body.positionId,
            claimAuthPda: body.claimAuthPda,
            isCompressed: body.isCompressed,
            claimAmount: body.claimAmount,
            positionDbId: position?.id,
          },
        },
      })

      // Import and run the claim processor
      const { processCompressedClaim } = await import('../lib/claimProcessor.js')

      // Process the claim (this is async and may take several minutes)
      // Backend now creates scratch positions in its own service organization
      const result = await processCompressedClaim({
        organizationPubkey: body.organizationPubkey,
        positionId: body.positionId,
        claimAuthPda: body.claimAuthPda,
        nullifier: body.nullifier,
        destinationTokenAccount: body.destinationTokenAccount,
        claimAmount: body.claimAmount,
        beneficiaryCommitment: body.beneficiaryCommitment,
        scheduleIndex: body.scheduleIndex,
      })

      if (result.success) {
        // Log successful claim
        await prisma.auditLog.create({
          data: {
            action: 'CLAIM_COMPLETED',
            userId,
            walletAddress,
            metadata: {
              organizationPubkey: body.organizationPubkey,
              positionId: body.positionId,
              claimAmount: result.claimAmount,
              txSignatures: result.txSignatures,
            },
          },
        })

        return reply.send({
          success: true,
          jobId,
          message: 'Claim processed successfully',
          status: 'completed',
          claimAmount: result.claimAmount,
          txSignatures: result.txSignatures,
        })
      } else {
        return reply.status(500).send({
          success: false,
          jobId,
          error: result.error || 'Claim processing failed',
          txSignatures: result.txSignatures,
        })
      }
    } catch (error) {
      console.error('Queue process claim error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to queue claim processing',
      })
    }
  })

  /**
   * GET /api/organizations/my-positions
   * Get all positions owned by the authenticated user (via their links)
   * This is the primary way for employees to discover their stealth positions
   *
   * Returns position data from database including:
   * - ephemeralPub: needed for stealth keypair derivation during claim
   * - encryptedEphemeralPayload: encrypted ephemeral private key
   * - stealthOwner: the one-time stealth address (beneficiary commitment)
   * - positionId: for on-chain lookup
   */
  app.get('/my-positions', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }

      // Find all links belonging to this user
      const links = await prisma.userLink.findMany({
        where: { userId },
        select: { id: true, slug: true, label: true },
      })

      if (links.length === 0) {
        return reply.send({
          success: true,
          positions: [],
        })
      }

      const linkIds = links.map((l) => l.id)
      const linkMap = new Map(links.map((l) => [l.id, l]))

      // Find all positions linked to these links
      const positions = await prisma.vestingPosition.findMany({
        where: {
          ownerLinkId: { in: linkIds },
          isActive: true,
        },
        include: {
          organization: {
            select: {
              pubkey: true,
              tokenMint: true,
              nameHash: true,
            },
          },
          schedule: {
            select: {
              pubkey: true,
              scheduleIndex: true,
              cliffDuration: true,
              totalDuration: true,
              vestingInterval: true,
            },
          },
        },
        orderBy: { startTimestamp: 'desc' },
      })

      // Calculate vesting progress for each position
      const now = Math.floor(Date.now() / 1000)
      const positionsWithProgress = positions.map((p) => {
        const startTime = Number(p.startTimestamp)
        const cliffDuration = Number(p.schedule.cliffDuration)
        const totalDuration = Number(p.schedule.totalDuration)

        const cliffEndTime = startTime + cliffDuration
        const vestingEndTime = startTime + totalDuration

        let vestingProgress = 0
        let status: 'cliff' | 'vesting' | 'vested' = 'cliff'
        let isInCliff = false
        let isFullyVested = false

        if (now < cliffEndTime) {
          vestingProgress = 0
          status = 'cliff'
          isInCliff = true
        } else if (now >= vestingEndTime) {
          vestingProgress = 100
          status = 'vested'
          isFullyVested = true
        } else {
          const elapsed = now - cliffEndTime
          const vestingDuration = totalDuration - cliffDuration
          vestingProgress = vestingDuration > 0
            ? Math.min(100, Math.floor((elapsed / vestingDuration) * 100))
            : 100
          status = 'vesting'
        }

        const ownerLink = p.ownerLinkId ? linkMap.get(p.ownerLinkId) : null

        return {
          id: p.id,
          pubkey: p.pubkey,
          positionId: p.positionId,
          organizationPubkey: p.organization.pubkey,
          tokenMint: p.organization.tokenMint,
          scheduleIndex: p.schedule.scheduleIndex,
          schedulePubkey: p.schedule.pubkey,
          stealthOwner: p.stealthOwner,
          ephemeralPub: p.ephemeralPub,
          encryptedEphemeralPayload: p.encryptedEphemeralPayload,
          isCompressed: p.isCompressed,
          startTimestamp: p.startTimestamp.toString(),
          cliffEndTime,
          vestingEndTime,
          vestingProgress,
          status,
          isInCliff,
          isFullyVested,
          isActive: p.isActive,
          receivedVia: ownerLink ? {
            slug: ownerLink.slug,
            label: ownerLink.label,
          } : null,
        }
      })

      return reply.send({
        success: true,
        positions: positionsWithProgress,
      })
    } catch (error) {
      console.error('Get my positions error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch positions',
      })
    }
  })

  /**
   * GET /api/organizations/:pubkey/alt
   * Get Address Lookup Table for an organization
   */
  app.get('/:pubkey/alt', async (request, reply) => {
    try {
      const { pubkey } = request.params as { pubkey: string }

      const organization = await prisma.organization.findUnique({
        where: { pubkey },
        select: { altAddress: true },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      return reply.send({
        success: true,
        altAddress: organization.altAddress,
      })
    } catch (error) {
      console.error('Get ALT error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get ALT',
      })
    }
  })

  /**
   * POST /api/organizations/:pubkey/alt
   * Set Address Lookup Table for an organization
   */
  app.post('/:pubkey/alt', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { pubkey } = request.params as { pubkey: string }
      const { altAddress } = request.body as { altAddress: string }

      if (!altAddress || altAddress.length < 32 || altAddress.length > 44) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid ALT address',
        })
      }

      const organization = await prisma.organization.update({
        where: { pubkey },
        data: { altAddress },
      })

      return reply.send({
        success: true,
        altAddress: organization.altAddress,
      })
    } catch (error) {
      console.error('Set ALT error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set ALT',
      })
    }
  })
}
