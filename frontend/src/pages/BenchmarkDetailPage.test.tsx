import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type {
  BenchmarkDetail,
  CubeState,
  SelfcheckResult,
} from '../api/types'
import { BenchmarkDetailView } from './BenchmarkDetailPage'

const benchmark: BenchmarkDetail = {
  id: 'e2e-2x2-3',
  name: 'e2e',
  version: 'v1',
  kind: 'frozen',
  cube: '2x2',
  content_hash: 'hash',
  frozen_at: '2026-10-26T00:00:00+00:00',
  task_count: 1,
  tasks: [
    {
      id: 't1',
      cube: '2x2',
      scramble: ['R'],
      scramble_depth: 1,
      state: {
        cube: '2x2',
        faces: {
          U: [], R: [], F: [], D: [], L: [], B: [],
        } as CubeState['faces'],
      },
      reference_length: 1,
      reference_kind: 'exact',
      bin: '1',
    },
  ],
}

function renderView(
  onSelfcheck: () => Promise<SelfcheckResult>,
) {
  return render(
    <MemoryRouter>
      <BenchmarkDetailView benchmark={benchmark} onSelfcheck={onSelfcheck} />
    </MemoryRouter>,
  )
}

describe('BenchmarkDetailView selfcheck', () => {
  it('自检通过显示成功横幅与逐题结果', async () => {
    const user = userEvent.setup()
    const onSelfcheck = vi.fn().mockResolvedValue({
      ok: true,
      checked: 1,
      items: [{ task_id: 't1', ok: true, moves: 1, detail: '' }],
    })
    renderView(onSelfcheck)
    await user.click(screen.getByTestId('selfcheck-button'))
    const result = await screen.findByTestId('selfcheck-result')
    expect(result).toHaveTextContent('自检通过')
    expect(screen.getByTestId('selfcheck-row')).toHaveTextContent('t1')
    expect(onSelfcheck).toHaveBeenCalledTimes(1)
  })

  it('自检失败显示问题横幅与说明', async () => {
    const user = userEvent.setup()
    const onSelfcheck = vi.fn().mockResolvedValue({
      ok: false,
      checked: 1,
      items: [
        {
          task_id: 't1',
          ok: false,
          moves: 2,
          detail: '参照解经工具链执行后未还原（状态引擎或工具链有 bug）',
        },
      ],
    })
    renderView(onSelfcheck)
    await user.click(screen.getByTestId('selfcheck-button'))
    const result = await screen.findByTestId('selfcheck-result')
    expect(result).toHaveTextContent('自检发现问题')
    expect(result).toHaveTextContent('未还原')
  })

  it('自检请求失败显示错误横幅', async () => {
    const user = userEvent.setup()
    // 非 ApiError 的异常会被 describeError 统一转成网络错误文案
    const onSelfcheck = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    renderView(onSelfcheck)
    await user.click(screen.getByTestId('selfcheck-button'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络错误：无法访问后端',
    )
    expect(screen.queryByTestId('selfcheck-result')).not.toBeInTheDocument()
  })
})
