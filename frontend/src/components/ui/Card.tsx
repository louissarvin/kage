import type { HTMLAttributes } from 'react'
import type { HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'
import { motion } from 'framer-motion'

interface CardProps extends Omit<HTMLMotionProps<'div'>, 'ref'> {
  variant?: 'default' | 'elevated' | 'interactive'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', children, className = '', ...props }, ref) => {
    const baseStyles = 'rounded-lg border border-kage-border-subtle'

    const variantStyles = {
      default: 'bg-kage-surface',
      elevated: 'bg-kage-elevated',
      interactive:
        'bg-kage-surface hover:bg-kage-elevated hover:border-kage-border cursor-pointer',
    }

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={`${baseStyles} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </motion.div>
    )
  }
)

Card.displayName = 'Card'

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ children, className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={`px-6 py-4 border-b border-kage-border-subtle ${className}`}
    {...props}
  >
    {children}
  </div>
))

CardHeader.displayName = 'CardHeader'

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ children, className = '', ...props }, ref) => (
  <div ref={ref} className={`px-6 py-4 ${className}`} {...props}>
    {children}
  </div>
))

CardContent.displayName = 'CardContent'

export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ children, className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={`px-6 py-4 border-t border-kage-border-subtle ${className}`}
    {...props}
  >
    {children}
  </div>
))

CardFooter.displayName = 'CardFooter'
