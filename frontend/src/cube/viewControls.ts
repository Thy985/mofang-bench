export type ViewPreset = 'front' | 'top' | 'iso' | 'reset'

export interface ViewRequest {
  preset: ViewPreset
  token: number
}

export const VIEW_LERP_MS = 400

export function initialCameraPosition(size: number): [number, number, number] {
  return size === 2 ? [3.2, 3.2, 4.2] : [5, 5, 6.5]
}

export function presetCameraPosition(
  preset: ViewPreset,
  size: number,
): [number, number, number] {
  const distance = size === 2 ? 6 : 9
  switch (preset) {
    case 'front':
      return [0, 0, distance]
    case 'top':
      // 极角 0 会让 OrbitControls 方位角退化，留一点倾斜
      return [0, distance, 0.001]
    case 'iso':
    case 'reset':
      return initialCameraPosition(size)
  }
}

export function easeOutProgress(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / VIEW_LERP_MS))
  return 1 - (1 - t) * (1 - t)
}
