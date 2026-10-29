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
          <details>
            <summary className="cursor-pointer truncate">
              {log.kind === 'model' ? '模型' : '工具'}：{log.text}
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-sunken p-2 text-[10px] text-text-dim">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
