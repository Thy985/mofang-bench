import type { HTMLAttributes } from 'react'

const SHADOW =
  'shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]'

export function Card({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface-2 ${SHADOW} ${className}`}
      {...rest}
    />
  )
}
