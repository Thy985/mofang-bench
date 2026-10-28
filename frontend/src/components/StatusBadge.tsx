import { statusLabel } from '../lib/format'

const COLORS: Record<string, string> = {
  running: 'bg-sky-900/60 text-sky-300',
  queued: 'bg-slate-800 text-slate-300',
  solved: 'bg-emerald-900/60 text-emerald-300',
  finished: 'bg-emerald-900/60 text-emerald-300',
  failed: 'bg-rose-900/60 text-rose-300',
  cancelled: 'bg-amber-900/60 text-amber-300',
  interrupted: 'bg-amber-900/60 text-amber-300',
  budget_exceeded: 'bg-amber-900/60 text-amber-300',
  timeout: 'bg-amber-900/60 text-amber-300',
  protocol_error: 'bg-rose-900/60 text-rose-300',
  provider_error: 'bg-rose-900/60 text-rose-300',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid="status-badge"
      className={`rounded px-2 py-0.5 text-xs ${
        COLORS[status] ?? 'bg-slate-800 text-slate-300'
      }`}
    >
      {statusLabel(status)}
    </span>
  )
}
