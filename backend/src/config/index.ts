import 'dotenv/config'

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Solana
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  shadowvestProgramId: process.env.SHADOWVEST_PROGRAM_ID || '3bPHRjdQb1a6uxE5TAVwJRMBCLdjAwsorNKJgwAALGbA',

  // NOTE: Arcium MPC is on-chain - no backend API needed
  // Users interact directly with contract via writeMetaKeysToVault/readMetaKeysFromVault

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '1h',

  // Auth
  authMessagePrefix: 'Sign to authenticate with ShadowVest',
  nonceExpirySeconds: 300, // 5 minutes
  timestampToleranceSeconds: 300, // 5 minutes

  // Rate limiting
  rateLimit: {
    max: 100,
    timeWindow: '1 minute',
  },

  // Environment
  isDev: process.env.NODE_ENV !== 'production',
  isProd: process.env.NODE_ENV === 'production',
} as const

// Validate required config
export function validateConfig() {
  const required = ['DATABASE_URL']
  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}
