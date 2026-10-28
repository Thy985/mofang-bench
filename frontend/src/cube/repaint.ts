import type { CubeState, ColorName } from '../api/types'
import {
  FACE_ORDER,
  sizeOf,
  slotKey,
  stickerPlacement,
  type Vec3,
} from './facelets'

export const MATERIAL_NORMALS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export interface StickerPaint {
  slot: string
  normal: Vec3
  color: ColorName
}

export function materialIndex(normal: Vec3): number {
  return MATERIAL_NORMALS.findIndex(
    (candidate) =>
      candidate[0] === normal[0] &&
      candidate[1] === normal[1] &&
      candidate[2] === normal[2],
  )
}

export function paintPlan(state: CubeState): StickerPaint[] {
  const size = sizeOf(state.cube)
  const paints: StickerPaint[] = []
  for (const face of FACE_ORDER) {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const { position, normal } = stickerPlacement(
          face,
          row,
          col,
          size,
        )
        paints.push({
          slot: slotKey(position),
          normal,
          color: state.faces[face][row][col],
        })
      }
    }
  }
  return paints
}

export function paintForSlot(
  paints: StickerPaint[],
  slot: string,
): Map<number, ColorName> {
  const result = new Map<number, ColorName>()
  for (const paint of paints) {
    if (paint.slot === slot) {
      result.set(materialIndex(paint.normal), paint.color)
    }
  }
  return result
}
