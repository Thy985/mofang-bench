import type { Phase } from '../hooks/liveReducer'

const STEPS: { key: Phase; label: string }[] = [
  { key: 'queued', label: '排队' },
  { key: 'thinking', label: '思考' },
  { key: 'tooling', label: '工具' },
  { key: 'done', label: '完成' },
]

export function PhaseStepper({ phase }: { phase: Phase }) {
  const activeIndex = STEPS.findIndex((step) => step.key === phase)
  return (
    <ol data-testid="phase-stepper" className="flex gap-1.5">
      {STEPS.map((step, index) => {
        const state =
          index < activeIndex
            ? 'done'
            : index === activeIndex
              ? 'active'
              : 'pending'
        return (
          <li key={step.key} className="min-w-0 flex-1">
            <span
              data-testid={`phase-${step.key}`}
              data-state={state}
              className={`block h-[3px] rounded-full ${
                state === 'active'
                  ? 'bg-accent'
                  : state === 'done'
                    ? 'bg-[#3a434e]'
                    : 'bg-line'
              }`}
            />
            <span
              className={`mt-1.5 block truncate text-[11px] ${
                state === 'active'
                  ? 'text-accent'
                  : state === 'pending'
                    ? 'text-text-faint'
                    : 'text-text-dim'
              }`}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
