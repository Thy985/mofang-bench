import type { HTMLAttributes, ReactNode } from 'react'

export function Stat({
  label,
  value,
  delta,
  ...rest
}: {
  label: string
  value: ReactNode
  delta?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="rounded-lg border border-line bg-surface-2 px-3 py-2"
      {...rest}
    >
      <div className="text-xs text-text-dim">{label}</div>
      <div className="font-mono text-sm text-text-strong">
        {value}
        {delta && <span className="ml-1.5 text-xs text-text-dim">{delta}</span>}
      </div>
    </div>
  )
}
