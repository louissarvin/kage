import { PrismaClient } from '@prisma/client'
import { config } from '../config/index.js'

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDev ? ['query', 'error', 'warn'] : ['error'],
  })

if (!config.isProd) {
  globalForPrisma.prisma = prisma
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})
