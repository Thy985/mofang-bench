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
    <div data-testid="view-presets" className="flex gap-1">
      {PRESETS.map((item) => (
        <button
          key={item.key}
          type="button"
          data-testid={`view-${item.key}`}
          onClick={() => onRequest(item.key)}
          className="pill"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
