import type { ReactNode } from 'react'
import { forwardRef } from 'react'
import { motion } from 'framer-motion'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  className?: string
  children?: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-kage-accent text-kage-void hover:bg-kage-accent-dim border-transparent',
  secondary:
    'bg-kage-elevated text-kage-text hover:bg-kage-panel border-kage-border hover:border-kage-accent-dim',
  ghost:
    'bg-transparent text-kage-text-muted hover:text-kage-text hover:bg-kage-elevated border-transparent',
  danger:
    'bg-kage-error-dim text-kage-text hover:bg-kage-error border-transparent',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'secondary', size = 'md', loading, children, className = '', disabled, ...props },
    ref
  ) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled || loading ? 1 : 1.01 }}
        whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
        transition={{ duration: 0.15 }}
        className={`
          inline-flex items-center justify-center gap-2
          rounded-md border font-medium
          transition-colors duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variants[variant]}
          ${sizes[size]}
          ${className}
        `}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </motion.button>
    )
  }
)

Button.displayName = 'Button'
