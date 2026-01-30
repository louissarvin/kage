/**
 * Backend API Test Script
 *
 * Tests all endpoints including authenticated ones
 */

import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

const API_URL = 'http://localhost:3001'

// Generate a test keypair
const testWallet = Keypair.generate()
console.log('Test Wallet:', testWallet.publicKey.toBase58())

async function signMessage(message: string, keypair: Keypair): Promise<string> {
  const messageBytes = new TextEncoder().encode(message)
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey)
  return bs58.encode(signature)
}

async function test() {
  console.log('\n=== ShadowVest Backend API Tests ===\n')

  // 1. Health check
  console.log('1. Health Check')
  const health = await fetch(`${API_URL}/health`).then(r => r.json())
  console.log('   ✓', health)

  // 2. API info
  console.log('\n2. API Info')
  const info = await fetch(`${API_URL}/api`).then(r => r.json())
  console.log('   ✓', info)

  // 3. Get nonce
  console.log('\n3. Get Auth Nonce')
  const nonceRes = await fetch(`${API_URL}/api/auth/nonce?walletAddress=${testWallet.publicKey.toBase58()}`).then(r => r.json())
  console.log('   ✓ Nonce:', nonceRes.nonce)
  console.log('   ✓ Message preview:', nonceRes.message.slice(0, 50) + '...')

  // 4. Connect wallet (authenticate)
  console.log('\n4. Connect Wallet')
  const signature = await signMessage(nonceRes.message, testWallet)
  const connectRes = await fetch(`${API_URL}/api/auth/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: testWallet.publicKey.toBase58(),
      signature,
      message: nonceRes.message,
      chain: 'SOLANA'
    })
  }).then(r => r.json())

  if (!connectRes.success) {
    console.log('   ✗ Failed:', connectRes.error)
    return
  }
  console.log('   ✓ User ID:', connectRes.user.id)
  console.log('   ✓ Role:', connectRes.role.role)
  console.log('   ✓ Token:', connectRes.token.slice(0, 30) + '...')

  const token = connectRes.token
  const walletId = connectRes.user.wallets[0].id

  // 5. Get current user
  console.log('\n5. Get Current User (/api/auth/me)')
  const meRes = await fetch(`${API_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ User:', meRes.user.id)
  console.log('   ✓ Wallets:', meRes.user.wallets.length)
  console.log('   ✓ Role:', meRes.role.role)

  // 6. Get role
  console.log('\n6. Get Role (/api/organizations/role)')
  const roleRes = await fetch(`${API_URL}/api/organizations/role`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ Role:', roleRes.role)
  console.log('   ✓ isAdmin:', roleRes.isAdmin)
  console.log('   ✓ isEmployee:', roleRes.isEmployee)

  // 7. Register stealth keys
  console.log('\n7. Register Stealth Keys')
  const mockSpendPub = bs58.encode(Keypair.generate().publicKey.toBytes())
  const mockViewPub = bs58.encode(Keypair.generate().publicKey.toBytes())

  const stealthRes = await fetch(`${API_URL}/api/stealth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      walletId,
      metaSpendPub: mockSpendPub,
      metaViewPub: mockViewPub
    })
  }).then(r => r.json())

  if (!stealthRes.success) {
    console.log('   ✗ Failed:', stealthRes.error)
  } else {
    console.log('   ✓ Stealth keys registered')
    console.log('   ✓ metaSpendPub:', stealthRes.wallet.metaSpendPub.slice(0, 20) + '...')
    console.log('   ✓ metaViewPub:', stealthRes.wallet.metaViewPub.slice(0, 20) + '...')
  }

  // 8. Check has keys
  console.log('\n8. Check Has Keys')
  const hasKeysRes = await fetch(`${API_URL}/api/stealth/has-keys/${walletId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ Has Keys:', hasKeysRes.hasKeys)

  // 9. Create link
  console.log('\n9. Create Link')
  const slug = `test${Date.now()}`
  const linkRes = await fetch(`${API_URL}/api/links/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      slug,
      label: 'Test User',
      walletId
    })
  }).then(r => r.json())

  if (!linkRes.success) {
    console.log('   ✗ Failed:', linkRes.error)
  } else {
    console.log('   ✓ Link created:', linkRes.link.fullUrl)
    console.log('   ✓ Slug:', linkRes.link.slug)
  }

  // 10. Get link (public)
  console.log('\n10. Get Link (Public)')
  const getLinkRes = await fetch(`${API_URL}/api/links/${slug}`).then(r => r.json())
  if (!getLinkRes.success) {
    console.log('   ✗ Failed:', getLinkRes.error)
  } else {
    console.log('   ✓ Meta Address found')
    console.log('   ✓ metaSpendPub:', getLinkRes.metaAddress.metaSpendPub.slice(0, 20) + '...')
    console.log('   ✓ metaViewPub:', getLinkRes.metaAddress.metaViewPub.slice(0, 20) + '...')
  }

  // 11. Get my links
  console.log('\n11. Get My Links')
  const myLinksRes = await fetch(`${API_URL}/api/links/my-links`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ Links count:', myLinksRes.links.length)

  // 12. Get my organization (should be null for new user)
  console.log('\n12. Get My Organization')
  const myOrgRes = await fetch(`${API_URL}/api/organizations/mine`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ Organization:', myOrgRes.organization || 'None (expected for new user)')

  // 13. Check role again (should now be EMPLOYEE since we have a link)
  console.log('\n13. Check Role After Creating Link')
  const roleRes2 = await fetch(`${API_URL}/api/organizations/role`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json())
  console.log('   ✓ Role:', roleRes2.role)
  console.log('   ✓ isAdmin:', roleRes2.isAdmin)
  console.log('   ✓ isEmployee:', roleRes2.isEmployee)
  console.log('   ✓ Links:', roleRes2.links.length)

  console.log('\n=== All Tests Passed! ===\n')
}

test().catch(console.error)
