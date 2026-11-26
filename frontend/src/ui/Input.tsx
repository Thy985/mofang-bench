import { useId, type InputHTMLAttributes } from 'react'

const FIELD =
  'h-[34px] w-full rounded-[7px] border border-line bg-sunken px-2.5 text-[13px] text-text-strong transition-colors duration-fast placeholder:text-text-faint hover:border-[#333a43] focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/25'

export function Input({
  label,
  error,
  className = '',
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const inputId = id ?? autoId
  const field = (
    <input
      id={inputId}
      aria-invalid={error ? true : undefined}
      className={`${FIELD} ${error ? 'border-danger' : ''} ${className}`}
      {...rest}
    />
  )
  // wrapper 结构保持稳定（error 出现/消失不增删这层 div），
  // 否则 React 会替换 input DOM 节点，聚焦与连续输入都会被打断。
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
