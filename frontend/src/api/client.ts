import type {
  BenchmarkCreate,
  BenchmarkDetail,
  BenchmarkSummary,
  CompareResult,
  Episode,
  ProbeResult,
  Provider,
  ProviderCreate,
  ProviderUpdate,
  Report,
  Run,
  RunCreate,
  Snapshot,
  Step,
} from './types'

const API = '/api'

export class ApiError extends Error {
  // tsconfig 的 erasableSyntaxOnly 禁止构造函数参数属性，故显式声明字段。
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') {
        detail = body.detail
      } else if (body.detail) {
        detail = JSON.stringify(body.detail)
      }
    } catch {
      // 非 JSON 错误体保留状态文本
    }
    throw new ApiError(response.status, detail)
  }
  // 204 无响应体（如 DELETE），直接返回 undefined
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function post(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) }
}

export const api = {
  providers: {
    list: () => request<Provider[]>('/providers'),
    create: (payload: ProviderCreate) =>
      request<Provider>('/providers', post(payload)),
    update: (id: string, payload: ProviderUpdate) =>
      request<Provider>(`/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    remove: (id: string) =>
      request<void>(`/providers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    probe: (id: string) =>
      request<ProbeResult>(
        `/providers/${encodeURIComponent(id)}/probe`,
        { method: 'POST' },
      ),
    setKey: (id: string, apiKey: string) =>
      request<Provider>(`/providers/${encodeURIComponent(id)}/key`, {
        method: 'PUT',
        body: JSON.stringify({ api_key: apiKey }),
      }),
    clearKey: (id: string) =>
      request<Provider>(`/providers/${encodeURIComponent(id)}/key`, {
        method: 'DELETE',
      }),
  },
  benchmarks: {
    list: () => request<BenchmarkSummary[]>('/benchmarks'),
    create: (payload: BenchmarkCreate) =>
      request<BenchmarkDetail>('/benchmarks', post(payload)),
    get: (id: string) =>
      request<BenchmarkDetail>(`/benchmarks/${encodeURIComponent(id)}`),
  },
  runs: {
    list: () => request<Run[]>('/runs'),
    create: (payload: RunCreate) =>
      request<{ id: string }>('/runs', post(payload)),
    get: (id: string) =>
      request<{ run: Run; episodes: Episode[] }>(
        `/runs/${encodeURIComponent(id)}`,
      ),
    snapshot: (id: string) =>
      request<Snapshot>(`/runs/${encodeURIComponent(id)}/snapshot`),
    cancel: (id: string) =>
      request<{ cancelled: boolean }>(
        `/runs/${encodeURIComponent(id)}/cancel`,
        { method: 'POST' },
      ),
    report: (id: string) =>
      request<Report>(`/runs/${encodeURIComponent(id)}/report`),
    eventsUrl: (id: string, after = 0) =>
      `${API}/runs/${encodeURIComponent(id)}/events?after=${after}`,
  },
  episodes: {
    get: (id: string) =>
      request<Episode>(`/episodes/${encodeURIComponent(id)}`),
    steps: (id: string) =>
      request<Step[]>(`/episodes/${encodeURIComponent(id)}/steps`),
  },
  compare: {
    get: (runIds: [string, string]) =>
      request<CompareResult>(
        `/compare?run_ids=${encodeURIComponent(runIds[0])},${encodeURIComponent(runIds[1])}`,
      ),
  },
}

export function exportUrl(runId: string, format: 'csv' | 'md'): string {
  return `${API}/runs/${encodeURIComponent(runId)}/export?format=${format}`
}

export function reportUrl(runId: string): string {
  return `${API}/runs/${encodeURIComponent(runId)}/report`
}
