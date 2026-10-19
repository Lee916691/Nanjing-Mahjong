import type { RoomView } from '@nanjing-mahjong/shared-types';
import { notificationForEvent } from './table-notifications';

export interface TableHistoryState {
  roomId: string;
  revision: number;
  records: { id: number; sequence: number; text: string }[];
}

export function updateTableHistory(
  previous: TableHistoryState | null,
  room: RoomView,
): TableHistoryState {
  if (previous?.roomId === room.id && room.revision <= previous.revision) return previous;
  const events = [...room.tableEvents].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
  const seen = new Set<number>();
  const unique = events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  const records = unique.slice(-100).flatMap((event) => {
    const notice = notificationForEvent(event, room.players);
    return notice
      ? [
          {
            id: notice.id,
            sequence: notice.sequence,
            text: event.type === 'an-gang' ? `${notice.text}：${event.tile.label}` : notice.text,
          },
        ]
      : [];
  });
  return { roomId: room.id, revision: room.revision, records: records.slice(-20) };
}
