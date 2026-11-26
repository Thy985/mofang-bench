import type { Plan } from '../api/types'

export interface PlanPanelProps {
  plan: Plan | null
  revisions?: number
}

// 展示 agent 提交的目标与分阶段计划（submit_plan）。plan 为空时不渲染。
export function PlanPanel({ plan, revisions = 0 }: PlanPanelProps) {
  if (!plan) return null
  return (
    <section data-testid="plan-panel" className="text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-text-dim">计划</span>
        {revisions > 0 && (
          <span data-testid="plan-revisions" className="text-[11px] text-text-faint">
            已修订 {revisions} 次
          </span>
        )}
      </div>
      <p data-testid="plan-goal" className="mb-1.5 text-[13px] text-text-strong">
        {plan.goal}
      </p>
      <ol data-testid="plan-phases" className="space-y-1 text-xs text-text-dim">
        {plan.phases.map((phase, index) => (
          <li key={index} className="flex gap-2">
            <span aria-hidden className="mt-px font-mono text-[10px] text-text-faint">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0">
              {phase.name}
              {phase.approach && (
                <span className="text-text-faint">（{phase.approach}）</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
