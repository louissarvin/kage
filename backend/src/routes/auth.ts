/**
 * Authentication Routes
 *
 * Handles wallet-based authentication for ShadowVest.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  createAuthMessage,
  verifyWalletAuth,
  cleanupExpiredNonces,
} from '../services/auth/wallet.js'
import { getUserRole } from '../utils/roles.js'
import { randomUUID } from 'crypto'

// Validation schemas
const connectSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  signature: z.string(),
  message: z.string(),
  chain: z.enum(['SOLANA', 'SUI']).default('SOLANA'),
})

const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
})

export async function authRoutes(app: FastifyInstance) {
  /**
   * GET /api/auth/nonce
   * Get a nonce for signing
   */
  app.get('/nonce', async (request, reply) => {
    try {
      const query = request.query as { walletAddress?: string }
      const parsed = nonceRequestSchema.safeParse(query)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid wallet address',
        })
      }

      const { walletAddress } = parsed.data
      const nonce = randomUUID()
      const message = createAuthMessage(walletAddress, nonce)

      return reply.send({
        success: true,
        nonce,
        message,
      })
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request',
      })
    }
  })

  /**
   * POST /api/auth/connect
   * Connect wallet and create/retrieve user session
   */
  app.post('/connect', async (request, reply) => {
    try {
      const parsed = connectSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify wallet signature
      const authResult = await verifyWalletAuth(
        body.message,
        body.signature,
        body.walletAddress
      )

      if (!authResult.valid) {
        return reply.status(401).send({
          success: false,
          error: authResult.error,
        })
      }

      // Find or create user and wallet
      let existingWallet = await prisma.userWallet.findUnique({
        where: { address: body.walletAddress },
        include: { user: true },
      })

      let userId: string
      let arciumKeyId: string | null = null

      if (!existingWallet) {
        // Create new user and wallet
        const user = await prisma.user.create({
          data: {
            wallets: {
              create: {
                address: body.walletAddress,
                chain: body.chain,
              },
            },
          },
          include: {
            wallets: true,
            links: true,
          },
        })
        userId = user.id
        arciumKeyId = user.wallets[0].arciumKeyId
      } else {
        userId = existingWallet.userId
        arciumKeyId = existingWallet.arciumKeyId
      }

      // Generate JWT
      const token = app.jwt.sign({
        userId,
        walletAddress: body.walletAddress,
        arciumKeyId: arciumKeyId || undefined,
      })

      // Fetch full user data
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          wallets: true,
          links: {
            include: { wallet: true },
          },
        },
      })

      // Get user role information
      const roleInfo = await getUserRole(userId)

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'USER_CONNECTED',
          userId,
          walletAddress: body.walletAddress,
          metadata: { chain: body.chain, role: roleInfo.role },
        },
      })

      return reply.send({
        success: true,
        user,
        role: roleInfo,
        token,
      })
    } catch (error) {
      console.error('Auth connect error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Authentication failed',
      })
    }
  })

  /**
   * GET /api/auth/me
   * Get current authenticated user
   */
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          wallets: true,
          links: {
            include: { wallet: true },
          },
        },
      })

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
        })
      }

      // Get user role information
      const roleInfo = await getUserRole(userId)

      return reply.send({
        success: true,
        user,
        role: roleInfo,
      })
    } catch (error) {
      console.error('Auth me error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch user',
      })
    }
  })

  /**
   * POST /api/auth/logout
   * Logout (client should discard token)
   */
  app.post('/logout', { preHandler: [app.authenticate] }, async (_request, reply) => {
    return reply.send({
      success: true,
      message: 'Logged out successfully',
    })
  })

  /**
   * Background job: Clean up expired nonces
   */
  setInterval(
    async () => {
      const cleaned = await cleanupExpiredNonces()
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired nonces`)
      }
    },
    5 * 60 * 1000
  ) // Every 5 minutes
}
