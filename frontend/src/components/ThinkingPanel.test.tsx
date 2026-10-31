import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThinkingPanel } from './ThinkingPanel'

describe('ThinkingPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('渲染思考文本，复制成功后短暂显示已复制', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // shouldAdvanceTime：user-event 内部等待依赖真实时钟推进，纯假时钟会让 click 永久挂起
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<ThinkingPanel text="思考全文" />)
    expect(screen.getByTestId('thinking-panel')).toHaveTextContent(
      '思考全文',
    )
    await user.click(screen.getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('思考全文')
    expect(
      screen.getByRole('button', { name: '已复制' }),
    ).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('上滚出现回到底部浮标，点击恢复跟随并滚底', () => {
    render(<ThinkingPanel text="内容" />)
    const pre = screen.getByTestId('thinking-panel')
      .querySelector('pre') as HTMLElement
    Object.defineProperty(pre, 'scrollTop', {
      value: 0,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(pre, 'clientHeight', {
      value: 100,
      configurable: true,
    })
    Object.defineProperty(pre, 'scrollHeight', {
      value: 400,
      configurable: true,
    })
    fireEvent.scroll(pre)
    expect(screen.getByTestId('thinking-follow')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('thinking-follow'))
    expect(pre.scrollTop).toBe(400)
    expect(screen.queryByTestId('thinking-follow')).not.toBeInTheDocument()
  })

  it('折叠状态跨内容更新保持（组件自持，不清空）', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ThinkingPanel text="第一段" />)
    await user.click(screen.getByText('思考中…'))
    rerender(<ThinkingPanel text="第二段" />)
    expect(screen.getByTestId('thinking-panel')).not.toHaveAttribute('open')
  })
})
