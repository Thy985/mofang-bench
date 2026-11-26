import { statusLabel } from '../lib/format'

// 状态语义：ok = 成功/完成，run = 进行中，warn = 预算/超时/中断，bad = 失败。
const TONES: Record<string, 'ok' | 'run' | 'warn' | 'bad'> = {
  running: 'run',
  queued: 'warn',
  solved: 'ok',
  finished: 'ok',
  failed: 'bad',
  cancelled: 'warn',
  interrupted: 'warn',
  budget_exceeded: 'warn',
  model_truncation_loop: 'warn',
  timeout: 'warn',
  protocol_error: 'bad',
  provider_error: 'bad',
}

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status] ?? 'warn'
  return (
    <span
      data-testid="status-badge"
      data-tone={tone}
      className="status-dot"
    >
      <i aria-hidden />
      {statusLabel(status)}
    </span>
  )
}
