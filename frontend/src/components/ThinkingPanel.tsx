import { useState } from 'react'
import { useFollowScroll } from '../hooks/useFollowScroll'
import { Button } from '../ui/Button'

// 流式思考面板：max-h-72 内部滚动 + 跟随滚动 + 复制。
// 折叠状态由本组件 useState 自持；组件跨 turn 不卸载，记忆自然成立。
export function ThinkingPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const { ref, following, onScroll, scrollToBottom } =
    useFollowScroll<HTMLPreElement>(text)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用（非安全上下文/权限拒绝）时静默失败
    }
  }

  return (
    <details
      open={open}
      data-testid="thinking-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sky-300">思考中…</summary>
      {/* 空 text（turn 结束清空）时只留 summary 空态：组件跨 turn 保持挂载，
          折叠/展开记忆由上方 useState 自持，滚动/复制逻辑不变 */}
      {text && (
        <div className="relative mt-1">
          <pre
            ref={ref}
            onScroll={onScroll}
            className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-sunken p-2 text-xs text-text-dim"
          >
            {text}
          </pre>
          {!following && (
            <button
              type="button"
              data-testid="thinking-follow"
              onClick={scrollToBottom}
              className="absolute right-2 bottom-2 rounded bg-surface-2 px-2 py-1 text-xs text-text shadow"
            >
              回到底部
            </button>
          )}
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => void copy()}
            >
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        </div>
      )}
    </details>
  )
}
