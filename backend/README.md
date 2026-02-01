# Kage Backend

**API Server for Kage Protocol**

A Fastify-based backend that handles authentication, position management, and Arcium MPC claim processing.

## Tech Stack

- **Fastify** - High-performance web framework
- **Prisma** - Database ORM
- **PostgreSQL** - Database (Supabase)
- **Solana Web3.js** - Blockchain interactions
- **Light Protocol SDK** - ZK compression
- **Arcium Client** - MPC computation

## Features

- **JWT Authentication** - Wallet-based auth with signature verification
- **Organization Management** - Create orgs, manage vesting schedules
- **Position Creation** - Stealth address generation, compressed positions
- **Claim Processing** - MPC-based claim verification and token transfer
- **Link System** - Shareable claim links for employees

## Getting Started

### Prerequisites

- Node.js 20+ or Bun
- PostgreSQL database (or Supabase)
- Solana wallet for service transactions

### Installation

```bash
# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Generate Prisma client
bun run db:generate

# Push schema to database
bun run db:push

# Start development server
bun run dev
```

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/kage"

# Solana
SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"
SHADOWVEST_PROGRAM_ID="3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA"
SERVICE_KEYPAIR="base58_encoded_secret_key"
LIGHT_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"

# Arcium MPC
ARCIUM_CLUSTER_OFFSET="456"

# JWT
JWT_SECRET="your-secure-secret"
JWT_EXPIRY="24h"

# Application
APP_URL="https://kage.ink"
PORT=3001
HOST="0.0.0.0"
```

## Project Structure

```
src/
├── index.ts           # Server entry point
├── app.ts             # Fastify app setup
├── config/            # Configuration
├── routes/            # API routes
│   ├── auth.ts        # Authentication endpoints
│   ├── organizations.ts # Organization management
│   ├── positions.ts   # Position CRUD
│   ├── links.ts       # Claim link management
│   └── stealth.ts     # Stealth key operations
├── lib/               # Core libraries
│   ├── solana.ts      # Solana connection
│   ├── claimProcessor.ts  # MPC claim processing
│   └── stealth.ts     # Stealth address utilities
└── middleware/        # Auth, rate limiting
```

## API Endpoints

### Authentication
- `POST /auth/challenge` - Get sign-in challenge
- `POST /auth/verify` - Verify signature, get JWT
- `GET /auth/me` - Get current user

### Organizations
- `GET /organizations` - List user's organizations
- `POST /organizations` - Create organization
- `GET /organizations/:id` - Get organization details

### Positions
- `GET /positions` - List positions
- `POST /positions` - Create position (with stealth address)
- `GET /positions/:id` - Get position details

### Links
- `GET /links` - List user's claim links
- `POST /links` - Create claim link
- `GET /links/:slug` - Resolve claim link

### Stealth
- `GET /stealth/ephemeral-key` - Get ephemeral key for position
- `GET /stealth/payload` - Get encrypted payload for claim

### Claims
- `POST /claims/process` - Process claim via MPC

## Scripts

```bash
bun run dev        # Development with hot reload
bun run build      # Compile TypeScript
bun run start      # Production server
bun run db:generate # Generate Prisma client
bun run db:push    # Push schema changes
bun run db:studio  # Open Prisma Studio
```

## Deployment

### Railway (Recommended)

1. Connect GitHub repo
2. Set Root Directory: `backend`
3. Build Command: `bun run build`
4. Start Command: `bun run start`
5. Add environment variables

### Manual

```bash
bun run build
NODE_ENV=production bun run start
```

## Database Schema

Key models:
- **User** - Wallet addresses and stealth keys
- **Organization** - Companies with vesting programs
- **VestingSchedule** - Schedule configurations
- **Position** - Individual vesting positions
- **Link** - Shareable claim links
- **ClaimJob** - MPC claim processing queue

## Security

- JWT tokens expire after 24h
- Rate limiting on all endpoints
- CORS restricted to APP_URL
- Service keypair stored as env variable (not in code)

## License

MIT
