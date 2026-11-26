import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AggregateReport, BenchmarkSummary, Provider, Run } from '../api/types'
import { RunsView } from './RunsPage'

const providers: Provider[] = [
  {
    id: 'p1',
    name: 'local',
    base_url: 'http://127.0.0.1:20129/v1',
    model: 'mock-model',
    api_key_ref: '',
    params: {},
    key_configured: true,
    key_stored: true,
    created_at: '2026-10-26T00:00:00+00:00',
  },
  {
    id: 'p2',
    name: 'remote',
    base_url: 'https://api.example.com/v1',
    model: 'gpt',
    api_key_ref: '',
    params: {},
    key_configured: false,
    key_stored: false,
    created_at: '2026-10-26T00:00:00+00:00',
  },
]

const benchmarks: BenchmarkSummary[] = [
  {
    id: 'b1',
    name: 'demo',
    version: 'v1',
    kind: 'frozen',
    cube: '2x2',
    content_hash: 'hash',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 4,
  },
  {
    id: 'b2',
    name: 'other',
    version: 'v1',
    kind: 'frozen',
    cube: '3x3',
    content_hash: 'hash2',
    frozen_at: '2026-10-26T00:00:00+00:00',
    task_count: 1,
  },
]

function aggregate(solveRate: number): AggregateReport {
  return {
    benchmark_id: 'b1',
    benchmark_hash: 'hash',
    benchmark_total_tasks: 4,
    partial: false,
    totals: {
      tasks: 4,
      solved: Math.round(solveRate * 4),
      solve_rate: solveRate,
      ci95: [0, 1],
    },
    by_bin: {},
    episodes: [],
  }
}

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    provider_id: 'p1',
    benchmark_id: 'b1',
    tool_mode: 'both',
    prompt_version: 'v1',
    status: 'finished',
    totals: null,
    error: null,
    created_at: '2026-10-26T00:00:00+00:00',
    started_at: null,
    finished_at: null,
    budget: {
      max_moves: 30,
      max_tool_calls: 50,
      max_tokens: 300000,
      max_seconds: 300,
      turn_timeout: 120,
    },
    ...overrides,
  }
}

const runs: Run[] = [
  makeRun('r-older', {
    created_at: '2026-10-25T00:00:00+00:00',
    status: 'failed',
    provider_id: 'p2',
    totals: aggregate(0.75),
  }),
  makeRun('r-newest', {
    created_at: '2026-10-27T00:00:00+00:00',
    totals: aggregate(0.25),
  }),
  makeRun('r-middle', { totals: aggregate(0.5) }),
]

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="loc">{`${location.pathname}${location.search}`}</span>
}

function renderView(props: Partial<{ runs: Run[] }> = {}, initialEntry = '/runs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RunsView
        runs={props.runs ?? runs}
        providers={providers}
        benchmarks={benchmarks}
      />
      <LocationProbe />
    </MemoryRouter>,
  )
}

function rowIds(): string[] {
  return screen
    .getAllByTestId('run-row')
    .map((row) => within(row).getByRole('link').textContent)
}

describe('RunsView 筛选与排序', () => {
  it('默认全部行按创建时间降序', () => {
    renderView()
    expect(rowIds()).toEqual(['local', 'local', 'remote'])
  })

  it('按 provider 筛选只剩匹配行', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('provider 筛选'), 'p2')
    expect(rowIds()).toEqual(['remote'])
  })

  it('组合筛选无结果出无匹配空态，清除后恢复', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('provider 筛选'), 'p2')
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'finished')
    expect(screen.getByTestId('runs-no-match')).toBeInTheDocument()
    expect(screen.queryByTestId('run-row')).not.toBeInTheDocument()
    await user.click(
      within(screen.getByTestId('runs-no-match')).getByRole('button', {
        name: '清除筛选',
      }),
    )
    expect(screen.queryByTestId('runs-no-match')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('run-row')).toHaveLength(3)
  })

  it('初始 URL 参数直接生效', () => {
    renderView({}, '/runs?provider=p2')
    expect(rowIds()).toEqual(['remote'])
  })

  it('排序 Select 切换解出率降序/升序，并把排序写进 URL', async () => {
    const user = userEvent.setup()
    renderView()
    const sortSelect = screen.getByLabelText('排序')
    await user.selectOptions(sortSelect, 'solve_rate:desc')
    expect(rowIds()).toEqual(['remote', 'local', 'local'])
    expect(screen.getByTestId('loc')).toHaveTextContent(
      'sort=solve_rate&order=desc',
    )
    await user.selectOptions(sortSelect, 'solve_rate:asc')
    expect(rowIds()).toEqual(['local', 'local', 'remote'])
    expect(screen.getByTestId('loc')).toHaveTextContent(
      'sort=solve_rate&order=asc',
    )
  })
})

describe('RunsView 勾选对比', () => {
  it('未选/选一个时按钮 disabled，已选计数 0/2 与 1/2', async () => {
    const user = userEvent.setup()
    renderView()
    const count = screen.getByTestId('runs-selected')
    expect(count).toHaveTextContent('已选 0/2')
    const disabled = screen.getByRole('button', { name: '对比' })
    expect(disabled).toBeDisabled()
    await user.click(screen.getByLabelText('选择 r-newest'))
    expect(count).toHaveTextContent('已选 1/2')
    expect(screen.getByRole('button', { name: '对比' })).toBeDisabled()
  })

  it('选满两个出现对比链接且 href 带两个 id，再点取消勾选恢复按钮', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('选择 r-newest'))
    await user.click(screen.getByLabelText('选择 r-middle'))
    expect(screen.getByTestId('runs-selected')).toHaveTextContent('已选 2/2')
    expect(screen.getByRole('link', { name: '对比' })).toHaveAttribute(
      'href',
      '/compare?runs=r-newest,r-middle',
    )
    await user.click(screen.getByLabelText('选择 r-middle'))
    expect(screen.getByRole('button', { name: '对比' })).toBeDisabled()
  })
})
