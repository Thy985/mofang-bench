import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary:
    'rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
  neutral:
    'rounded border border-line px-3 py-1.5 text-sm text-text hover:bg-surface',
  danger:
    'rounded border border-danger px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-950/40',
  warning:
    'rounded border border-warning px-3 py-1.5 text-sm text-amber-300',
} as const

export type ButtonVariant = keyof typeof VARIANTS

export function Button({
  variant = 'neutral',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${VARIANTS[variant]} ${className}`} {...rest} />
}
