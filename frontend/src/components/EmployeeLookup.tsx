/**
 * Employee Lookup Component
 *
 * Allows admins to look up employees by their kage.ink link
 * to get their stealth meta-address for position creation.
 */

import { useState, type FC } from 'react'
import { Search, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, Button, Input } from '@/components/ui'
import { useLookupEmployee } from '@/hooks'

interface EmployeeLookupProps {
  onSelect?: (employee: {
    slug: string
    label: string | null
    metaAddress: {
      metaSpendPub: string
      metaViewPub: string
    }
  }) => void
}

export const EmployeeLookup: FC<EmployeeLookupProps> = ({ onSelect }) => {
  const { employee, loading, error, lookup, clear } = useLookupEmployee()
  const [slug, setSlug] = useState('')

  const handleLookup = async () => {
    if (!slug) return
    await lookup(slug)
  }

  const handleSelect = () => {
    if (employee && onSelect) {
      onSelect(employee)
      clear()
      setSlug('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLookup()
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold text-kage-text">Find Employee</h3>
        <p className="text-sm text-kage-text-muted">
          Look up an employee by their kage.ink username
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search input */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              placeholder="username"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              onKeyDown={handleKeyDown}
              prefix="kage.ink/"
            />
          </div>
          <Button
            variant="secondary"
            onClick={handleLookup}
            disabled={!slug || loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Result */}
        {employee && (
          <div className="p-4 rounded-xl bg-kage-subtle">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium text-kage-text">
                    {employee.label || employee.slug}
                  </p>
                  <p className="text-sm text-kage-accent font-mono">
                    kage.ink/{employee.slug}
                  </p>
                </div>
              </div>
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>

            {/* Select button */}
            {onSelect && (
              <Button
                variant="primary"
                className="w-full mt-4"
                onClick={handleSelect}
              >
                Select Employee
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
