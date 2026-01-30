/**
 * Wallet Authentication Service
 *
 * Handles wallet signature verification for Solana wallets.
 */

import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { config } from '../../config/index.js'
import { prisma } from '../../lib/prisma.js'

export interface AuthMessage {
  walletAddress: string
  nonce: string
  timestamp: string
}

/**
 * Create an authentication message for signing
 */
export function createAuthMessage(walletAddress: string, nonce: string): string {
  const timestamp = new Date().toISOString()
  return `${config.authMessagePrefix}\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${timestamp}`
}

/**
 * Parse an authentication message
 */
export function parseAuthMessage(message: string): AuthMessage | null {
  try {
    const lines = message.split('\n')
    if (lines.length < 4) return null
    if (!lines[0].startsWith(config.authMessagePrefix)) return null

    const walletLine = lines.find((l) => l.startsWith('Wallet:'))
    const nonceLine = lines.find((l) => l.startsWith('Nonce:'))
    const timestampLine = lines.find((l) => l.startsWith('Timestamp:'))

    if (!walletLine || !nonceLine || !timestampLine) return null

    return {
      walletAddress: walletLine.replace('Wallet:', '').trim(),
      nonce: nonceLine.replace('Nonce:', '').trim(),
      timestamp: timestampLine.replace('Timestamp:', '').trim(),
    }
  } catch {
    return null
  }
}

/**
 * Verify a Solana wallet signature
 */
export function verifySignature(
  message: string,
  signature: string,
  walletAddress: string
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = bs58.decode(signature)
    const publicKeyBytes = new PublicKey(walletAddress).toBytes()

    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

/**
 * Check if nonce has been used (replay attack prevention)
 */
export async function isNonceUsed(nonce: string): Promise<boolean> {
  const existing = await prisma.authNonce.findUnique({
    where: { nonce },
  })
  return !!existing
}

/**
 * Mark nonce as used
 */
export async function markNonceUsed(nonce: string): Promise<void> {
  const expiresAt = new Date(Date.now() + config.nonceExpirySeconds * 1000)
  await prisma.authNonce.create({
    data: {
      nonce,
      expiresAt,
    },
  })
}

/**
 * Check if timestamp is within tolerance
 */
export function isTimestampValid(timestamp: string): boolean {
  try {
    const messageTime = new Date(timestamp).getTime()
    const now = Date.now()
    const diff = Math.abs(now - messageTime)
    return diff <= config.timestampToleranceSeconds * 1000
  } catch {
    return false
  }
}

/**
 * Clean up expired nonces (call periodically)
 */
export async function cleanupExpiredNonces(): Promise<number> {
  const result = await prisma.authNonce.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  })
  return result.count
}

/**
 * Full authentication verification
 */
export async function verifyWalletAuth(
  message: string,
  signature: string,
  claimedWallet: string
): Promise<{ valid: boolean; error?: string }> {
  // 1. Parse message
  const parsed = parseAuthMessage(message)
  if (!parsed) {
    return { valid: false, error: 'Invalid message format' }
  }

  // 2. Verify wallet matches
  if (parsed.walletAddress !== claimedWallet) {
    return { valid: false, error: 'Wallet address mismatch' }
  }

  // 3. Verify timestamp
  if (!isTimestampValid(parsed.timestamp)) {
    return { valid: false, error: 'Message timestamp expired' }
  }

  // 4. Check nonce not reused
  if (await isNonceUsed(parsed.nonce)) {
    return { valid: false, error: 'Nonce already used' }
  }

  // 5. Verify signature
  if (!verifySignature(message, signature, claimedWallet)) {
    return { valid: false, error: 'Invalid signature' }
  }

  // 6. Mark nonce as used
  await markNonceUsed(parsed.nonce)

  return { valid: true }
}
