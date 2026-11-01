export type CubeKind = '2x2' | '3x3'
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'
export type ColorName =
  | 'white'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'red'
  | 'orange'
export type ToolMode = 'both' | 'turn_only' | 'batch_only'

export interface CubeState {
  cube: CubeKind
  faces: Record<Face, ColorName[][]>
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
}

export interface ProviderParams {
  temperature?: number
  max_tokens?: number
  extra?: Record<string, unknown>
}

export interface Provider {
  id: string
  name: string
  base_url: string
  model: string
  api_key_ref: string
  params: ProviderParams
  key_configured: boolean
  key_stored: boolean
  created_at: string
}

export interface ProviderCreate {
  name: string
  base_url: string
  model: string
  api_key_ref: string
  api_key?: string
  params: ProviderParams
}

// PUT /api/providers/:id 的载荷；key 走独立的 key 接口，不在编辑表单里。
export interface ProviderUpdate {
  name: string
  base_url: string
  model: string
  api_key_ref: string
  params: ProviderParams
}

export interface ProbeResult {
  ok: boolean
  tool_calling: boolean
}

// submit_plan 工具的载荷；plan.updated 事件与 episode.plan/snapshot.currentPlan 同构
export interface PlanPhase {
  name: string
  approach?: string
}

export interface Plan {
  goal: string
  phases: PlanPhase[]
}

export interface Task {
  id: string
  cube: CubeKind
  scramble: string[]
  scramble_depth: number
  state: CubeState
  reference_length: number
  reference_kind: 'exact' | 'near_optimal' | 'fake'
  bin: string
}

export interface BenchmarkSummary {
  id: string
  name: string
  version: string
  kind: string
  cube: CubeKind
  content_hash: string
  frozen_at: string
  task_count: number
}

export interface BenchmarkDetail extends BenchmarkSummary {
  tasks: Task[]
}

export interface BenchmarkCreate {
  name: string
  cube: CubeKind
  depths: number[]
  per_depth: number
  seed: number
  solver: 'table' | 'rubik'
}

export interface Budget {
  max_moves: number
  max_tool_calls: number
  max_tokens: number
  max_seconds: number
  turn_timeout: number
  max_usd?: number | null
}

export interface AggregateTotals {
  tasks: number
  solved: number
  solve_rate: number
  ci95: [number, number]
}

export interface BinStats {
  total: number
  solved: number
  solve_rate: number
  ci95: [number, number]
  mean_moves: number
}

// 后端 `aggregate_report()` 的完整返回；run.totals 与 run.finished 事件都携带它。
export interface AggregateReport {
  benchmark_id: string
  benchmark_hash: string
  benchmark_total_tasks: number
  partial: boolean
  totals: AggregateTotals
  by_bin: Record<string, BinStats>
  episodes: Array<{
    task_id: string
    status: string
    solved: boolean
    moves_used: number
    reference_length: number
    efficiency: number | null
    progress_ratio: number
    protocol_errors: number
    tokens_in: number
    tokens_out: number
    latency_ms: number
    failure_code: string | null
    error: string | null
  }>
}

export interface Run {
  id: string
  provider_id: string
  benchmark_id: string
  tool_mode: ToolMode
  prompt_version: string
  require_plan?: boolean
  status: string
  totals: AggregateReport | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  budget: Budget
}

export interface Episode {
  id: string
  run_id: string
  task_id: string
  task_key: string
  status: string
  solved: boolean
  moves_used: number
  reference_length: number
  efficiency: number | null
  progress_ratio: number | null
  protocol_errors: number
  tokens_in: number | null
  tokens_out: number | null
  latency_ms: number | null
  failure_code: string | null
  error: string | null
  plan?: Plan | null
  started_at: string | null
  finished_at: string | null
}

export interface Step {
  id: string
  seq: number
  kind: string
  tool_name: string | null
  arguments: Record<string, unknown> | null
  result: Record<string, unknown> | null
  state: CubeState | null
  reference_length_after: number | null
}

export interface Snapshot {
  run: Run
  episodes: Episode[]
  last_event_id: number
  current_state: CubeState | null
  current_plan?: Plan | null
}

export interface Report {
  run_id: string
  provider_id: string
  benchmark_id: string
  status: string
  started_at: string | null
  finished_at: string | null
  benchmark_hash: string | null
  benchmark_total_tasks: number | null
  partial: boolean
  totals: AggregateTotals
  by_bin: Record<string, BinStats>
  episodes: Episode[]
}

export interface RunCreate {
  // 单选兼容字段；新代码用 provider_ids 批量创建
  provider_id?: string
  provider_ids?: string[]
  benchmark_id: string
  tool_mode: ToolMode
  // 选题子集（benchmark 内的 task id）；null/缺省 = 跑全集
  task_keys?: string[] | null
  // 计划模式：要求 agent 先 submit_plan 提交目标与分阶段计划
  require_plan?: boolean
  params: Record<string, unknown>
  budget: Partial<Budget>
}

// POST /api/runs 的响应：批量创建时 runs 列出每个新建 run
export interface RunCreated {
  id: string
  provider_id: string
}

export interface ProgressPoint {
  moves: number
  length: number | null
}

export interface RunEventBase<T extends string, D> {
  id: number
  type: T
  run_id: string
  episode_id: string | null
  ts: string
  data: D
}

export type RunEvent =
  | RunEventBase<'run.started', { benchmark_id: string }>
  | RunEventBase<
      'episode.started',
      { task_id: string; reference_length: number }
    >
  | RunEventBase<'plan.updated', { plan: Plan; revisions: number }>
  | RunEventBase<'model.turn.started', { moves_used: number }>
  | RunEventBase<
      'model.message',
      {
        content: string | null
        thinking?: string | null
        tool_calls: number
        usage: Usage
      }
    >
  | RunEventBase<'thinking.delta', { seq: number; text: string }>
  | RunEventBase<
      'tool.call',
      {
        call_id: string
        tool: string
        arguments: Record<string, unknown> | null
      }
    >
  | RunEventBase<
      'tool.result',
      {
        call_id: string
        tool: string
        ok: boolean
        payload: Record<string, unknown>
      }
    >
  | RunEventBase<
      'move.applied',
      {
        moves: string[]
        state: CubeState
        moves_used: number
        solved: boolean
        reference_length_after: number | null
      }
    >
  | RunEventBase<
      'episode.finished',
      {
        task_id: string
        status: string
        solved: boolean
        moves_used: number
      }
    >
  | RunEventBase<
      'run.finished',
      { status: string; totals: AggregateReport | null }
    >
  | RunEventBase<'run.error', { message: string }>

export interface ComparePair {
  task_id: string
  first_solved: boolean
  second_solved: boolean
  delta: number
}

// GET /api/compare 的返回；solve_rate_diff 的 CI 由后端 bootstrap（2000 次）得出，
// pairs 只覆盖两 run episode 的 task_id 交集，delta = second − first。
export interface CompareResult {
  benchmark_id: string
  content_hash: string
  tasks: number
  runs: string[]
  solve_rate_first: number
  solve_rate_second: number
  solve_rate_diff: number
  ci95: [number, number]
  pairs: ComparePair[]
}
