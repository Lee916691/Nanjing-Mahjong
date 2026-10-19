import { createGame, createMatch, createNanjingMahjongDeck } from '@nanjing-mahjong/game-core';
import type { GameState, OrdinaryHandTile, TileId } from '@nanjing-mahjong/game-core';
import { newRoom } from '../src/table.js';

export function threeMouthRoom(selfDraw = false) {
  const room = newRoom('p0', '玩家0');
  room.members = [0, 1, 2, 3].map((i) => ({
    session: `p${i}`,
    name: `玩家${i}`,
    ready: true,
    joined: i,
  }));
  room.status = 'playing';
  const base = createGame();
  const deck = createNanjingMahjongDeck();
  const tile = (id: string) => deck.find((t) => t.id === (id as TileId)) as OrdinaryHandTile;
  const hand: GameState = {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    nextMeldSequence: 4,
    currentPlayerIndex: selfDraw ? 1 : 2,
    pendingAction: {
      type: 'discard',
      playerIndex: selfDraw ? 1 : 2,
      seat: selfDraw ? 'south' : 'west',
    },
    wall: [tile('wind-north-4'), tile('tong-9-4')],
    players: base.players.map((p, i) => ({
      ...p,
      hand:
        i === 1
          ? [
              ...(selfDraw ? [1, 2, 3, 4] : [2, 3]).map((n) => tile(`tong-8-${n}`)),
              tile('tiao-7-1'),
            ]
          : i === 2 && !selfDraw
            ? [tile('tong-8-1')]
            : [],
      melds:
        i === 1
          ? [1, 2, 3].map((rank) => ({
              id: `meld-${rank}`,
              type: 'peng' as const,
              tiles: [1, 2, 3].map((n) => tile(`wan-${rank}-${n}`)),
              fromPlayerIndex: 0,
              claimedTileId: `wan-${rank}-1` as TileId,
            }))
          : [],
    })),
    threeMouthState: [
      base.threeMouthState[0]!,
      { status: 'active', payerPlayerIndex: 0 },
      base.threeMouthState[2]!,
      base.threeMouthState[3]!,
    ],
    ...(selfDraw
      ? {
          selfDrawProvenance: {
            source: 'wall-head' as const,
            playerIndex: 1,
            tileId: 'tong-8-4' as const,
          },
        }
      : {}),
  };
  room.match = {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: hand,
  };
  return room;
}
