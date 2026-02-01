/**
 * Helius Event Fetching
 *
 * Fetch StealthPaymentEvents directly from blockchain using Helius.
 * This enables full on-chain position discovery without relying on a database.
 *
 * Optimized to avoid rate limits:
 * - Caches results in memory
 * - Uses delays between requests
 * - Scans fewer transactions by default
 */

import { PublicKey, Connection } from '@solana/web3.js'
import bs58 from 'bs58'
import { PROGRAM_ID } from './sdk/program'

// StealthPaymentEvent discriminator from IDL: [145, 241, 54, 6, 137, 134, 61, 31]
const STEALTH_PAYMENT_EVENT_DISCRIMINATOR = new Uint8Array([145, 241, 54, 6, 137, 134, 61, 31])

const HELIUS_RPC_URL = import.meta.env.VITE_HELIUS_RPC_URL || 'https://devnet.helius-rpc.com'

// Rate limiting - Helius free tier has strict limits
const DELAY_BETWEEN_REQUESTS = 250 // ms - increased for rate limiting
const DELAY_AFTER_ERROR = 2000 // ms - longer delay after rate limit error
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Cache for stealth events (in-memory + localStorage)
let cachedEventsMap: StealthPaymentEventsMap | null = null
let cacheTimestamp = 0
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes (increased from 5)
const LOCALSTORAGE_KEY = 'shadowvest_stealth_events_cache'

// Try to load from localStorage on module init
function loadCacheFromStorage(): void {
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY)
    if (stored) {
      const { events, timestamp } = JSON.parse(stored)
      if (Date.now() - timestamp < CACHE_TTL) {
        cachedEventsMap = new Map(events)
        cacheTimestamp = timestamp
        console.log(`[helius-events] Loaded ${cachedEventsMap.size} events from localStorage cache`)
      }
    }
  } catch {
    // Ignore localStorage errors
  }
}

function saveCacheToStorage(): void {
  if (!cachedEventsMap) return
  try {
    const data = {
      events: Array.from(cachedEventsMap.entries()),
      timestamp: cacheTimestamp,
    }
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore localStorage errors (quota exceeded, etc.)
  }
}

// Load cache on module init
loadCacheFromStorage()

/**
 * Parsed StealthPaymentEvent data
 */
export interface StealthPaymentEventData {
  organization: PublicKey
  stealthAddress: PublicKey
  ephemeralPubkey: Uint8Array
  encryptedPayload: Uint8Array
  positionId: number
  tokenMint: PublicKey
  timestamp: number
  signature: string
}

/**
 * Map of position key to stealth payment event data
 * Key format: `${organizationPubkey}-${positionId}`
 */
export type StealthPaymentEventsMap = Map<string, StealthPaymentEventData>

/**
 * Parse StealthPaymentEvent from base64-encoded event data
 * Event layout:
 * - 8 bytes: discriminator
 * - 32 bytes: organization (pubkey)
 * - 32 bytes: stealthAddress (pubkey)
 * - 32 bytes: ephemeralPubkey
 * - 128 bytes: encryptedPayload
 * - 8 bytes: positionId (u64 LE)
 * - 32 bytes: tokenMint (pubkey)
 */
function parseStealthPaymentEvent(data: Uint8Array): {
  organization: PublicKey
  stealthAddress: PublicKey
  ephemeralPubkey: Uint8Array
  encryptedPayload: Uint8Array
  positionId: number
  tokenMint: PublicKey
} | null {
  // Check discriminator
  const discriminator = data.slice(0, 8)
  if (!discriminator.every((b, i) => b === STEALTH_PAYMENT_EVENT_DISCRIMINATOR[i])) {
    return null
  }

  let offset = 8
  const organization = new PublicKey(data.slice(offset, offset + 32))
  offset += 32

  const stealthAddress = new PublicKey(data.slice(offset, offset + 32))
  offset += 32

  const ephemeralPubkey = data.slice(offset, offset + 32)
  offset += 32

  const encryptedPayload = data.slice(offset, offset + 128)
  offset += 128

  // Read positionId as u64 LE
  const positionIdBytes = data.slice(offset, offset + 8)
  const positionId = Number(
    positionIdBytes[0] +
    positionIdBytes[1] * 256 +
    positionIdBytes[2] * 256 * 256 +
    positionIdBytes[3] * 256 * 256 * 256
  )
  offset += 8

  const tokenMint = new PublicKey(data.slice(offset, offset + 32))

  return {
    organization,
    stealthAddress,
    ephemeralPubkey: new Uint8Array(ephemeralPubkey),
    encryptedPayload: new Uint8Array(encryptedPayload),
    positionId,
    tokenMint,
  }
}

