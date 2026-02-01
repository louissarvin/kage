# Kage

**Privacy-First Payroll & Vesting Protocol on Solana**

Kage enables confidential payroll and token vesting where salary amounts remain encrypted, employee identities stay private, and claims are unlinkable to employers.

## Overview

Kage combines four cutting-edge privacy technologies:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **L1** | [Light Protocol](https://zkcompression.com) | ZK Compression (5000x cost reduction) |
| **L2** | [Arcium MPC](https://arcium.com) | Confidential computation (encrypted amounts) |
| **L3** | Stealth Addresses | One-time receiver addresses (receiver privacy) |
| **L4** | Ed25519 Signatures | Claim authorization |

## Key Features

- **Private Salaries**: Vesting amounts are encrypted via Arcium MPC - only the recipient can decrypt
- **Anonymous Recipients**: Stealth addresses ensure employers can't track where funds go
- **Cost Efficient**: Light Protocol compression reduces on-chain costs by 5000x
- **Flexible Vesting**: Customizable schedules with cliff periods and linear vesting

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Employer  │     │  Employee   │     │   Auditor   │
│  (Creator)  │     │ (Recipient) │     │  (Verifier) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌───────────────────────────────────────────────────────┐
│                     Kage Protocol                      │
│                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │  Light   │  │  Arcium  │  │     Stealth      │    │
│  │ Protocol │◄─┤   MPC    │◄─┤    Addresses     │    │
│  │(compress)│  │(compute) │  │    (privacy)     │    │
│  └──────────┘  └──────────┘  └──────────────────┘    │
└───────────────────────────────────────────────────────┘
```

## Project Structure

```
kage/
├── contract/          # Solana smart contract (Anchor + Arcium)
├── backend/           # API server (Fastify + Prisma)
├── frontend/          # Web app (React + Vite)
└── ARCHITECTURE.md    # Detailed technical documentation
```

## Quick Start

### Prerequisites

- Node.js 20+
- Bun or npm
- Rust & Anchor CLI (for contract development)
- Solana CLI

### Backend

```bash
cd backend
bun install
cp .env.example .env  # Configure environment
bun run db:push       # Setup database
bun run dev           # Start development server
```

### Frontend

```bash
cd frontend
bun install
bun run dev           # Start at http://localhost:5173
```

### Contract

```bash
cd contract
anchor build
anchor test
anchor deploy
```

## How It Works

### 1. Organization Setup
Employer creates an organization and funds the vault with tokens.

### 2. Position Creation
Employer creates vesting positions for employees using stealth addresses:
- Amount is encrypted via Arcium MPC
- Recipient is a one-time stealth address
- Position stored as compressed account (Light Protocol)

### 3. Claim Flow
Employee claims vested tokens:
1. Derives stealth keypair from their meta-address
2. Signs claim authorization
3. Backend processes MPC computation
4. Tokens transferred to employee's wallet

## Tech Stack

| Component | Technology |
|-----------|------------|
| Blockchain | Solana |
| Smart Contract | Anchor Framework |
| Compression | Light Protocol |
| Privacy | Arcium MPC |
| Backend | Fastify, Prisma, PostgreSQL |
| Frontend | React, Vite, TailwindCSS |
| Wallet | Solana Wallet Adapter |

## Deployments

| Network | Program ID |
|---------|------------|
| Devnet | `3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA` |

## Links

- **Live App**: [kage.ink](https://kage.ink)
- **Backend API**: [kage-production.up.railway.app](https://kage-production.up.railway.app)

## License

MIT
