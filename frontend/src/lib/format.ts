import type { ColorName } from '../api/types'

const COLOR_HEX: Record<ColorName, string> = {
  white: '#f8fafc',
  yellow: '#facc15',
  green: '#22c55e',
  blue: '#3b82f6',
  red: '#ef4444',
  orange: '#f97316',
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  finished: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  solved: '已解出',
  stopped_unsolved: '停手未解',
  budget_exceeded: '预算耗尽',
  timeout: '超时',
  protocol_error: '协议错误',
  provider_error: 'provider 错误',
}

export function colorHex(color: ColorName): string {
  return COLOR_HEX[color]
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatPercent(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
