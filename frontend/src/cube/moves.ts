import type { Face } from '../api/types'
import { FACE_FRAME, FACE_ORDER, type Vec3 } from './facelets'

export interface MoveSpec {
  face: Face
  amount: 1 | 2 | 3
  axis: 0 | 1 | 2
  sign: 1 | -1
  layer: number
  turns: number
}

export function parseMove(move: string, size: number): MoveSpec {
  const face = move[0] as Face
  if (!FACE_ORDER.includes(face)) {
    throw new Error(`invalid move: ${move}`)
  }
  const suffix = move.slice(1)
  const amount = suffix === '' ? 1 : suffix === '2' ? 2 : suffix === "'" ? 3 : 0
  if (amount === 0) {
    throw new Error(`invalid move: ${move}`)
  }
  const normal = FACE_FRAME[face].normal
  const axis = normal.findIndex((value) => value !== 0) as 0 | 1 | 2
  const sign = normal[axis] as 1 | -1
  return {
    face,
    amount,
    axis,
    sign,
    layer: sign * (size - 1),
    turns: ((-sign * amount) % 4 + 4) % 4,
  }
}

export function rotateVec(
  value: Vec3,
  axis: 0 | 1 | 2,
  quarterTurns: number,
): Vec3 {
  let [x, y, z] = value
  const turns = ((quarterTurns % 4) + 4) % 4
  for (let index = 0; index < turns; index += 1) {
    if (axis === 0) {
      ;[y, z] = [-z, y]
    } else if (axis === 1) {
      ;[x, z] = [z, -x]
    } else {
      ;[x, y] = [-y, x]
    }
  }
  return [x, y, z]
}

export function rotateSlot(slot: Vec3, spec: MoveSpec): Vec3 {
  return rotateVec(slot, spec.axis, spec.turns)
}

export function layerSlots(slots: Vec3[], spec: MoveSpec): Vec3[] {
  return slots.filter((slot) => slot[spec.axis] === spec.layer)
}
