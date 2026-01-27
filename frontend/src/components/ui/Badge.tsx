import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'accent'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-kage-subtle text-kage-text-muted',
  success: 'bg-kage-success/20 text-kage-success',
  warning: 'bg-kage-warning/20 text-kage-warning',
  error: 'bg-kage-error/20 text-kage-error',
  accent: 'bg-kage-accent-glow text-kage-accent',
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'default', children, className = '', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center px-2 py-0.5
          text-xs font-medium rounded
          ${variants[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </span>
    )
  }
)

Badge.displayName = 'Badge'
