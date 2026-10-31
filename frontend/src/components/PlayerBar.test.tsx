import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Step } from '../api/types'
import type { Playback } from '../hooks/usePlayback'
import { PlayerBar } from './PlayerBar'

const steps = [
  { id: 's0', seq: 0, kind: 'model_message', tool_name: null },
  { id: 's1', seq: 1, kind: 'tool_result', tool_name: 'apply_moves' },
] as unknown as Step[]

function playbackFixture(overrides: Partial<Playback> = {}): Playback {
  return {
    active: 1,
    playing: false,
    speed: 1,
    viewState: null,
    batch: null,
    resetToken: 1,
    select: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stepPrev: vi.fn(),
    stepNext: vi.fn(),
    setSpeed: vi.fn(),
    handleBatchComplete: vi.fn(),
    ...overrides,
  }
}

describe('PlayerBar', () => {
  it('显示当前步指示与初始局面', () => {
    render(<PlayerBar playback={playbackFixture()} steps={steps} />)
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '#1 tool_result',
    )
    const scrubber = screen.getByTestId('playback-scrubber')
    expect(scrubber).toHaveAttribute('min', '-1')
    expect(scrubber).toHaveAttribute('max', '1')
  })

  it('active=-1 时显示初始局面', () => {
    render(
      <PlayerBar
        playback={playbackFixture({ active: -1 })}
        steps={steps}
      />,
    )
    expect(screen.getByTestId('playback-position')).toHaveTextContent(
      '初始局面',
    )
  })

  it('播放按钮在播放/暂停间切换，步进与选择回调生效', async () => {
    const user = userEvent.setup()
    const playback = playbackFixture()
    const { rerender } = render(
      <PlayerBar playback={playback} steps={steps} />,
    )
    await user.click(screen.getByRole('button', { name: '播放' }))
    expect(playback.play).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(playback.stepPrev).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(playback.stepNext).toHaveBeenCalled()
    const playing = playbackFixture({ playing: true })
    rerender(<PlayerBar playback={playing} steps={steps} />)
    await user.click(screen.getByRole('button', { name: '暂停' }))
    expect(playing.pause).toHaveBeenCalled()
  })

  it('scrubber 拖动与速度选择回调', async () => {
    const playback = playbackFixture()
    render(<PlayerBar playback={playback} steps={steps} />)
    const scrubber = screen.getByTestId('playback-scrubber')
    fireEvent.change(scrubber, { target: { value: '0' } })
    expect(playback.select).toHaveBeenCalledWith(0)
    fireEvent.change(screen.getByLabelText('播放速度'), {
      target: { value: '2' },
    })
    expect(playback.setSpeed).toHaveBeenCalledWith(2)
  })
})
