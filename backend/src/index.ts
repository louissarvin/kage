/**
 * ShadowVest Backend Entry Point
 */

import { buildApp } from './app.js'
import { config, validateConfig } from './config/index.js'

async function main() {
  // Validate required config
  validateConfig()

  // Build the app
  const app = await buildApp()

  // Start server
  try {
    await app.listen({
      port: config.port,
      host: config.host,
    })

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   ShadowVest Backend                       ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://${config.host}:${config.port}                ║
║  Environment: ${config.isDev ? 'development' : 'production'}                             ║
║  Solana RPC: ${config.solanaRpcUrl.slice(0, 35)}...  ║
╚═══════════════════════════════════════════════════════════╝
    `)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...')
  process.exit(0)
})

main()
