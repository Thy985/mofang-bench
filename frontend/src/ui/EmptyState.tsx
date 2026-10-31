import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-2/50 px-6 py-12 text-center">
      {icon && <div className="text-text-dim">{icon}</div>}
      <p className="text-sm text-text">{title}</p>
      {hint && <p className="text-xs text-text-dim">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
