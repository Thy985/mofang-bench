import { useId, type SelectHTMLAttributes } from 'react'

export function Select({
  label,
  error,
  className = '',
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const selectId = id ?? autoId
  // wrapper 结构保持稳定（error 出现/消失不增删这层 div），
  // 否则 React 会替换 select DOM 节点，聚焦与连续操作都会被打断。
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={`rounded-md bg-sunken px-2 py-2 text-sm transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-accent ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
