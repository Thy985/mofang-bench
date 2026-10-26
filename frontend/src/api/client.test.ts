import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, exportUrl, reportUrl } from './client'
import type { ProviderCreate } from './types'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function nonJsonResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async (): Promise<unknown> => {
      throw new SyntaxError('body is not json')
    },
  } as Response
}

async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  const reason: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(reason).toBeInstanceOf(ApiError)
  return reason as ApiError
}

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('api client', () => {
  it('GETs and parses JSON', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'p1' }]))
    const providers = await api.providers.list()
    expect(providers).toEqual([{ id: 'p1' }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/providers')
  })

  it('POSTs JSON bodies', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'p1' }, 201))
    const payload: ProviderCreate = {
      name: 'local',
      base_url: 'http://localhost:20128/v1',
      model: 'm',
      api_key_ref: 'LOCAL_KEY',
      params: {},
    }
    await api.providers.create(payload)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/providers')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('normalizes structured errors', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: {
            message: 'benchmark already exists',
            id: 'dup-2x2-3',
          },
        },
        409,
      ),
    )
    await expect(
      api.benchmarks.create({
        name: 'dup',
        cube: '2x2',
        depths: [1],
        per_depth: 1,
        seed: 3,
        solver: 'table',
      }),
    ).rejects.toMatchObject({
      status: 409,
      detail: expect.stringContaining('benchmark already exists'),
    })
  })

  it('builds export and report urls', () => {
    expect(exportUrl('r1', 'csv')).toBe('/api/runs/r1/export?format=csv')
    expect(reportUrl('r1')).toBe('/api/runs/r1/report')
    expect(api.runs.eventsUrl('r1', 7)).toBe('/api/runs/r1/events?after=7')
  })

  it('throws ApiError with the detail as the message', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: 'run not found' }, 404),
    )
    const error = await captureApiError(api.runs.get('missing'))
    expect(error.status).toBe(404)
    expect(error.detail).toBe('run not found')
    expect(error.message).toBe('run not found')
    expect(error.name).toBe('ApiError')
  })

  // 错误归一化只取 detail，其余响应体不得进入异常消息，否则会流到 UI 与日志。
  it('drops response body fields beside detail', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { detail: 'invalid budget', echo: 'must-not-reach-the-ui' },
        400,
      ),
    )
    const error = await captureApiError(api.runs.snapshot('r1'))
    expect(error.status).toBe(400)
    expect(error.detail).toBe('invalid budget')
    expect(error.message).not.toContain('must-not-reach-the-ui')
  })

  it('falls back to status text when the error body is not json', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(nonJsonResponse(502, 'Bad Gateway'))
    const error = await captureApiError(api.benchmarks.get('b1'))
    expect(error.status).toBe(502)
    expect(error.detail).toBe('Bad Gateway')

    fetchMock.mockResolvedValueOnce(nonJsonResponse(500, ''))
    const empty = await captureApiError(api.episodes.get('e1'))
    expect(empty.detail).toBe('HTTP 500')
  })

  it('sends no body to action endpoints', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse({ cancelled: true }))
    await api.runs.cancel('r1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/runs/r1/cancel')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, tool_calling: true }),
    )
    await api.providers.probe('p1')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/providers/p1/probe')
  })

  it('reaches every endpoint through /api', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(jsonResponse([]))
    await api.benchmarks.list()
    await api.episodes.get('e1')
    await api.episodes.steps('e1')
    await api.runs.list()
    await api.runs.report('r1')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/benchmarks',
      '/api/episodes/e1',
      '/api/episodes/e1/steps',
      '/api/runs',
      '/api/runs/r1/report',
    ])
  })
})
