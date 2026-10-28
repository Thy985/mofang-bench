import type { Vec3 } from './facelets'
import type { MoveSpec } from './moves'

// 与 rotateVec 同一约定：绕 +axis 的右手旋转，angle 以弧度计。
export function rotateOffset(
  value: Vec3,
  axis: 0 | 1 | 2,
  angle: number,
): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [x, y, z] = value
  if (axis === 0) return [x, y * cos - z * sin, y * sin + z * cos]
  if (axis === 1) return [x * cos + z * sin, y, -x * sin + z * cos]
  return [x * cos - y * sin, x * sin + y * cos, z]
}

export function specAngle(spec: MoveSpec): number {
  // turns 是落地方向的整数表示：3 等价于 -1 个 90°，动画走短弧。
  const turns = spec.turns === 3 ? -1 : spec.turns
  return (turns * Math.PI) / 2
}
