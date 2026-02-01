/**
 * Stealth Key Routes
 *
 * Handles registration of stealth meta keys.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import {
  prepareWriteMetaKeysToVault,
  prepareReadMetaKeysFromVault,
  reconstructKeyFromU128,
} from '../lib/solana.js'
import {
  x25519,
  RescueCipher,
  getMXEPublicKey,
} from '@arcium-hq/client'
import { PublicKey, Keypair } from '@solana/web3.js'
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor'
import { Connection } from '@solana/web3.js'
import { config } from '../config/index.js'

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
   * POST /api/stealth/reset-keys
   * Reset/clear stealth keys from database
   *
   * Use this when the on-chain vault creation failed but DB has keys.
   * This allows re-registering stealth keys.
   */
  app.post('/reset-keys', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { userId, walletAddress } = request.user as { userId: string; walletAddress: string }

      // Find user's wallet
      const wallet = await prisma.userWallet.findFirst({
        where: {
          userId,
          address: walletAddress,
        },
      })

      if (!wallet) {
        return reply.status(404).send({
          success: false,
          error: 'Wallet not found',
        })
      }

      // Clear stealth keys from database
      const updated = await prisma.userWallet.update({
        where: { id: wallet.id },
        data: {
          metaSpendPub: null,
          metaViewPub: null,
        },
      })

      // Log audit
      await prisma.auditLog.create({
        data: {
          action: 'STEALTH_KEYS_RESET',
          userId,
          walletAddress: wallet.address,
          metadata: {
            walletId: wallet.id,
            reason: 'Manual reset - vault creation may have failed',
          },
        },
      })

      return reply.send({
        success: true,
        message: 'Stealth keys cleared. You can now re-register.',
        wallet: {
          id: updated.id,
          address: updated.address,
          metaSpendPub: null,
          metaViewPub: null,
        },
      })
    } catch (error) {
      console.error('Reset stealth keys error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to reset stealth keys',
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

  // =============================================================================
  // Arcium MPC Vault Operations
  // =============================================================================

  /**
   * POST /api/stealth/prepare-vault-write
   * Prepare data for writing meta-keys to on-chain Arcium vault
   *
   * This encrypts the stealth private keys for MPC storage.
   * Frontend will use this data to build and submit the transaction.
   */
  app.post('/prepare-vault-write', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { walletAddress } = request.user as { userId: string; walletAddress: string }

      const schema = z.object({
        spendPrivKeyHex: z.string().length(64), // 32 bytes as hex
        viewPrivKeyHex: z.string().length(64),  // 32 bytes as hex
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const { spendPrivKeyHex, viewPrivKeyHex } = parsed.data

      // Prepare encrypted data for vault write
      const preparedData = await prepareWriteMetaKeysToVault(
        walletAddress,
        spendPrivKeyHex,
        viewPrivKeyHex
      )

      return reply.send({
        success: true,
        data: preparedData,
      })
    } catch (error) {
      console.error('Prepare vault write error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare vault write',
      })
    }
  })

  /**
   * POST /api/stealth/prepare-vault-read
   * Prepare data for reading meta-keys from on-chain Arcium vault
   *
   * This generates a session key for receiving decrypted keys.
   * Frontend will use this data to build and submit the transaction,
   * then use the session key to decrypt the event data.
   */
  app.post('/prepare-vault-read', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const { walletAddress } = request.user as { userId: string; walletAddress: string }

      // Prepare data for vault read
      const preparedData = await prepareReadMetaKeysFromVault(walletAddress)

      return reply.send({
        success: true,
        data: preparedData,
      })
    } catch (error) {
      console.error('Prepare vault read error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare vault read',
      })
    }
  })

  /**
   * POST /api/stealth/decrypt-vault-event
   * Decrypt meta-keys from a MetaKeysRetrieved event
   *
   * This uses the session private key and MXE public key to decrypt
   * the MPC-encrypted keys from the event data.
   */
  app.post('/decrypt-vault-event', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const schema = z.object({
        sessionPrivKeyHex: z.string().length(64), // 32 bytes as hex
        encryptedSpendLo: z.array(z.number()),
        encryptedSpendHi: z.array(z.number()),
        encryptedViewLo: z.array(z.number()),
        encryptedViewHi: z.array(z.number()),
        nonce: z.array(z.number()),
      })

      const parsed = schema.safeParse(request.body)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors[0].message,
        })
      }

      const {
        sessionPrivKeyHex,
        encryptedSpendLo,
        encryptedSpendHi,
        encryptedViewLo,
        encryptedViewHi,
        nonce,
      } = parsed.data

      // Get MXE public key
      const programId = new PublicKey(config.shadowvestProgramId)
      const connection = new Connection(config.solanaRpcUrl, 'confirmed')
      const dummyKeypair = Keypair.generate()
      const provider = new AnchorProvider(
        connection,
        new Wallet(dummyKeypair),
        { commitment: 'confirmed' }
      )

      const mxePublicKey = await getMXEPublicKey(provider, programId)
      if (!mxePublicKey) {
        return reply.status(500).send({
          success: false,
          error: 'Failed to get MXE public key',
        })
      }

      // Decrypt with session key
      const sessionPrivKey = Buffer.from(sessionPrivKeyHex, 'hex')
      const sharedSecret = x25519.getSharedSecret(sessionPrivKey, mxePublicKey)
      const cipher = new RescueCipher(sharedSecret)

      const decrypted = cipher.decrypt(
        [
          new Uint8Array(encryptedSpendLo) as unknown as number[],
          new Uint8Array(encryptedSpendHi) as unknown as number[],
          new Uint8Array(encryptedViewLo) as unknown as number[],
          new Uint8Array(encryptedViewHi) as unknown as number[],
        ],
        new Uint8Array(nonce)
      )

      // Reconstruct 32-byte keys from u128 pairs
      const spendPrivKey = reconstructKeyFromU128(decrypted[0], decrypted[1])
      const viewPrivKey = reconstructKeyFromU128(decrypted[2], decrypted[3])

      return reply.send({
        success: true,
        data: {
          spendPrivKeyHex: Buffer.from(spendPrivKey).toString('hex'),
          viewPrivKeyHex: Buffer.from(viewPrivKey).toString('hex'),
        },
      })
    } catch (error) {
      console.error('Decrypt vault event error:', error)
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to decrypt vault event',
      })
    }
  })

  // =============================================================================
  // Stealth Payment Data (for claim flow)
  // =============================================================================

  /**
   * GET /api/stealth/keys
   * Get stealth private keys - requires prior vault read and decrypt
   *
   * NOTE: This is a convenience endpoint that returns cached keys if available.
   * The full flow to retrieve keys from Arcium MPC is:
   * 1. Call /prepare-vault-read
   * 2. Build and sign read_meta_keys transaction
   * 3. Listen for MetaKeysRetrieved event
   * 4. Call /decrypt-vault-event with event data
   *
   * For the claim flow, the frontend should complete this flow first,
   * then cache the keys locally for the session.
   */
  app.get('/keys', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      // This endpoint indicates to the frontend that it needs to complete
      // the vault read flow to get the private keys
      return reply.status(400).send({
        success: false,
        error: 'Stealth private keys must be retrieved from Arcium MPC vault',
        hint: 'Use /prepare-vault-read to start the vault read flow, then decrypt the event data',
        steps: [
          '1. POST /api/stealth/prepare-vault-read - Get session key and accounts',
          '2. Build and sign read_meta_keys transaction on frontend',
          '3. Listen for MetaKeysRetrieved event',
          '4. POST /api/stealth/decrypt-vault-event - Decrypt the keys',
        ],
      })
    } catch (error) {
      console.error('Get stealth keys error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to get stealth keys',
      })
    }
  })

  /**
   * GET /api/stealth/payment/:orgPubkey/:positionId/ephemeral-key
   * Get ephemeral public key for a stealth payment (position)
   * This is the R value stored during position creation
   */
  app.get('/payment/:orgPubkey/:positionId/ephemeral-key', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const params = request.params as { orgPubkey: string; positionId: string }
      const positionId = parseInt(params.positionId, 10)

      console.log('=== Get Ephemeral Key ===')
      console.log('  Org Pubkey:', params.orgPubkey)
      console.log('  Position ID:', positionId)

      if (isNaN(positionId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid position ID',
        })
      }

      // Find the organization
      const organization = await prisma.organization.findUnique({
        where: { pubkey: params.orgPubkey },
      })

      console.log('  Organization found:', !!organization)

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      // Find the position
      const position = await prisma.vestingPosition.findFirst({
        where: {
          organizationId: organization.id,
          positionId: positionId,
        },
      })

      console.log('  Position found:', !!position)
      if (position) {
        console.log('    Position DB ID:', position.id)
        console.log('    Position positionId:', position.positionId)
        console.log('    Has ephemeralPub:', !!position.ephemeralPub)
        console.log('    ephemeralPub value:', position.ephemeralPub?.slice(0, 20) + '...')
      }

      if (!position) {
        // Try to find any positions for this org to debug
        const allPositions = await prisma.vestingPosition.findMany({
          where: { organizationId: organization.id },
          select: { id: true, positionId: true, ephemeralPub: true },
        })
        console.log('  All positions for org:', allPositions.map(p => ({
          id: p.id,
          positionId: p.positionId,
          hasEphemeralPub: !!p.ephemeralPub,
        })))

        return reply.status(404).send({
          success: false,
          error: 'Position not found',
        })
      }

      if (!position.ephemeralPub) {
        return reply.status(404).send({
          success: false,
          error: 'Ephemeral public key not found for this position',
        })
      }

      return reply.send({
        success: true,
        ephemeralPubkey: position.ephemeralPub,
      })
    } catch (error) {
      console.error('Get ephemeral key error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to get ephemeral key',
      })
    }
  })

  /**
   * GET /api/stealth/payment/:orgPubkey/:positionId/payload
   * Get encrypted payload for a stealth payment
   * This contains the encrypted ephemeral private key that the employee decrypts
   */
  app.get('/payment/:orgPubkey/:positionId/payload', { preHandler: [app.authenticate] }, async (request, reply) => {
    try {
      const params = request.params as { orgPubkey: string; positionId: string }
      const positionId = parseInt(params.positionId, 10)

      if (isNaN(positionId)) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid position ID',
        })
      }

      // Find the organization
      const organization = await prisma.organization.findUnique({
        where: { pubkey: params.orgPubkey },
      })

      if (!organization) {
        return reply.status(404).send({
          success: false,
          error: 'Organization not found',
        })
      }

      // Find the position
      const position = await prisma.vestingPosition.findFirst({
        where: {
          organizationId: organization.id,
          positionId: positionId,
        },
      })

      if (!position) {
        return reply.status(404).send({
          success: false,
          error: 'Position not found',
        })
      }

      if (!position.encryptedEphemeralPayload) {
        return reply.status(404).send({
          success: false,
          error: 'Encrypted payload not found for this position',
        })
      }

      return reply.send({
        success: true,
        encryptedPayload: position.encryptedEphemeralPayload,
      })
    } catch (error) {
      console.error('Get encrypted payload error:', error)
      return reply.status(500).send({
        success: false,
        error: 'Failed to get encrypted payload',
      })
    }
  })
}
