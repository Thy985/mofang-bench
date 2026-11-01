import type { HTMLAttributes } from 'react'

const TONES = {
  danger: 'border-danger bg-rose-950/40 text-rose-300',
  success: 'border-accent bg-accent-soft/40 text-accent',
  info: 'border-line bg-surface text-text',
} as const

export function Alert({
  tone = 'danger',
  className = '',
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & {
  tone?: keyof typeof TONES
}) {
  return <p role="alert" className={`rounded border p-3 text-sm ${TONES[tone]} ${className}`} {...rest} />
}
