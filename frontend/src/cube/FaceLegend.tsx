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
      className="flex flex-wrap gap-2.5 text-[11px]"
    >
      {FACE_ORDER.map((face) => (
        <li key={face} className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: colorHex(FACE_COLORS[face]) }}
          />
          <span className="text-text-dim">{face}</span>
        </li>
      ))}
    </ul>
  )
}
