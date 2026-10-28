// type="number" 把无法解析的输入净化成空串，而 Number('') 是 0、Number('1.5')
// 不是整数，直接 Number(...) 会把空值/小数静默写进后端（params: dict[str, Any]
// 不拦），所以空串、非整数、越界都要在这里挡下。
// 纯函数：不碰 React、不出文案，告警文案仍由各页面自己出中文。

export function readPositiveInt(value: string): number | null {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 1) {
    return null
  }
  return parsed
}

export function readPositiveNumber(value: string): number | null {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export function readNumberInRange(
  value: string,
  min: number,
  max: number,
): number | null {
  const parsed = Number(value)
  if (
    value.trim() === '' ||
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    return null
  }
  return parsed
}

// 基准集 id 由 name + seed 拼成，seed 只要求整数（后端不过是 int），
// 负数也是合法值，与 per_depth 的正整数规则不同。
export function readInteger(value: string): number | null {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isInteger(parsed)) {
    return null
  }
  return parsed
}
