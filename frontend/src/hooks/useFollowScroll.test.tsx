import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useFollowScroll } from './useFollowScroll'

function Harness({ text }: { text: string }) {
  const { ref, following, onScroll, scrollToBottom } =
    useFollowScroll<HTMLPreElement>(text)
  return (
    <div>
      <pre ref={ref} onScroll={onScroll} data-testid="scroll-box">
        {text}
      </pre>
      <span data-testid="following">{following ? 'yes' : 'no'}</span>
      <button type="button" onClick={scrollToBottom}>
        bottom
      </button>
    </div>
  )
}

function setBoxMetrics(
  box: HTMLElement,
  top: number,
  client: number,
  scroll: number,
) {
  Object.defineProperty(box, 'scrollTop', {
    value: top,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(box, 'clientHeight', {
    value: client,
    configurable: true,
  })
  Object.defineProperty(box, 'scrollHeight', {
    value: scroll,
    configurable: true,
  })
}

describe('useFollowScroll', () => {
  it('初始跟随，内容变化时自动滚到底', () => {
    const { rerender } = render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    rerender(<Harness text="ab" />)
    expect(box.scrollTop).toBe(400)
  })

  it('上滚脱离跟随后内容变化不再滚动，回到底部恢复', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('no')
    rerender(<Harness text="ab" />)
    expect(box.scrollTop).toBe(0)
    await user.click(screen.getByRole('button', { name: 'bottom' }))
    expect(box.scrollTop).toBe(400)
    expect(screen.getByTestId('following')).toHaveTextContent('yes')
  })

  it('手动滚回底部即恢复跟随', () => {
    render(<Harness text="a" />)
    const box = screen.getByTestId('scroll-box')
    setBoxMetrics(box, 0, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('no')
    setBoxMetrics(box, 300, 100, 400)
    fireEvent.scroll(box)
    expect(screen.getByTestId('following')).toHaveTextContent('yes')
  })
})
