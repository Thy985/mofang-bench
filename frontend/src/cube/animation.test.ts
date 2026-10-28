import { describe, expect, it } from 'vitest'
import { rotateOffset, specAngle } from './animation'
import { FACE_ORDER, type Vec3 } from './facelets'
import { parseMove, rotateVec } from './moves'

const SAMPLES: Vec3[] = [
  [1, 1, 1],
  [1, -1, 1],
  [-1, 1, -1],
  [0, 1, 0],
  [1, 0, -1],
]

const MOVES = FACE_ORDER.flatMap((face) =>
  [1, 2, 3].map((amount) => ({
    move: amount === 1 ? face : amount === 2 ? `${face}2` : `${face}'`,
  })),
)

describe('rotateOffset', () => {
  it.each(MOVES)('$move 的动画角度与落地方向一致', ({ move }) => {
    const spec = parseMove(move, 3)
    for (const sample of SAMPLES) {
      const animated = rotateOffset(sample, spec.axis, specAngle(spec))
      const landed = rotateVec(sample, spec.axis, spec.turns)
      animated.forEach((value, index) => {
        expect(value).toBeCloseTo(landed[index], 10)
      })
    }
  })

  it('刚性：绕轴旋转保持到轴的距离', () => {
    const sample: Vec3 = [1, 2, -3]
    const length = Math.hypot(...sample)
    for (const axis of [0, 1, 2] as const) {
      for (const angle of [0.3, 1.1, Math.PI / 2, 3.7]) {
        expect(Math.hypot(...rotateOffset(sample, axis, angle))).toBeCloseTo(
          length,
          10,
        )
      }
    }
  })

  it('0 角度保持原位', () => {
    for (const sample of SAMPLES) {
      rotateOffset(sample, 1, 0).forEach((value, index) => {
        expect(value).toBeCloseTo(sample[index], 10)
      })
    }
  })
})
