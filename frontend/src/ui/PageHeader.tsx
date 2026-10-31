import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: string
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <span className="text-sm text-text-dim">{subtitle}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      {back && (
        <Link className="text-sm text-text-dim hover:text-text" to={back.to}>
          {back.label}
        </Link>
      )}
    </div>
  )
}
