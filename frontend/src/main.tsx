import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WalletProvider } from '@/contexts/WalletProvider'
import App from './App'
import './index.css'

// Buffer polyfill for Solana web3.js
import { Buffer } from 'buffer'
window.Buffer = Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <App />
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>
)
