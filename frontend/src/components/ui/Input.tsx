import type { InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string | boolean
  success?: boolean
  hint?: string
  prefix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, success, hint, prefix, className = '', ...props }, ref) => {
    const hasError = error === true || (typeof error === 'string' && error.length > 0)
    const errorMessage = typeof error === 'string' ? error : undefined

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-kage-text-muted">
            {label}
          </label>
        )}
        <div className={prefix ? 'relative flex' : ''}>
          {prefix && (
            <span className="inline-flex items-center px-3 text-sm text-kage-text-dim bg-kage-subtle rounded-l-2xl">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            className={`
              w-full px-3 py-2
              bg-kage-elevated border border-kage-border
              text-kage-text placeholder:text-kage-text-dim
              focus:outline-none focus:border-kage-accent-dim
              transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${prefix ? 'rounded-r-2xl' : 'rounded-2xl'}
              ${hasError ? 'border-red-500/50 focus:border-red-500' : ''}
              ${success ? 'border-green-500/50 focus:border-green-500' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {hint && !errorMessage && (
          <p className={`text-xs ${success ? 'text-green-400' : 'text-kage-text-dim'}`}>
            {hint}
          </p>
        )}
        {errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
