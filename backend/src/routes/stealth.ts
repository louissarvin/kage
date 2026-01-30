/**
 * Stealth Key Routes
 *
 * Handles registration of stealth meta keys.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

// Validation schemas
const registerKeysSchema = z.object({
  walletId: z.string().uuid(),
  metaSpendPub: z.string().min(32).max(64), // Base58 public key
  metaViewPub: z.string().min(32).max(64), // Base58 public key
  // NOTE: Private keys are stored ON-CHAIN via Arcium MPC (metaKeysVault PDA)
  // Backend only stores public keys for link lookups
})

export async function stealthRoutes(app: FastifyInstance) {
  /**
   * POST /api/stealth/register
   * Register stealth meta keys for a wallet
   */
  app.post('/register', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string; walletAddress: string }
      const parsed = registerKeysSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const body = parsed.data

      // Verify wallet belongs to user
      const wallet = await prisma.userWallet.findFirst({
        where: {
          id: body.walletId,
          userId,
        },
      })

      if (!wallet) {
        return reply.status(404).send({
          success: false,
          error: 'Wallet not found',
        })
      }

      // Check if wallet already has keys
      if (wallet.metaSpendPub && wallet.metaViewPub) {
        return reply.status(400).send({
          success: false,
          error: 'Wallet already has stealth keys registered',
        })
      }

      // Update wallet with public keys
      // NOTE: Private keys are stored ON-CHAIN in Arcium metaKeysVault PDA
      // The vault is identified by the wallet address (owner PDA)
      const updated = await prisma.userWallet.update({
        where: { id: body.walletId },
        data: {
          metaSpendPub: body.metaSpendPub,
          metaViewPub: body.metaViewPub,
        },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'STEALTH_KEYS_REGISTERED',
          userId,
          walletAddress: wallet.address,
          metadata: {
            walletId: body.walletId,
          },
        },
      })

      return reply.send({
        success: true,
        wallet: {
          id: updated.id,
          address: updated.address,
          metaSpendPub: updated.metaSpendPub,
          metaViewPub: updated.metaViewPub,
        },
        // NOTE: Private keys stored on-chain in Arcium metaKeysVault PDA
        // Frontend should call writeMetaKeysToVault after this registration
      })
    } catch (error) {
      console.error('Register stealth keys error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to register stealth keys',
      })
    }
  })

  /**
   * GET /api/stealth/has-keys/:walletId
   * Check if wallet has stealth keys registered
   */
  app.get('/has-keys/:walletId', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId } = request.user as { userId: string }
      const params = request.params as { walletId: string }

      const wallet = await prisma.userWallet.findFirst({
        where: {
          id: params.walletId,
          userId,
        },
      })

      if (!wallet) {
        return reply.status(404).send({
          success: false,
          error: 'Wallet not found',
        })
      }

      const hasKeys = !!(wallet.metaSpendPub && wallet.metaViewPub)

      return reply.send({
        success: true,
        hasKeys,
        metaSpendPub: hasKeys ? wallet.metaSpendPub : undefined,
        metaViewPub: hasKeys ? wallet.metaViewPub : undefined,
        // NOTE: To check if on-chain Arcium vault exists, frontend should query the PDA
      })
    } catch (error) {
      console.error('Check stealth keys error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to check stealth keys',
      })
    }
  })

  /**
   * GET /api/stealth/my-meta-address
   * Get current user's meta-address
   */
  app.get('/my-meta-address', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { walletAddress } = request.user as { userId: string; walletAddress: string }

      const wallet = await prisma.userWallet.findUnique({
        where: { address: walletAddress },
      })

      if (!wallet || !wallet.metaSpendPub || !wallet.metaViewPub) {
        return reply.status(404).send({
          success: false,
          error: 'No stealth keys registered for this wallet',
        })
      }

      return reply.send({
        success: true,
        metaAddress: {
          metaSpendPub: wallet.metaSpendPub,
          metaViewPub: wallet.metaViewPub,
        },
      })
    } catch (error) {
      console.error('Get meta address error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to get meta address',
      })
    }
  })
}
