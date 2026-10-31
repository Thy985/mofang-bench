import { useCallback, useEffect, useRef, useState } from 'react'

const FOLLOW_THRESHOLD = 8

// dep（如流式 thinking 文本）变化且仍处于跟随状态时自动滚到底；
// 用户上滚即脱离跟随，scrollToBottom() 恢复。
export function useFollowScroll<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T | null>(null)
  const [following, setFollowing] = useState(true)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setFollowing(
      el.scrollTop + el.clientHeight >= el.scrollHeight - FOLLOW_THRESHOLD,
    )
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !following) return
    el.scrollTop = el.scrollHeight
  }, [dep, following])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
  }, [])

  return { ref, following, onScroll, scrollToBottom }
}
