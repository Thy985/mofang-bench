import { describe, expect, it, vi } from 'vitest'
import { describeError } from '../lib/errors'
import { toastError } from './toastError'

describe('toastError', () => {
  it('经 describeError 转译后调用 toast.error', () => {
    const toast = { success: vi.fn(), error: vi.fn() }
    const err = new Error('boom')
    toastError(toast, err)
    expect(toast.error).toHaveBeenCalledWith(describeError(err))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
