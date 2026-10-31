import { useId, type TextareaHTMLAttributes } from 'react'

const FIELD =
  'rounded-md bg-sunken px-3 py-2 text-sm transition-colors duration-fast placeholder:text-text-dim focus-visible:outline-2 focus-visible:outline-accent'

export function Textarea({
  label,
  error,
  className = '',
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string }) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const field = (
    <textarea
      id={fieldId}
      aria-invalid={error ? true : undefined}
      className={`${FIELD} ${error ? 'border border-danger' : 'border border-transparent'} ${className}`}
      {...rest}
    />
  )
  if (!label && !error) return field
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={fieldId} className="block text-xs text-text-dim">
          {label}
        </label>
      )}
      {field}
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  )
}
