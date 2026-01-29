import type { FC } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Landing, Dashboard, Organizations, Positions, Claim } from '@/pages'

const App: FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/organizations/*" element={<Organizations />} />
      <Route path="/positions/*" element={<Positions />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
