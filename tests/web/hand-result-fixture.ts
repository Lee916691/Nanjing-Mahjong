import { createGame } from '@nanjing-mahjong/game-core';
import { apply, advance } from '../../apps/server/src/table';
import {
  buGangRoom,
  eventRoom,
  ordinary,
  setEventHand,
} from '../../apps/server/test/event-fixture';
import { threeMouthRoom } from '../../apps/server/test/three-mouth-fixture';

export function settlementRoom(
  mode: 'self-draw' | 'discard' | 'rob-bu-gang' | 'draw' | 'three-mouth' | 'three-pure',
) {
  let room;
  if (mode === 'self-draw') {
    room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: [ordinary('wind-east-2')],
    });
    setEventHand(
      room,
      0,
      [
        'wan-1-1',
        'wan-2-1',
        'wan-3-1',
        'wan-4-1',
        'wan-5-1',
        'wan-6-1',
        'tiao-1-1',
        'tiao-2-1',
        'tiao-3-1',
        'tong-1-1',
        'tong-2-1',
        'tong-3-1',
        'wind-east-1',
      ].map(ordinary),
    );
    apply(room, { type: 'DRAW_TILE' });
    apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
  } else if (mode === 'draw') {
    room = eventRoom({
      turnStage: 'waiting-for-draw',
      wall: [],
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
    });
  } else if (mode === 'three-mouth') {
    room = threeMouthRoom();
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
    room.reactions['1'] = 'hu';
  } else if (mode === 'three-pure') {
    room = threeMouthRoom();
    const game = room.match!.currentHand;
    game.threeMouthState = createGame().threeMouthState;
    game.players = game.players.map((player, seat) =>
      seat === 1
        ? {
            ...player,
            hand: [2, 3, 4].map((copy) => ordinary(`wan-4-${copy}`)).concat(ordinary('tiao-7-1')),
            melds: player.melds.map((meld, index) => ({
              ...meld,
              type: 'ming-gang',
              tiles: [1, 2, 3, 4].map((copy) => ordinary(`wan-${index + 1}-${copy}`)),
            })),
          }
        : seat === 2
          ? { ...player, hand: [ordinary('wan-4-1')] }
          : player,
    );
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-4-1' });
    room.reactions['1'] = 'ming-gang';
  } else {
    room = buGangRoom();
    if (mode === 'discard') apply(room, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });
    else apply(room, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
    room.reactions = { '1': 'hu', '2': 'hu', '3': 'hu' };
  }
  advance(room);
  return room;
}