/**
 * Extract StealthPaymentEvents from transaction logs
 */
function parseEventsFromLogs(logs: string[]): ReturnType<typeof parseStealthPaymentEvent>[] {
  const events: ReturnType<typeof parseStealthPaymentEvent>[] = []

  for (const log of logs) {
    // Look for "Program data:" entries which contain base64-encoded events
    if (log.startsWith('Program data: ')) {
      const base64Data = log.slice('Program data: '.length)
      try {
        // Decode base64 to bytes
        const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
        const event = parseStealthPaymentEvent(bytes)
        if (event) {
          events.push(event)
        }
      } catch {
        // Not valid base64 or not our event
      }
    }
  }

  return events
}

/**
 * Fetch all StealthPaymentEvents for a set of organizations from Helius
 *
 * @param organizationPubkeys - Organization public keys to fetch events for
 * @param limit - Maximum number of transactions to scan (default 100)
 * @returns Map of position key to event data
 */
export async function fetchStealthPaymentEvents(
  organizationPubkeys: PublicKey[],
  limit = 200
): Promise<StealthPaymentEventsMap> {
  const connection = new Connection(HELIUS_RPC_URL, 'confirmed')
  const eventsMap: StealthPaymentEventsMap = new Map()

  console.log(`[helius-events] Fetching StealthPaymentEvents for ${organizationPubkeys.length} organizations...`)

  // Fetch transaction signatures for the program
  const signatures = await connection.getSignaturesForAddress(
    PROGRAM_ID,
    { limit },
    'confirmed'
  )

  console.log(`[helius-events] Found ${signatures.length} program transactions`)

  // Process each transaction
  for (const sigInfo of signatures) {
    try {
      const tx = await connection.getTransaction(sigInfo.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })

      if (!tx?.meta?.logMessages) continue

      // Parse events from logs using our manual parser
      const events = parseEventsFromLogs(tx.meta.logMessages)

      for (const event of events) {
        if (!event) continue

        const { organization, positionId } = event

        // Check if this event is for one of our target organizations
        const isTargetOrg = organizationPubkeys.some(
          (pk) => pk.equals(organization)
        )

        if (!isTargetOrg) continue

        const eventData: StealthPaymentEventData = {
          organization: event.organization,
          stealthAddress: event.stealthAddress,
          ephemeralPubkey: event.ephemeralPubkey,
          encryptedPayload: event.encryptedPayload,
          positionId: event.positionId,
          tokenMint: event.tokenMint,
          timestamp: tx.blockTime || 0,
          signature: sigInfo.signature,
        }

        const key = `${organization.toBase58()}-${positionId}`
        eventsMap.set(key, eventData)

        console.log(`[helius-events] Found StealthPaymentEvent: org=${organization.toBase58().slice(0, 8)}... positionId=${positionId}`)
      }
    } catch (err) {
      // Skip failed transaction parsing
      console.warn(`[helius-events] Failed to parse tx ${sigInfo.signature.slice(0, 8)}...`, err)
    }
  }

  console.log(`[helius-events] Found ${eventsMap.size} StealthPaymentEvents total`)
  return eventsMap
}

/**
 * Fetch StealthPaymentEvents for ALL organizations (full scan)
 * Uses caching to avoid rate limits on repeated calls
 *
 * @param limit - Maximum number of transactions to scan (default 100, reduced for rate limits)
 * @param forceRefresh - Force refresh even if cache is valid
 * @returns Map of position key to event data
 */
