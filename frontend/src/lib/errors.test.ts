import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { describeProbeError } from './errors'

describe('describeProbeError', () => {
  it('unwraps kind and message from the 502 dict detail', () => {
    const err = new ApiError(
      502,
      JSON.stringify({ kind: 'connection', message: 'connection refused' }),
    )
    expect(describeProbeError(err)).toEqual({
      kind: 'connection',
      text: 'connection refused',
    })
  })

  it('falls back to describeError when detail has no kind', () => {
    const err = new ApiError(400, 'base_url must be http(s)')
    const result = describeProbeError(err)
    expect(result.kind).toBeNull()
    expect(result.text).toBe('请求不合法（HTTP 400）：base_url must be http(s)')
  })

  it('maps network failure to the Chinese message', () => {
    expect(describeProbeError(new TypeError('Failed to fetch'))).toEqual({
      kind: null,
      text: '网络错误：无法访问后端，请确认服务已启动',
    })
  })
})
