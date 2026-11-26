import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

const VARIANTS = {
  primary:
    'border-transparent bg-accent font-semibold text-on-accent hover:bg-accent-dim',
  secondary:
    'border-line text-text hover:border-[#333a43] hover:bg-surface hover:text-text-strong',
  ghost:
    'border-transparent text-text-dim hover:bg-surface hover:text-text-strong',
  danger:
    'border-danger text-danger hover:bg-danger/10',
  warning:
    'border-warning text-warning hover:bg-warning/10',
} as const

export type ButtonVariant = keyof typeof VARIANTS

const SIZES = {
  sm: 'h-7 rounded-md px-2.5 text-xs',
  md: 'h-8 rounded-md px-3 text-[13px]',
} as const

export type ButtonSize = keyof typeof SIZES

const FOCUS =
  'transition-colors duration-fast ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
      className={`inline-flex items-center justify-center gap-1.5 border whitespace-nowrap ${VARIANTS[variant]} ${SIZES[size]} ${FOCUS} disabled:pointer-events-none disabled:opacity-40 ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner className="mr-1 align-[-2px]" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  )
}
