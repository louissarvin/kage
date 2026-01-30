import type { HTMLAttributes } from 'react'
import { forwardRef } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'accent'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-kage-subtle text-kage-text-muted',
  success: 'bg-kage-secondary/20 text-kage-secondary',
  warning: 'bg-kage-text-muted/20 text-kage-text',
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
          text-md font-medium rounded-full
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
