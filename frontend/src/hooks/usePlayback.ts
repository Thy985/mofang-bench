import { useCallback, useEffect, useRef, useState } from 'react'
import type { CubeState, Step } from '../api/types'
import type { MoveBatch } from '../cube/CubeView'

export interface Playback {
  active: number
  playing: boolean
  speed: number
  viewState: CubeState | null
  batch: MoveBatch | null
  resetToken: number
  select: (index: number) => void
  play: () => void
  pause: () => void
  stepPrev: () => void
  stepNext: () => void
  setSpeed: (speed: number) => void
  handleBatchComplete: () => void
}

// 空格在聚焦按钮上会同时触发 click 与 keydown，一并屏蔽防双动作
const KEY_BLOCKED_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'])

function appliedMoves(step: Step): string[] | null {
  const applied = step.result?.applied
  if (Array.isArray(applied) && applied.length > 0 && step.state) {
    return applied as string[]
  }
  return null
}

export function usePlayback(
  steps: Step[],
  initialState: CubeState | null,
): Playback {
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewState, setViewState] = useState<CubeState | null>(initialState)
  const [batch, setBatch] = useState<MoveBatch | null>(null)
  const [resetToken, setResetToken] = useState(1)

  const activeRef = useRef(-1)
  const playingRef = useRef(false)
  const stepsRef = useRef(steps)
  const initialStateRef = useRef(initialState)
  stepsRef.current = steps
  initialStateRef.current = initialState

  // 选中步没有落库局面时，回退到之前最近有局面的步骤，再回退到题初始局面。
  function stateFor(index: number): CubeState | null {
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const candidate = stepsRef.current[cursor]?.state
      if (candidate) return candidate
    }
    return initialStateRef.current
  }

  const pause = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
  }, [])

  const stopAndSnap = useCallback((index: number) => {
    setActive(index)
    activeRef.current = index
    setViewState(stateFor(index))
    setBatch(null)
    setResetToken((current) => current + 1)
  }, [])

  const select = useCallback(
    (index: number) => {
      playingRef.current = false
      setPlaying(false)
      stopAndSnap(index)
    },
    [stopAndSnap],
  )

  // 从 index 起找下一个有走法的步并开播；无走法的步瞬间跳过；到末步即停。
  // 开播时把视图吸附到该步的起点局面（stateFor(cursor - 1)），
  // 跳过的无走法步状态由回退链自然包含。
  const advanceFrom = useCallback((index: number) => {
    const list = stepsRef.current
    let cursor = index
    while (cursor < list.length) {
      const step = list[cursor]
      const moves = appliedMoves(step)
      if (moves && step.state) {
        setActive(cursor)
        activeRef.current = cursor
        setViewState(stateFor(cursor - 1))
        setResetToken((current) => current + 1)
        setBatch({ eventId: Date.now(), moves, state: step.state })
        return
      }
      cursor += 1
    }
    playingRef.current = false
    setPlaying(false)
    setBatch(null)
  }, [])

  const play = useCallback(() => {
    playingRef.current = true
    setPlaying(true)
    advanceFrom(activeRef.current === -1 ? 0 : activeRef.current)
  }, [advanceFrom])

  const handleBatchComplete = useCallback(() => {
    if (!playingRef.current) return
    advanceFrom(activeRef.current + 1)
  }, [advanceFrom])

  const stepPrev = useCallback(() => {
    select(Math.max(-1, activeRef.current - 1))
  }, [select])

  const stepNext = useCallback(() => {
    select(Math.min(stepsRef.current.length - 1, activeRef.current + 1))
  }, [select])

  // 题初始局面异步到达且用户尚未选择时，吸附一次
  const initialApplied = useRef<CubeState | null>(initialState)
  useEffect(() => {
    if (!initialState || initialApplied.current === initialState) return
    initialApplied.current = initialState
    if (activeRef.current !== -1) return
    setViewState(initialState)
    setResetToken((current) => current + 1)
  }, [initialState])

  // 键盘：←/→ 步进（吸附不播动画）、空格播放/暂停（防页面滚动）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // window 派发的事件 target 不是元素（如 jsdom 测试），回退到当前聚焦元素
      const target =
        event.target instanceof HTMLElement
          ? event.target
          : document.activeElement
      if (
        target instanceof HTMLElement &&
        KEY_BLOCKED_TAGS.has(target.tagName)
      ) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepNext()
      } else if (event.key === ' ') {
        event.preventDefault()
        if (playingRef.current) pause()
        else play()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [play, pause, stepPrev, stepNext])

  return {
    active,
    playing,
    speed,
    viewState,
    batch,
    resetToken,
    select,
    play,
    pause,
    stepPrev,
    stepNext,
    setSpeed,
    handleBatchComplete,
  }
}
