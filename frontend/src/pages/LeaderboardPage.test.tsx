import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AggregateReport, BenchmarkSummary, Provider, Run } from '../api/types'
import { LeaderboardView } from './LeaderboardPage'

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
      ci95: [0.1, 0.9],
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
  makeRun('r1', { totals: aggregate(0.5), created_at: '2026-10-25T00:00:00+00:00' }),
  makeRun('r2', { totals: aggregate(0.75), created_at: '2026-10-27T00:00:00+00:00' }),
  makeRun('r3', {
    provider_id: 'p2',
    benchmark_id: 'b2',
    totals: aggregate(1),
    created_at: '2026-10-26T00:00:00+00:00',
  }),
  makeRun('r4', { status: 'failed', totals: null }),
  makeRun('r5', {
    provider_id: 'p2',
    totals: aggregate(0.25),
    created_at: '2026-10-28T00:00:00+00:00',
  }),
]

function renderView(overrides: Partial<{ runs: Run[] }> = {}) {
  return render(
    <MemoryRouter>
      <LeaderboardView
        runs={overrides.runs ?? runs}
        providers={providers}
        benchmarks={benchmarks}
      />
    </MemoryRouter>,
  )
}

function rowTexts(): string[] {
  return screen
    .getAllByTestId('leaderboard-row')
    .map((row) => within(row).getByRole('link').textContent ?? '')
}

describe('LeaderboardView', () => {
  it('按模型 × 题集聚合，取最新 run 并累计次数，按解出率降序', () => {
    renderView()
    expect(rowTexts()).toEqual(['remote', 'local', 'remote'])
    const first = screen.getAllByTestId('leaderboard-row')[0]
    expect(first).toHaveTextContent('100.0%')
    // local × demo 有两次已完成 run（r1 较早、r2 最新）
    const localRow = screen.getAllByTestId('leaderboard-row')[1]
    expect(localRow).toHaveTextContent('75.0%')
    expect(localRow).toHaveTextContent('2')
  })

  it('失败的 run 不参与排名', () => {
    renderView()
    // r4 是 failed，若被计入会出现第三行 local
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3)
  })

  it('题集筛选只保留匹配行', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('题集筛选'), 'b2')
    expect(rowTexts()).toEqual(['remote'])
  })

  it('无已完成 run 时出空态', () => {
    renderView({
      runs: [makeRun('r9', { status: 'failed', totals: null })],
    })
    expect(screen.getByText('还没有可排名的 run')).toBeInTheDocument()
    expect(screen.queryByTestId('leaderboard-row')).not.toBeInTheDocument()
  })
})
