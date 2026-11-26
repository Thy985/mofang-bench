import type { HTMLAttributes } from 'react'

export interface ModeCardOption {
  value: string
  title: string
  hint?: string
  // 状态徽章：默认 / 2x2 / 3x3 / 建议 / 互斥原因等，选中态随 chip 转 accent
  badge?: string
  disabled?: boolean
}

// 枚举单选：与 ChoiceChips 共用 .chip 语言，保留原生 radio 的可访问性。
export function ModeCards({
  options,
  value,
  onChange,
  className = '',
  ...rest
}: {
  options: ModeCardOption[]
  value: string
  onChange: (value: string) => void
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>) {
  return (
    <div
      role="radiogroup"
      className={`flex flex-wrap gap-1.5 ${className}`}
      {...rest}
    >
      {options.map((option) => {
        const checked = option.value === value
        const disabled = option.disabled ?? false
        return (
          <label
            key={option.value}
            className="chip"
            data-active={checked && !disabled ? 'true' : undefined}
            data-disabled={disabled ? 'true' : undefined}
            title={option.hint}
          >
            {/* 透明覆盖：保留原生 radio 的可访问性与 E2E 可操作性 */}
            <input
              type="radio"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="pointer-events-none">{option.title}</span>
            {(option.badge ?? option.hint) && (
              <em className="pointer-events-none">
                {option.badge ?? option.hint}
              </em>
            )}
          </label>
        )
      })}
    </div>
  )
}
