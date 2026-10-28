import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { CubeState, Episode, Step } from '../api/types'
import { EpisodeView } from './EpisodePage'

// 页面模块静态导入 CubeView → three；用例不渲染 3D，mock 掉避免把 three 带进 jsdom。
vi.mock('../cube/CubeView', () => ({
  CubeView: () => <div data-testid="cube-stub" />,
}))

const state: CubeState = {
  cube: '2x2',
  faces: {
    U: [['white', 'white'], ['white', 'white']],
    R: [['red', 'red'], ['red', 'red']],
    F: [['green', 'green'], ['green', 'green']],
    D: [['yellow', 'yellow'], ['yellow', 'yellow']],
    L: [['orange', 'orange'], ['orange', 'orange']],
    B: [['blue', 'blue'], ['blue', 'blue']],
  },
}

const episode: Episode = {
  id: 'e1',
  run_id: 'r1',
  task_id: 'b1:t1',
  task_key: 't1',
  status: 'solved',
  solved: true,
  moves_used: 1,
  reference_length: 1,
  efficiency: 1,
  progress_ratio: 1,
  protocol_errors: 0,
  tokens_in: 10,
  tokens_out: 5,
  latency_ms: 1000,
  failure_code: null,
  error: null,
  started_at: '2026-10-26T00:00:00+00:00',
  finished_at: '2026-10-26T00:00:01+00:00',
}

const steps: Step[] = [
  {
    id: 's1',
    seq: 0,
    kind: 'model_message',
    tool_name: null,
    arguments: { tool_calls: ['apply_moves'] },
    result: { content: 'solving' },
    state,
    reference_length_after: 1,
  },
  {
    id: 's2',
    seq: 1,
    kind: 'tool_result',
    tool_name: 'apply_moves',
    arguments: { moves: ["R'"] },
    result: { applied: ["R'"], state },
    state,
    reference_length_after: 0,
  },
]

describe('EpisodeView', () => {
  it('lists steps, selects one and plays its moves', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPlayBatch = vi.fn()
    render(
      <MemoryRouter>
        <EpisodeView
          episode={episode}
          steps={steps}
          selected={1}
          onSelect={onSelect}
          onPlayBatch={onPlayBatch}
          cube={<div data-testid="cube-stub" />}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('cube-stub')).toBeInTheDocument()
    expect(screen.getAllByTestId('step-row')).toHaveLength(2)
    expect(screen.getAllByTestId('step-row')[0]).toHaveTextContent(
      'model_message',
    )
    await user.click(screen.getAllByTestId('step-row')[1])
    expect(onSelect).toHaveBeenCalledWith(1)
    await user.click(
      screen.getByRole('button', { name: '播放本步' }),
    )
    expect(onPlayBatch).toHaveBeenCalledWith(1, ["R'"], state)
  })
})
