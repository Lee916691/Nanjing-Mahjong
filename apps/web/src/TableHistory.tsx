import type { TableHistoryState } from './table-history';

export function TableHistory({ history }: { history: TableHistoryState | null }) {
  const records = history?.records ?? [];
  return (
    <details className="table-history">
      <summary>牌桌历史 · 最近 {records.length} 条</summary>
      <p>当前一将 · 服务端仅保留最近 100 条事件，并非完整牌谱</p>
      <div className="table-history-scroll" tabIndex={0} aria-label="最近公开牌桌记录">
        {records.length ? (
          <ol>
            {records.map((record) => (
              <li key={record.id} data-event-id={record.id}>
                {record.text}
              </li>
            ))}
          </ol>
        ) : (
          <p>暂无公开记录</p>
        )}
      </div>
    </details>
  );
}
