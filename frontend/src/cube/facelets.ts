import type { CubeKind, Face } from '../api/types'

export type Vec3 = [number, number, number]

export const FACE_ORDER: Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

export const FACE_FRAME: Record<
  Face,
  { normal: Vec3; right: Vec3; up: Vec3 }
> = {
  U: { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  R: { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  F: { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  D: { normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  L: { normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  B: { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
}

export function sizeOf(cube: CubeKind): 2 | 3 {
  return cube === '2x2' ? 2 : 3
}

export function coord(index: number, size: number): number {
  return 2 * index - (size - 1)
}

// 槽位坐标 +x=R、+y=U、+z=F；row 0 是各面视图的顶行，col 0 是左列。
export function stickerPlacement(
  face: Face,
  row: number,
  col: number,
  size: number,
): { position: Vec3; normal: Vec3 } {
  const { normal, right, up } = FACE_FRAME[face]
  const depth = size - 1 - row
  return {
    position: [
      normal[0] * (size - 1) +
        right[0] * coord(col, size) +
        up[0] * coord(depth, size),
      normal[1] * (size - 1) +
        right[1] * coord(col, size) +
        up[1] * coord(depth, size),
      normal[2] * (size - 1) +
        right[2] * coord(col, size) +
        up[2] * coord(depth, size),
    ],
    normal,
  }
}

export function slotKey(slot: Vec3): string {
  return `${slot[0]},${slot[1]},${slot[2]}`
}

export function cubieSlots(size: number): Vec3[] {
  const values = Array.from({ length: size }, (_, index) =>
    coord(index, size),
  )
  const slots: Vec3[] = []
  for (const x of values) {
    for (const y of values) {
      for (const z of values) {
        if (size === 3 && x === 0 && y === 0 && z === 0) continue
        slots.push([x, y, z])
      }
    }
  }
  return slots
}
