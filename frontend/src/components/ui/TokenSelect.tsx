/**
 * Token Select Component
 *
 * Dropdown for selecting tokens with logo, name, and symbol.
 * The actual value is the token mint address.
 */

import { useState, useRef, useEffect, type FC } from 'react'
import { ChevronDown, Check } from 'lucide-react'

// Token definitions with logos
export interface TokenInfo {
  symbol: string
  name: string
  mint: string
  logo: string
  decimals: number
}

// Devnet tokens
export const DEVNET_TOKENS: TokenInfo[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    decimals: 6,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    mint: 'EzZp7LRN1xwu3dAkgfkXcKqpEauxSDRBN4v1kaXPQVSN',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
    decimals: 6,
  },
  {
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    decimals: 9,
  },
]

// Mainnet tokens (for future use)
export const MAINNET_TOKENS: TokenInfo[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    decimals: 6,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
    decimals: 6,
  },
  {
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    decimals: 9,
  },
]

interface TokenSelectProps {
  label?: string
  value: string
  onChange: (mint: string) => void
  tokens?: TokenInfo[]
  hint?: string
  disabled?: boolean
}

export const TokenSelect: FC<TokenSelectProps> = ({
  label,
  value,
  onChange,
  tokens = DEVNET_TOKENS,
  hint,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Find selected token
  const selectedToken = tokens.find((t) => t.mint === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (token: TokenInfo) => {
    onChange(token.mint)
    setIsOpen(false)
  }

  return (
    <div className="space-y-1.5" ref={dropdownRef}>
      {label && (
        <label className="block text-sm font-medium text-kage-text-muted">
          {label}
        </label>
      )}

      <div className="relative">
        {/* Trigger button */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            w-full px-3 py-2.5
            bg-kage-elevated border border-kage-border rounded-2xl
            text-left
            focus:outline-none focus:border-kage-accent-dim
            transition-colors duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            ${isOpen ? 'border-kage-accent-dim' : ''}
          `}
        >
          <div className="flex items-center justify-between">
            {selectedToken ? (
              <div className="flex items-center gap-3">
                <img
                  src={selectedToken.logo}
                  alt={selectedToken.symbol}
                  className="w-6 h-6 rounded-full"
                  onError={(e) => {
                    // Fallback if image fails to load
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
                <div>
                  <span className="font-medium text-kage-text">
                    {selectedToken.symbol}
                  </span>
                  <span className="text-kage-text-muted ml-2 text-sm">
                    {selectedToken.name}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-kage-text-dim">Select a token</span>
            )}
            <ChevronDown
              className={`w-5 h-5 text-kage-text-dim transition-transform ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-2 py-1 bg-kage-elevated border border-kage-border rounded-2xl shadow-lg">
            {tokens.map((token) => (
              <button
                key={token.mint}
                type="button"
                onClick={() => handleSelect(token)}
                className={`
                  w-full px-3 py-2.5
                  flex items-center justify-between
                  hover:bg-kage-subtle
                  transition-colors duration-150
                `}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={token.logo}
                    alt={token.symbol}
                    className="w-6 h-6 rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  <div className="text-left">
                    <span className="font-medium text-kage-text">
                      {token.symbol}
                    </span>
                    <span className="text-kage-text-muted ml-2 text-sm">
                      {token.name}
                    </span>
                  </div>
                </div>
                {token.mint === value && (
                  <Check className="w-4 h-4 text-kage-accent" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hint / mint address preview */}
      {hint && (
        <p className="text-xs text-kage-text-dim">{hint}</p>
      )}
      {selectedToken && (
        <p className="text-xs text-kage-text-dim font-mono truncate">
          Mint: {selectedToken.mint}
        </p>
      )}
    </div>
  )
}
