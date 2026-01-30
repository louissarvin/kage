import { PublicKey } from '@solana/web3.js'

// Program ID - matches contract/programs/contract/src/lib.rs
export const PROGRAM_ID = new PublicKey('3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA')

// Cluster configuration
export const CLUSTER_URL = import.meta.env.VITE_CLUSTER_URL || 'https://api.devnet.solana.com'

// Backend API URL
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Precision for vesting calculations (matches contract)
export const VESTING_PRECISION = 1_000_000n

// Time constants
export const SECONDS_PER_DAY = 86400
export const SECONDS_PER_MONTH = 2592000 // 30 days
export const SECONDS_PER_YEAR = 31536000 // 365 days

// Format helpers
export function formatDuration(seconds: number): string {
  if (seconds >= SECONDS_PER_YEAR) {
    const years = Math.floor(seconds / SECONDS_PER_YEAR)
    return `${years} year${years > 1 ? 's' : ''}`
  }
  if (seconds >= SECONDS_PER_MONTH) {
    const months = Math.floor(seconds / SECONDS_PER_MONTH)
    return `${months} month${months > 1 ? 's' : ''}`
  }
  if (seconds >= SECONDS_PER_DAY) {
    const days = Math.floor(seconds / SECONDS_PER_DAY)
    return `${days} day${days > 1 ? 's' : ''}`
  }
  return `${seconds} seconds`
}

export function formatAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatAmount(amount: number, decimals = 9): string {
  const value = amount / Math.pow(10, decimals)
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}
