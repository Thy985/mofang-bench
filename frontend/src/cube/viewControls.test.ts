import { describe, expect, it } from 'vitest'
import {
  easeOutProgress,
  initialCameraPosition,
  presetCameraPosition,
  VIEW_LERP_MS,
} from './viewControls'

describe('viewControls', () => {
  it('初始机位按尺寸区分且与现状一致', () => {
    expect(initialCameraPosition(2)).toEqual([3.2, 3.2, 4.2])
    expect(initialCameraPosition(3)).toEqual([5, 5, 6.5])
  })

  it('正视在 +Z、顶视在 +Y、等轴/重置回初始机位', () => {
    expect(presetCameraPosition('front', 2)).toEqual([0, 0, 6])
    // 顶视机位极角 φ≈31°，不会被 OrbitControls 的 minPolarAngle=π/6 夹取，距离不变
    const [topX, topY, topZ] = presetCameraPosition('top', 2)
    expect(topX).toBe(0)
    expect(Math.hypot(topY, topZ)).toBeCloseTo(6)
    expect(Math.atan2(topZ, topY)).toBeCloseTo((31 / 180) * Math.PI)
    expect(presetCameraPosition('iso', 3)).toEqual(initialCameraPosition(3))
    expect(presetCameraPosition('reset', 2)).toEqual(initialCameraPosition(2))
  })

  it('easeOutProgress 在时长内单调且超时收敛为 1', () => {
    expect(easeOutProgress(0)).toBe(0)
    expect(easeOutProgress(VIEW_LERP_MS)).toBe(1)
    expect(easeOutProgress(VIEW_LERP_MS + 1000)).toBe(1)
    let prev = 0
    for (let ms = 0; ms <= VIEW_LERP_MS; ms += 50) {
      const value = easeOutProgress(ms)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })
})
