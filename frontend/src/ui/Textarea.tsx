import type { TextareaHTMLAttributes } from 'react'

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`rounded bg-sunken px-3 py-2 text-sm ${className}`}
      {...rest}
    />
  )
}
