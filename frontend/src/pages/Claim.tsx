import type { FC } from 'react'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Layout } from '@/components/layout'

/**
 * Claim Page - Redirects to Positions
 *
 * This page previously had a step-by-step wizard for claiming tokens.
 * The claim functionality has been consolidated into the Positions page
 * which provides a unified experience for viewing and claiming positions.
 *
 * For MVP, we redirect to Positions. Post-MVP, consider rebuilding
 * the wizard UX using a shared claim hook.
 */
export const Claim: FC = () => {
  const navigate = useNavigate()
  const params = useParams<{ org?: string; slug?: string }>()

  useEffect(() => {
    // Redirect to positions page
    // If we have org/slug params, could pass as query params for filtering
    const searchParams = new URLSearchParams()
    if (params.org) {
      searchParams.set('org', params.org)
    }
    if (params.slug) {
      searchParams.set('slug', params.slug)
    }

    const queryString = searchParams.toString()
    const destination = queryString ? `/positions?${queryString}` : '/positions'

    navigate(destination, { replace: true })
  }, [navigate, params.org, params.slug])

  // Show loading state while redirecting
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 text-kage-accent animate-spin" />
        <p className="text-kage-text-muted">Redirecting to Positions...</p>
      </div>
    </Layout>
  )
}
