import type { InputHTMLAttributes } from 'react'

export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`rounded bg-sunken px-3 py-2 text-sm ${className}`} {...rest} />
}
