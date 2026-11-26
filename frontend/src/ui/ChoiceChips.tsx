import type { HTMLAttributes } from 'react'

export interface ChoiceChipOption {
  value: string
  title: string
  hint?: string
  disabled?: boolean
}

// 多选 chip：与 ModeCards 同一套控件语言，选中态由 .chip[data-active] 表达。
export function ChoiceChips({
  options,
  selected,
  onToggle,
  className = '',
  ...rest
}: {
  options: ChoiceChipOption[]
  selected: ReadonlySet<string>
  onToggle: (value: string, checked: boolean) => void
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'onToggle'>) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} {...rest}>
      {options.map((option) => {
        const checked = selected.has(option.value)
        return (
          <label
            key={option.value}
            className="chip"
            data-active={checked && !option.disabled ? 'true' : undefined}
            data-disabled={option.disabled ? 'true' : undefined}
            title={option.hint}
          >
            {/* 透明覆盖：保留原生 checkbox 的可访问性与 E2E 可操作性，
                视觉选中态完全由 label 表达 */}
            <input
              type="checkbox"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              checked={checked}
              disabled={option.disabled}
              onChange={(event) =>
                onToggle(option.value, event.target.checked)
              }
            />
            <span className="pointer-events-none">{option.title}</span>
            {option.hint && (
              <em className="pointer-events-none">{option.hint}</em>
            )}
          </label>
        )
      })}
    </div>
  )
}
