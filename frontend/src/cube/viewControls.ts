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
    case 'top': {
      // minPolarAngle = π/6 会把 φ<30° 的机位夹回 30°，取 φ≈31° 留出余量
      const phi = (31 / 180) * Math.PI
      return [0, distance * Math.cos(phi), distance * Math.sin(phi)]
    }
    case 'iso':
    case 'reset':
      return initialCameraPosition(size)
  }
}

export function easeOutProgress(elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs / VIEW_LERP_MS))
  return 1 - (1 - t) * (1 - t)
}
