import type { ColorName } from '../api/types'
import { colorHex } from '../lib/format'
import { FACE_ORDER } from './facelets'

const FACE_COLORS: Record<(typeof FACE_ORDER)[number], ColorName> = {
  U: 'white',
  R: 'red',
  F: 'green',
  D: 'yellow',
  L: 'orange',
  B: 'blue',
}

export function FaceLegend() {
  return (
    <ul
      data-testid="face-legend"
      className="pointer-events-none absolute right-2 top-2 flex gap-1.5 rounded border border-line bg-sunken/70 p-1.5 text-xs"
    >
      {FACE_ORDER.map((face) => (
        <li key={face} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: colorHex(FACE_COLORS[face]) }}
          />
          <span className="text-text-dim">{face}</span>
        </li>
      ))}
    </ul>
  )
}
