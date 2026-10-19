import type { RoomView, TableEvent } from '@nanjing-mahjong/shared-types';

export interface TableNotice {
  id: number;
  sequence: number;
  text: string;
  duration: number;
  emphasis?: boolean;
}

export function notificationForEvent(
  event: TableEvent,
  players: RoomView['players'],
): TableNotice | null {
  const name = (seat: number) => {
    const wind = ['东', '南', '西', '北'][seat];
    if (!wind) return '玩家';
    const player = players[seat];
    return player?.seat === seat && player.name.trim()
      ? `${player.name}（${wind}位）`
      : `${wind}位玩家`;
  };
  let text: string;
  let duration = 1600;
  switch (event.type) {
    case 'hand-started':
      text = `第 ${event.hand} 手开始，${name(event.dealer)}坐庄`;
      break;
    case 'tile-discarded':
      text = `${name(event.seat)}打出 ${event.tile.label}`;
      break;
    case 'peng':
    case 'ming-gang':
    case 'bu-gang':
      text = `${name(event.seat)}${{ peng: '碰牌', 'ming-gang': '明杠', 'bu-gang': '补杠' }[event.type]}成立：${event.tile.label}`;
      break;
    case 'an-gang':
      text = `${name(event.seat)}暗杠成立`;
      break;
    case 'hu': {
      const summary =
        (
          { 自摸胡: '自摸胡牌', 点炮胡: '点炮胡牌', 抢补杠胡: '抢补杠胡牌' } as Record<
            string,
            string
          >
        )[event.summary] ?? event.summary;
      const winners = event.winnerSeats.map(name).join('、');
      const source = event.fromSeat === null ? '' : `来源：${name(event.fromSeat)}`;
      text =
        event.winnerSeats.length > 1
          ? `多家胡牌：${winners}（${summary}${source ? `；${source}` : ''}）`
          : `${winners}${summary}${source ? `（${source}）` : ''}`;
      duration = 4800;
      break;
    }
    case 'draw':
      text = `流局：${event.summary}`;
      duration = 4800;
      break;
    case 'hand-settled':
      text =
        event.winnerSeats.length > 1
          ? `多家胡牌：${event.winnerSeats.map(name).join('、')}；本手结算完成`
          : `第 ${event.hand} 手结算完成`;
      duration = 4800;
      break;
    case 'special-rule-confirmed':
      text = `${name(event.seat)}${{ 'flower-kong': '花杠', 'four-winds-gathered': '四风归齐', 'follow-discard': '跟打一圈' }[event.rule]}成立`;
      duration = 4800;
      break;
    case 'mouth-locked':
      text = `${name(event.seat)}已锁定${name(event.fromSeat)}${event.mouths === 2 ? '两嘴' : '三嘴'}`;
      duration = 4800;
      break;
    case 'tile-drawn':
    case 'flower-replaced':
    case 'score-changed':
      return null;
    default:
      return null;
  }
  return { id: event.id, sequence: event.sequence, text, duration, emphasis: duration === 4800 };
}

export function createNotificationCursor() {
  return { roomId: null as string | null, sequence: 0, seenIds: new Set<number>() };
}

export function collectTableNotices(
  cursor: ReturnType<typeof createNotificationCursor>,
  room: RoomView,
): TableNotice[] {
  const events = [...room.tableEvents].sort((a, b) => a.sequence - b.sequence);
  if (cursor.roomId !== room.id) {
    cursor.roomId = room.id;
    cursor.sequence = events.at(-1)?.sequence ?? 0;
    cursor.seenIds = new Set(events.map((event) => event.id));
    return [];
  }
  const notices: TableNotice[] = [];
  for (const event of events) {
    if (event.sequence <= cursor.sequence) continue;
    cursor.sequence = event.sequence;
    if (cursor.seenIds.has(event.id)) continue;
    cursor.seenIds.add(event.id);
    const notice = notificationForEvent(event, room.players);
    if (notice) notices.push(notice);
  }
  return notices;
}
