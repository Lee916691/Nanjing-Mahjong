import type { TableNotice } from './table-notifications';

export function TableNotification({ notice }: { notice?: TableNotice }) {
  return (
    <div className="table-event-slot">
      {notice && (
        <div
          className={`table-event-notice ${notice.emphasis ? 'notice-emphasis' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-event-id={notice.id}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}
