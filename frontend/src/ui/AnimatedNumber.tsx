import { useEffect } from 'react'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'

// motion useSpring 驱动的数字滚动；reduced-motion 用户直接渲染终值
// （r3f 之外 motion 有 MotionConfig 兜底，这里显式短路更稳）。
export function AnimatedNumber({
  value,
  format = (n: number) => String(n),
}: {
  value: number
  format?: (value: number) => string
}) {
  const reduceMotion = useReducedMotion()
  const raw = useMotionValue(value)
  const spring = useSpring(raw, { stiffness: 170, damping: 26 })
  const text = useTransform(spring, (n) => format(Math.round(n)))
  useEffect(() => {
    raw.set(value)
  }, [value, raw])
  if (reduceMotion) return <span>{format(value)}</span>
  return <motion.span>{text}</motion.span>
}
