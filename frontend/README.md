# Kage Frontend

**React Web Application for Kage Protocol**

A modern, privacy-focused web interface for managing vesting positions, claiming tokens, and interacting with the Kage protocol.

## Tech Stack

- **React 19** - UI framework
- **Vite** - Build tool & dev server
- **TailwindCSS 4** - Styling
- **Framer Motion & GSAP** - Animations
- **Solana Wallet Adapter** - Wallet connection
- **Light Protocol SDK** - ZK compression
- **Arcium Client** - MPC interactions

## Features

- **Dashboard** - Overview of positions and stats
- **Organizations** - Create and manage organizations
- **Positions** - View and claim vesting positions
- **Stealth Keys** - Privacy key management via Arcium vault

## Getting Started

### Prerequisites

- Node.js 20+ or Bun
- A Solana wallet (Phantom, Solflare, etc.)

### Installation

```bash
# Install dependencies
bun install

# Start development server
bun run dev
```

### Environment Variables

Create a `.env` file:

```bash
# Backend API URL
VITE_API_URL=http://localhost:3001

# Solana cluster (Helius RPC recommended)
VITE_CLUSTER_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY

# Helius RPC for Light Protocol
VITE_HELIUS_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
```

## Project Structure

```
src/
├── components/        # Reusable UI components
│   ├── layout/        # Header, Layout, Navigation
│   ├── ui/            # Button, Card, Badge, etc.
│   └── magicui/       # Animated components (Globe, OrbitingCircles)
├── contexts/          # React contexts (Auth, Wallet)
├── hooks/             # Custom hooks
│   ├── usePositions   # Position fetching & management
│   ├── useOrganization# Organization data
│   ├── useVaultKeys   # Arcium MPC key retrieval
│   └── useBackend     # API interactions
├── lib/               # Utilities
│   ├── sdk/           # Solana program SDK
│   ├── api.ts         # Backend API client
│   ├── stealth-address.ts  # ECDH stealth implementation
│   └── helius-events.ts    # On-chain event fetching
├── pages/             # Route pages
│   ├── Landing.tsx    # Marketing page
│   ├── Dashboard.tsx  # User dashboard
│   ├── Organizations.tsx  # Org management
│   └── Positions.tsx  # Position claiming
└── assets/            # Images & icons
```

## Scripts

```bash
bun run dev      # Start dev server
bun run build    # Production build
bun run preview  # Preview production build
bun run lint     # Run ESLint
```

## Key Flows

### Wallet Connection
1. User connects Solana wallet
2. Signs message to authenticate with backend
3. JWT token stored for API calls

### Position Discovery
1. Fetch all organizations with compressed positions
2. Scan Light Protocol for position accounts
3. Verify ownership using stealth key derivation
4. Display only user's positions

### Claiming Tokens
1. Retrieve stealth keys from Arcium vault
2. Derive stealth keypair for position
3. Sign claim authorization
4. Submit to backend for MPC processing
5. Receive tokens to wallet

## Deployment

### Vercel (Recommended)

1. Connect GitHub repo to Vercel
2. Set Root Directory: `frontend`
3. Framework Preset: Vite
4. Add environment variables

### Manual Build

```bash
bun run build
# Output in dist/ folder
```

## License

MIT
