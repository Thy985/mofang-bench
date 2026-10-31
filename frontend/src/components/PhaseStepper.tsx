import { motion } from 'motion/react'
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
    <ol
      data-testid="phase-stepper"
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      {STEPS.map((step, index) => {
        const state =
          index < activeIndex
            ? 'done'
            : index === activeIndex
              ? 'active'
              : 'pending'
        return (
          <li key={step.key} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden className="h-px w-4 bg-line" />}
            <span
              data-testid={`phase-${step.key}`}
              data-state={state}
              className={`relative flex items-center gap-1 rounded px-1.5 py-0.5 ${
                state === 'active' ? 'text-accent' : 'text-text-dim'
              }`}
            >
              {state === 'active' && (
                <motion.span
                  layoutId="phase-active"
                  className="absolute inset-0 rounded bg-accent-soft"
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                />
              )}
              <span className="relative flex items-center gap-1">
                {state === 'done' && '✓'}
                {state === 'done' ? (
                  <span className="text-text-dim">{step.label}</span>
                ) : (
                  step.label
                )}
                {state === 'active' && (
                  <motion.span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    animate={{ rotate: 360 }}
                    transition={{
                      repeat: Infinity,
                      duration: 1,
                      ease: 'linear',
                    }}
                  />
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
