export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent ${className}`}
    />
  )
}
