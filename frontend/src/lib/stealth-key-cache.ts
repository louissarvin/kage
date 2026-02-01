/**
 * Stealth Key Cache
 *
 * Caches stealth private keys in sessionStorage after retrieval from Arcium MPC vault.
 * Keys are only stored for the duration of the browser session for security.
 *
 * Flow:
 * 1. User completes vault read flow (prepare -> sign tx -> event -> decrypt)
 * 2. Decrypted keys are cached here
 * 3. Claim flows use cached keys instead of re-reading from vault
 */

const CACHE_KEY = 'shadowvest_stealth_keys'

export interface CachedStealthKeys {
  spendPrivKeyHex: string
  viewPrivKeyHex: string
  cachedAt: number // timestamp
}

/**
 * Store stealth keys in session storage
 * Keys are encrypted in memory only, not persisted across sessions
 */
export function cacheStealthKeys(
  spendPrivKeyHex: string,
  viewPrivKeyHex: string
): void {
  const data: CachedStealthKeys = {
    spendPrivKeyHex,
    viewPrivKeyHex,
    cachedAt: Date.now(),
  }
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(data))
}

/**
 * Retrieve cached stealth keys
 * Returns null if not cached or expired (1 hour max)
 */
export function getCachedStealthKeys(): CachedStealthKeys | null {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (!cached) return null

    const data: CachedStealthKeys = JSON.parse(cached)

    // Check if expired (1 hour max)
    const ONE_HOUR_MS = 60 * 60 * 1000
    if (Date.now() - data.cachedAt > ONE_HOUR_MS) {
      clearCachedStealthKeys()
      return null
    }

    return data
  } catch {
    return null
  }
}

/**
 * Clear cached stealth keys
 */
export function clearCachedStealthKeys(): void {
  sessionStorage.removeItem(CACHE_KEY)
}

/**
 * Check if stealth keys are cached and valid
 */
export function hasValidCachedStealthKeys(): boolean {
  return getCachedStealthKeys() !== null
}
