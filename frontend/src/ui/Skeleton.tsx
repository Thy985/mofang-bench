export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      data-testid="skeleton"
      aria-hidden
      className={`animate-pulse rounded bg-surface ${className}`}
    />
  )
}
