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
  const field = (
    <select
      id={selectId}
      aria-invalid={error ? true : undefined}
      className={`rounded-md bg-sunken px-2 py-2 text-sm transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-accent ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={selectId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
