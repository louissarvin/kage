import type { InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-kage-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3 py-2
            bg-kage-elevated border border-kage-border rounded-md
            text-kage-text placeholder:text-kage-text-dim
            focus:outline-none focus:border-kage-accent-dim
            transition-colors duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-kage-error' : ''}
            ${className}
          `}
          {...props}
        />
        {hint && !error && (
          <p className="text-xs text-kage-text-dim">{hint}</p>
        )}
        {error && <p className="text-xs text-kage-error">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
