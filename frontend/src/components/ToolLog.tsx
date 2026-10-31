import type { LiveLog } from '../hooks/liveReducer'

export function ToolLog({ logs }: { logs: LiveLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-text-dim">暂无工具日志</p>
  }
  return (
    <ul data-testid="tool-log" className="max-h-64 space-y-1 overflow-auto text-xs">
      {logs.slice(-80).map((log) => (
        <li
          key={log.id}
          className={
            log.kind === 'model' ? 'text-text' : 'text-sky-300'
          }
        >
          {/* 带 thinking 的模型条目默认展开，保证思考过程可见（E2E 硬断言）。 */}
          <details open={log.kind === 'model' && !!log.thinking}>
            <summary className="cursor-pointer truncate">
              <span
                className={`mr-1 inline-block rounded px-1 py-px align-middle text-[10px] ${
                  log.kind === 'model'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-warning/15 text-warning'
                }`}
              >
                {log.kind === 'model' ? '模型' : '工具'}
              </span>
              {log.thinking ? (
                <span className="mr-1 inline-block rounded bg-sunken px-1 py-px align-middle text-[10px] text-text-dim">
                  含思考
                </span>
              ) : null}
              {log.text}
            </summary>
            {log.kind === 'model' && log.thinking && (
              <details open data-testid="log-thinking" className="mt-1">
                <summary className="cursor-pointer text-sky-300">
                  思考过程
                </summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {log.thinking}
                </pre>
              </details>
            )}
            <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
