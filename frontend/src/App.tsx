import type { FC } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Landing, Dashboard, Organizations, Positions, Claim } from '@/pages'

const ProtectedRoute: FC<{ children: React.ReactNode }> = ({ children }) => {
  const { connected } = useWallet()

  if (!connected) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

const App: FC = () => {
  const { connected } = useWallet()

  return (
    <Routes>
      <Route
        path="/"
        element={connected ? <Navigate to="/dashboard" replace /> : <Landing />}
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organizations/*"
        element={
          <ProtectedRoute>
            <Organizations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/positions/*"
        element={
          <ProtectedRoute>
            <Positions />
          </ProtectedRoute>
        }
      />
      <Route
        path="/claim"
        element={
          <ProtectedRoute>
            <Claim />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
