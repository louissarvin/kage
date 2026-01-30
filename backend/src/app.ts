/**
 * ShadowVest Backend Application
 *
 * Fastify server setup with all routes and plugins.
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { config } from './config/index.js'
import { authRoutes } from './routes/auth.js'
import { linkRoutes } from './routes/links.js'
import { stealthRoutes } from './routes/stealth.js'
import { organizationRoutes } from './routes/organizations.js'

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      userId: string
      walletAddress: string
      arciumKeyId?: string
    }
    user: {
      userId: string
      walletAddress: string
      arciumKeyId?: string
    }
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'debug' : 'info',
    },
  })

  // Register CORS
  await app.register(cors, {
    origin: config.isDev
      ? true
      : [config.appUrl, 'https://kage.ink'],
    credentials: true,
  })

  // Register JWT
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: {
      expiresIn: config.jwtExpiry,
    },
  })

  // Register rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
  })

  // Authentication decorator
  app.decorate(
    'authenticate',
    async function (request: any, reply: any) {
      try {
        await request.jwtVerify()
      } catch (err) {
        reply.status(401).send({
          success: false,
          error: 'Unauthorized',
        })
      }
    }
  )

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  // API info
  app.get('/api', async () => ({
    name: 'ShadowVest API',
    version: '0.1.0',
    description: 'Privacy-first vesting protocol backend',
  }))

  // Register routes
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(linkRoutes, { prefix: '/api/links' })
  await app.register(stealthRoutes, { prefix: '/api/stealth' })
  await app.register(organizationRoutes, { prefix: '/api/organizations' })

  // TODO: Add these routes
  // await app.register(positionRoutes, { prefix: '/api/positions' })

  return app
}
