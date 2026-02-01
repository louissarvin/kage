/**
 * Service Keypair Module
 *
 * Manages the backend service keypair used for:
 * - Paying transaction fees
 * - Acting as admin of the service organization
 * - Processing claims on behalf of users
 */

import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { config } from '../config/index.js'

let serviceKeypair: Keypair | null = null

/**
 * Get the service keypair (singleton)
 * Loaded from SERVICE_KEYPAIR environment variable (base58 encoded)
 */
export function getServiceKeypair(): Keypair {
  if (!serviceKeypair) {
    if (!config.serviceKeypair) {
      throw new Error('SERVICE_KEYPAIR not configured. Please set it in .env')
    }
    try {
      const secretKey = bs58.decode(config.serviceKeypair)
      serviceKeypair = Keypair.fromSecretKey(secretKey)
      console.log('[ServiceKeypair] Loaded:', serviceKeypair.publicKey.toBase58())
    } catch (err) {
      throw new Error(`Failed to parse SERVICE_KEYPAIR: ${err}`)
    }
  }
  return serviceKeypair
}

/**
 * Check if service keypair is configured
 */
export function isServiceKeypairConfigured(): boolean {
  return Boolean(config.serviceKeypair)
}
