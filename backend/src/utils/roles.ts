/**
 * Role Utilities
 *
 * Determines user roles based on their on-chain and off-chain data.
 * Roles are contextual - a user can be both employer and employee.
 */

import { prisma } from '../lib/prisma.js'

export type UserRole = 'ADMIN' | 'EMPLOYEE' | 'BOTH' | 'NONE'

export interface UserRoleInfo {
  role: UserRole
  isAdmin: boolean
  isEmployee: boolean
  // Admin context
  organization?: {
    id: string
    pubkey: string
    isActive: boolean
  }
  // Employee context
  links: Array<{
    id: string
    slug: string
    positionsReceived: number
  }>
  positionsCount: number
}

/**
 * Determine user's role(s) in the system
 *
 * - ADMIN: Has created an organization (employer)
 * - EMPLOYEE: Has links for receiving vesting positions
 * - BOTH: Is both an admin and has receiving links
 * - NONE: New user, hasn't set up anything yet
 */
export async function getUserRole(userId: string): Promise<UserRoleInfo> {
  // Check if user is admin of any organization
  const organization = await prisma.organization.findFirst({
    where: { adminUserId: userId },
    select: {
      id: true,
      pubkey: true,
      isActive: true,
    },
  })

  // Check if user has any links (for receiving positions)
  const links = await prisma.userLink.findMany({
    where: { userId, isActive: true },
    select: {
      id: true,
      slug: true,
      positionsReceived: true,
    },
  })

  // Count positions owned by user
  const positionsCount = await prisma.vestingPosition.count({
    where: {
      ownerWalletId: {
        in: (
          await prisma.userWallet.findMany({
            where: { userId },
            select: { id: true },
          })
        ).map((w) => w.id),
      },
    },
  })

  const isAdmin = !!organization
  const isEmployee = links.length > 0 || positionsCount > 0

  let role: UserRole = 'NONE'
  if (isAdmin && isEmployee) {
    role = 'BOTH'
  } else if (isAdmin) {
    role = 'ADMIN'
  } else if (isEmployee) {
    role = 'EMPLOYEE'
  }

  return {
    role,
    isAdmin,
    isEmployee,
    organization: organization || undefined,
    links,
    positionsCount,
  }
}

/**
 * Check if user is admin of a specific organization
 */
export async function isOrganizationAdmin(
  userId: string,
  organizationPubkey: string
): Promise<boolean> {
  const org = await prisma.organization.findFirst({
    where: {
      pubkey: organizationPubkey,
      adminUserId: userId,
    },
  })
  return !!org
}

/**
 * Check if wallet address is admin of any organization
 */
export async function isWalletAdmin(walletAddress: string): Promise<boolean> {
  const org = await prisma.organization.findFirst({
    where: { adminWallet: walletAddress },
  })
  return !!org
}
