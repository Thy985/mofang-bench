import type { HTMLAttributes } from 'react'

const TONES = {
  danger: 'border-danger bg-danger/10 text-rose-300',
  success: 'border-accent/40 bg-accent-soft text-accent',
  info: 'border-line bg-surface text-text',
} as const

export function Alert({
  tone = 'danger',
  className = '',
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & {
  tone?: keyof typeof TONES
}) {
  return (
    <p
      role="alert"
      className={`rounded-[7px] border p-3 text-sm ${TONES[tone]} ${className}`}
      {...rest}
    />
  )
}
