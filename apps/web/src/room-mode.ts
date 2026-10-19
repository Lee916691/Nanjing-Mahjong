import type { RoomView } from '@nanjing-mahjong/shared-types';

export function isSupportedRoomMode(room: RoomView): boolean {
  const count =
    room.ruleSetId === 'nanjing-open-duo' ? 2 : room.ruleSetId === 'nanjing-open' ? 4 : 0;
  const index = (value: unknown) =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) < count;
  return (
    count > 0 &&
    Array.isArray(room.players) &&
    room.players.length === count &&
    room.totalEffectiveDealerTurns === count * 4 &&
    index(room.self) &&
    index(room.host) &&
    index(room.dealer) &&
    (room.current === null || index(room.current)) &&
    Number.isInteger(room.effectiveTurn) &&
    room.effectiveTurn >= 1 &&
    room.effectiveTurn <= room.totalEffectiveDealerTurns &&
    room.players.every((player, seat) => player === null || player.seat === seat)
  );
}

export function relativeSeat(room: RoomView, seat: number): number {
  return room.ruleSetId === 'nanjing-open-duo'
    ? seat === room.self
      ? 0
      : 2
    : (seat - room.self + 4) % 4;
}

export function roomModeName(room: RoomView): string {
  return room.ruleSetId === 'nanjing-open-duo' ? '双人敞开头' : '四人敞开头';
}
