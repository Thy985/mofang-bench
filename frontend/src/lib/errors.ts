import { ApiError } from '../api/client'

const STATUS_LABELS: Record<number, string> = {
  400: '请求不合法',
  404: '未找到该记录',
  409: '请求冲突',
  422: '字段校验未通过',
  502: '上游模型服务不可用',
}

// 后端结构化 detail（如 probe 的 502 {kind, message}）在客户端被 JSON 字符串化，取 message 展示。
function readableDetail(detail: string): string {
  try {
    const parsed: unknown = JSON.parse(detail)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const message = (parsed as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  } catch {
    // 非 JSON detail 原样展示
  }
  return detail
}

export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    // fetch 被拒（后端未启动/不可达）时是 TypeError，不是 ApiError
    return '网络错误：无法访问后端，请确认服务已启动'
  }
  const label = STATUS_LABELS[err.status] ?? '后端返回错误'
  return `${label}（HTTP ${err.status}）：${readableDetail(err.detail)}`
}
