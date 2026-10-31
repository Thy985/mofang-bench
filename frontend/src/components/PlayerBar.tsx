import type { Step } from '../api/types'
import type { Playback } from '../hooks/usePlayback'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Select } from '../ui/Select'

export function PlayerBar({
  playback,
  steps,
}: {
  playback: Playback
  steps: Step[]
}) {
  const step = playback.active >= 0 ? steps[playback.active] : null
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="上一步"
          onClick={playback.stepPrev}
        >
          ←
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="button"
          onClick={() =>
            playback.playing ? playback.pause() : playback.play()
          }
        >
          {playback.playing ? '暂停' : '播放'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="下一步"
          onClick={playback.stepNext}
        >
          →
        </Button>
      </div>
      <input
        type="range"
        data-testid="playback-scrubber"
        aria-label="步骤进度"
        min={-1}
        max={Math.max(-1, steps.length - 1)}
        step={1}
        value={playback.active}
        onChange={(event) => playback.select(Number(event.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span
        data-testid="playback-position"
        className="font-mono text-xs text-text-dim"
      >
        {step
          ? `#${step.seq} ${step.kind}${
              step.tool_name ? ` · ${step.tool_name}` : ''
            }`
          : '初始局面'}
      </span>
      <Select
        aria-label="播放速度"
        value={playback.speed}
        onChange={(event) => playback.setSpeed(Number(event.target.value))}
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={100}>instant</option>
      </Select>
    </Card>
  )
}
