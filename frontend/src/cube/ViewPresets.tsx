import type { ViewPreset } from './viewControls'

const PRESETS: { key: ViewPreset; label: string }[] = [
  { key: 'front', label: '正视' },
  { key: 'top', label: '顶视' },
  { key: 'iso', label: '等轴' },
  { key: 'reset', label: '重置' },
]

export function ViewPresets({
  onRequest,
}: {
  onRequest: (preset: ViewPreset) => void
}) {
  return (
    <div
      data-testid="view-presets"
      className="absolute right-2 top-2 z-10 flex gap-1 rounded bg-black/40 p-1 backdrop-blur-sm"
    >
      {PRESETS.map((item) => (
        <button
          key={item.key}
          type="button"
          data-testid={`view-${item.key}`}
          onClick={() => onRequest(item.key)}
          className="rounded px-1.5 py-0.5 text-xs text-white/80 transition-colors duration-fast hover:bg-white/10"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
