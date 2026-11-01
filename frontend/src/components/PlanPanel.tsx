import type { Plan } from '../api/types'

export interface PlanPanelProps {
  plan: Plan | null
  revisions?: number
}

// 展示 agent 提交的目标与分阶段计划（submit_plan）。plan 为空时不渲染。
export function PlanPanel({ plan, revisions = 0 }: PlanPanelProps) {
  if (!plan) return null
  return (
    <section
      data-testid="plan-panel"
      className="rounded border border-line bg-surface p-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-dim">计划</span>
        {revisions > 0 && (
          <span data-testid="plan-revisions" className="text-xs text-text-dim">
            已修订 {revisions} 次
          </span>
        )}
      </div>
      <p data-testid="plan-goal" className="mt-1 font-medium">
        {plan.goal}
      </p>
      <ol
        data-testid="plan-phases"
        className="mt-1 list-decimal space-y-0.5 pl-5"
      >
        {plan.phases.map((phase, index) => (
          <li key={index}>
            {phase.name}
            {phase.approach && (
              <span className="text-text-dim">（{phase.approach}）</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
