import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  back,
  actions,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: string
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      {eyebrow && (
        <div className="w-full text-[11px] font-medium tracking-eyebrow text-text-faint">
          {eyebrow}
        </div>
      )}
      <h1
        className={
          eyebrow
            ? 'text-3xl font-bold tracking-tight md:text-4xl'
            : 'text-2xl font-semibold tracking-[-0.02em]'
        }
      >
        {title}
      </h1>
      {subtitle && (
        <span className="mb-0.5 text-[13px] text-text-dim">{subtitle}</span>
      )}
      {actions && (
        <div className="mb-0.5 ml-auto flex items-center gap-2">{actions}</div>
      )}
      {back && (
        <Link
          className="mb-0.5 text-sm text-text-dim transition-colors duration-fast hover:text-text"
          to={back.to}
        >
          {back.label}
        </Link>
      )}
    </div>
  )
}
