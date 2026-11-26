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
    <div className="min-w-0 border-t border-line-soft py-2" {...rest}>
      <div className="mb-0.5 text-[11px] text-text-faint">{label}</div>
      <div className="truncate font-mono text-[13px] text-text">
        {value}
        {delta && <span className="ml-1.5 text-xs text-text-faint">{delta}</span>}
      </div>
    </div>
  )
}
