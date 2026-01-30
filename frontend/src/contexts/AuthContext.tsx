/**
 * Authentication Context
 *
 * Manages user authentication state with the backend.
 * Works in conjunction with Solana wallet connection.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type FC,
  type ReactNode,
} from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { api, type ApiUser, type ApiRoleInfo } from '@/lib/api'

// =============================================================================
// Types
// =============================================================================

interface AuthContextValue {
  // State
  user: ApiUser | null
  role: ApiRoleInfo | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  // Actions
  authenticate: () => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

// =============================================================================
// Context
// =============================================================================

const AuthContext = createContext<AuthContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

interface AuthProviderProps {
  children: ReactNode
}

export const AuthProvider: FC<AuthProviderProps> = ({ children }) => {
  const { publicKey, signMessage, connected, disconnect } = useWallet()

  const [user, setUser] = useState<ApiUser | null>(null)
  const [role, setRole] = useState<ApiRoleInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isAuthenticated = !!user && api.isAuthenticated()

  // ---------------------------------------------------------------------------
  // Initialize - Check existing token
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const initAuth = async () => {
      if (!api.isAuthenticated()) {
        setIsLoading(false)
        return
      }

      try {
        const { user, role } = await api.getMe()
        setUser(user)
        setRole(role)
      } catch (err) {
        // Token invalid, clear it
        api.setToken(null)
        setUser(null)
        setRole(null)
      } finally {
        setIsLoading(false)
      }
    }

    initAuth()
  }, [])

  // ---------------------------------------------------------------------------
  // Handle wallet disconnect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!connected && user) {
      // Wallet disconnected, clear auth
      api.setToken(null)
      setUser(null)
      setRole(null)
    }
  }, [connected, user])

  // ---------------------------------------------------------------------------
  // Authenticate
  // ---------------------------------------------------------------------------

  const authenticate = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError('Wallet not connected')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // 1. Get nonce from backend
      const { message } = await api.getNonce(publicKey.toBase58())

      // 2. Sign message with wallet
      const messageBytes = new TextEncoder().encode(message)
      const signatureBytes = await signMessage(messageBytes)
      const signature = bs58.encode(signatureBytes)

      // 3. Connect to backend
      const { user, role } = await api.connect(
        publicKey.toBase58(),
        signature,
        message,
        'SOLANA'
      )

      setUser(user)
      setRole(role)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      console.error('Authentication error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [publicKey, signMessage])

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      setUser(null)
      setRole(null)
      disconnect()
    }
  }, [disconnect])

  // ---------------------------------------------------------------------------
  // Refresh User
  // ---------------------------------------------------------------------------

  const refreshUser = useCallback(async () => {
    if (!api.isAuthenticated()) return

    try {
      const { user, role } = await api.getMe()
      setUser(user)
      setRole(role)
    } catch (err) {
      console.error('Refresh user error:', err)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Auto-authenticate when wallet connects (if no existing session)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (connected && publicKey && !isAuthenticated && !isLoading && signMessage) {
      // Small delay to ensure wallet is fully ready
      const timer = setTimeout(() => {
        authenticate()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [connected, publicKey, isAuthenticated, isLoading, signMessage, authenticate])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated,
        isLoading,
        error,
        authenticate,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// =============================================================================
// Hook
// =============================================================================

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
