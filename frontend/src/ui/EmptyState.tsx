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
    <div className="border-t border-line-soft py-16 text-center">
      {icon && <div className="mb-2 text-text-faint">{icon}</div>}
      <p className="mb-1 text-sm text-text">{title}</p>
      {hint && <p className="mb-4 text-[12.5px] text-text-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
