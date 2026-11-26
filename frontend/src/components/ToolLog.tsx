import type { LiveLog } from '../hooks/liveReducer'

export function ToolLog({ logs }: { logs: LiveLog[] }) {
  if (logs.length === 0) {
    return <p className="mt-2 text-xs text-text-faint">暂无工具日志</p>
  }
  return (
    <ul
      data-testid="tool-log"
      className="mt-2 max-h-64 space-y-1.5 overflow-auto text-xs"
    >
      {logs.slice(-80).map((log) => (
        <li key={log.id}>
          {/* 带 thinking 的模型条目默认展开，保证思考过程可见（E2E 硬断言）。 */}
          <details open={log.kind === 'model' && !!log.thinking}>
            <summary className="flex cursor-pointer items-center gap-1.5 truncate text-text-dim">
              <span
                className={`shrink-0 rounded-[3px] px-1 py-px font-mono text-[10px] ${
                  log.kind === 'model'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-info/10 text-info'
                }`}
              >
                {log.kind === 'model' ? '模型' : '工具'}
              </span>
              {log.thinking ? (
                <span className="shrink-0 rounded-[3px] bg-sunken px-1 py-px text-[10px] text-text-faint">
                  含思考
                </span>
              ) : null}
              <span className="truncate">{log.text}</span>
            </summary>
            {log.kind === 'model' && log.thinking && (
              <details open data-testid="log-thinking" className="mt-1">
                <summary className="cursor-pointer text-[11px] text-info">
                  思考过程
                </summary>
                <pre className="stream mt-1 max-h-48 text-[10px]">
                  {log.thinking}
                </pre>
              </details>
            )}
            <pre className="stream mt-1 max-h-48 text-[10px]">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
