import { Skeleton } from './Skeleton'

export function PageSkeleton({
  variant,
  rows = 4,
  count = 2,
  fields = 5,
}: {
  variant: 'table' | 'cards' | 'form' | 'list'
  rows?: number
  count?: number
  fields?: number
}) {
  if (variant === 'table') {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-8 w-1/2" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton
            key={i}
            className={i % 2 === 0 ? 'h-4 w-full' : 'h-4 w-11/12'}
          />
        ))}
      </div>
    )
  }
  if (variant === 'list') {
    return (
      <div aria-busy="true" className="border-t border-line-soft">
        <div className="flex items-end justify-between py-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-line-soft py-4"
          >
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    )
  }
  if (variant === 'cards') {
    return (
      <div aria-busy="true" className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="space-y-2 rounded border border-line bg-surface p-4"
          >
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div
      aria-busy="true"
      className="grid gap-3 rounded border border-line bg-surface p-4 md:grid-cols-2"
    >
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <div className="md:col-span-2">
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  )
}