export async function fetchAllStealthPaymentEvents(
  limit = 100, // Reduced from 500 to avoid rate limits
  forceRefresh = false
): Promise<StealthPaymentEventsMap> {
  // Check cache first
  const now = Date.now()
  if (!forceRefresh && cachedEventsMap && (now - cacheTimestamp) < CACHE_TTL) {
    console.log(`[helius-events] Using cached events (${cachedEventsMap.size} events, age: ${Math.round((now - cacheTimestamp) / 1000)}s)`)
    return cachedEventsMap
  }

  const connection = new Connection(HELIUS_RPC_URL, 'confirmed')
  const eventsMap: StealthPaymentEventsMap = new Map()

  console.log(`[helius-events] Fetching StealthPaymentEvents (scanning last ${limit} txs)...`)

  try {
    // Fetch transaction signatures for the program
    // Use pagination to get more signatures if needed
    let allSignatures: { signature: string; blockTime?: number | null }[] = []
    let before: string | undefined = undefined
    const batchSize = Math.min(limit, 1000) // Max 1000 per request

    while (allSignatures.length < limit) {
      const batch = await connection.getSignaturesForAddress(
        PROGRAM_ID,
        { limit: batchSize, before },
        'confirmed'
      )

      if (batch.length === 0) break

      allSignatures = allSignatures.concat(batch)
      before = batch[batch.length - 1].signature

      // Rate limit between pagination requests
      if (allSignatures.length < limit && batch.length === batchSize) {
        await sleep(DELAY_BETWEEN_REQUESTS * 2)
      }
    }

    // Trim to requested limit
    const signatures = allSignatures.slice(0, limit)

    console.log(`[helius-events] Found ${signatures.length} program transactions to scan`)

    let processedCount = 0
    let errorCount = 0
    let consecutiveErrors = 0

    for (const sigInfo of signatures) {
      try {
        // Rate limiting - add delay between EVERY request to avoid 429
        await sleep(DELAY_BETWEEN_REQUESTS)

        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        })

        consecutiveErrors = 0 // Reset on success

        if (!tx?.meta?.logMessages) {
          processedCount++
          continue
        }

        // Parse events from logs using our manual parser
        const events = parseEventsFromLogs(tx.meta.logMessages)

        for (const event of events) {
          if (!event) continue

          const { organization, positionId } = event

          const eventData: StealthPaymentEventData = {
            organization: event.organization,
            stealthAddress: event.stealthAddress,
            ephemeralPubkey: event.ephemeralPubkey,
            encryptedPayload: event.encryptedPayload,
            positionId: event.positionId,
            tokenMint: event.tokenMint,
            timestamp: tx.blockTime || 0,
            signature: sigInfo.signature,
          }

          const key = `${organization.toBase58()}-${positionId}`
          eventsMap.set(key, eventData)
          console.log(`[helius-events] Found event: org=${organization.toBase58().slice(0, 8)}... positionId=${positionId}`)
        }

        processedCount++
        if (processedCount % 50 === 0) {
          console.log(`[helius-events] Progress: ${processedCount}/${signatures.length} txs, found ${eventsMap.size} events`)
        }
      } catch (err) {
        errorCount++
        consecutiveErrors++

        // If we're getting rate limited (many consecutive errors), slow down significantly
        if (consecutiveErrors > 3) {
          console.warn(`[helius-events] Rate limited, adding ${DELAY_AFTER_ERROR}ms delay...`)
          await sleep(DELAY_AFTER_ERROR)
        }

        if (consecutiveErrors > 5) {
          console.warn(`[helius-events] Too many consecutive errors (${consecutiveErrors}), stopping scan early`)
          break
        }

        // Add extra delay after error
        await sleep(1000)
      }
    }

    console.log(`[helius-events] Scan complete: ${eventsMap.size} events from ${processedCount} txs (${errorCount} errors)`)

    // Update cache (both memory and localStorage)
    cachedEventsMap = eventsMap
    cacheTimestamp = now
    saveCacheToStorage()

    return eventsMap
  } catch (err) {
    console.error('[helius-events] Failed to fetch events:', err)
    // Return cached data if available, even if stale
    if (cachedEventsMap) {
      console.log('[helius-events] Returning stale cache due to error')
      return cachedEventsMap
    }
    return eventsMap
  }
}

/**
 * Get ephemeral data for a specific position from events map
 */
export function getEphemeralDataFromEvents(
  eventsMap: StealthPaymentEventsMap,
  organizationPubkey: PublicKey,
  positionId: number
): { ephemeralPubkey: string; encryptedPayload: string } | null {
  const key = `${organizationPubkey.toBase58()}-${positionId}`
  const event = eventsMap.get(key)

  if (!event) return null

  return {
    ephemeralPubkey: bs58.encode(event.ephemeralPubkey),
    encryptedPayload: bs58.encode(event.encryptedPayload),
  }
}
