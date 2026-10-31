import { useId, type InputHTMLAttributes } from 'react'

const FIELD =
  'rounded-md bg-sunken px-3 py-2 text-sm transition-colors duration-fast placeholder:text-text-dim focus-visible:outline-2 focus-visible:outline-accent'

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
      className={`${FIELD} ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    />
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
