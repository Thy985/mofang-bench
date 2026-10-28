import type { LiveLog } from '../hooks/liveReducer'

export function ToolLog({ logs }: { logs: LiveLog[] }) {
  if (logs.length === 0) {
    return <p className="text-xs text-slate-500">暂无工具日志</p>
  }
  return (
    <ul data-testid="tool-log" className="max-h-64 space-y-1 overflow-auto text-xs">
      {logs.slice(-80).map((log) => (
        <li
          key={log.id}
          className={
            log.kind === 'model' ? 'text-slate-300' : 'text-sky-300'
          }
        >
          <details>
            <summary className="cursor-pointer truncate">
              {log.kind === 'model' ? '模型' : '工具'}：{log.text}
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
              {JSON.stringify(log.data, null, 2)}
            </pre>
          </details>
        </li>
      ))}
    </ul>
  )
}
