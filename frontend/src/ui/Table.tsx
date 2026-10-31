import type {
  HTMLAttributes,
  HTMLTableRowElement,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from 'react'

export function Table({
  className = '',
  ...rest
}: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-sm ${className}`} {...rest} />
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`border-b border-line py-2 text-left font-normal text-text-dim ${className}`}
      {...rest}
    />
  )
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-line/50 py-2 ${className}`} {...rest} />
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`transition-colors duration-fast hover:bg-surface ${className}`}
      {...rest}
    />
  )
}
