import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-dim',
  secondary: 'border border-line text-text hover:bg-surface',
  ghost: 'text-text-dim hover:bg-surface hover:text-text',
  danger: 'border border-danger text-rose-300 hover:bg-rose-950/40',
  warning: 'border border-warning text-amber-300 hover:bg-amber-950/40',
} as const

export type ButtonVariant = keyof typeof VARIANTS

const SIZES = {
  sm: 'rounded-md px-2.5 py-1 text-xs',
  md: 'rounded-md px-3 py-1.5 text-sm',
} as const

export type ButtonSize = keyof typeof SIZES

const FOCUS =
  'transition-colors duration-fast ease-standard focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      className={`${VARIANTS[variant]} ${SIZES[size]} ${FOCUS} disabled:opacity-50 disabled:pointer-events-none ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner className="mr-1.5 align-[-2px]" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  )
}
