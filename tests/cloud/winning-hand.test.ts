import { expect, it } from 'vitest';
import { createGame, createMatch, createNanjingMahjongDeck } from '@nanjing-mahjong/game-core';
import type { OrdinaryHandTile } from '@nanjing-mahjong/game-core';
import {
  newRoom,
  apply,
  view,
  advance,
  confirmNextHand,
  reviewToken,
} from '../../apps/server/src/table';

it('records the winning rack once and only reveals the winner after settlement', () => {
  const deck = createNanjingMahjongDeck();
  const tile = (id: string) => deck.find((t) => t.id === id)! as OrdinaryHandTile;
  const ids = [
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
  ];
  const room = newRoom('owner', '房主');
  for (let i = 1; i < 4; i++)
    room.members[i] = { session: 'p' + i, name: '朋友' + i, ready: true, joined: i };
  room.status = 'playing';
  const base = createGame();
  room.match = {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: {
      ...base,
      players: base.players.map((p, i) => ({
        ...p,
        hand: i === 0 ? ids.map(tile) : [tile('tong-9-' + i)],
      })),
      wall: [tile('wind-east-2')],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-draw',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
    },
  };
  const online = new Set(['owner', 'p1', 'p2', 'p3']);
  expect(view(room, 'p1', online, 'secret').scores).toHaveLength(0);
  apply(room, { type: 'DRAW_TILE' });
  apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
  const visible = view(room, 'p1', online, 'secret');
  const rack = visible.scores.find((s) => s.winningHand)?.winningHand;
  expect(rack?.concealed).toHaveLength(13);
  expect(rack?.winningTile).toEqual({ family: 'wind', label: '东' });
  expect(JSON.stringify(rack)).not.toMatch(/"id"\s*:/);
  expect(room.scores[0]!.winningHand!.winningTile.id).toBe('wind-east-2');
  expect(room.scores[0]!.winningHand!.concealed.some((t) => t.id === 'wind-east-2')).toBe(false);
  expect(visible.players[0]?.hand).toBeUndefined();
  expect(visible.players[2]?.hand).toBeUndefined();
  expect(
    JSON.parse(JSON.stringify(room), (key, value) => (key === 'id' ? undefined : value)).scores[0]
      .winningHand,
  ).toEqual(rack);
  advance(room);
  const hand = room.match!.currentHandIndex;
  const token = reviewToken(room, 'secret');
  confirmNextHand(room, 0, token, online, 'secret');
  confirmNextHand(room, 0, token, online, 'secret');
  expect(room.nextHandReady).toEqual([0]);
  confirmNextHand(room, 1, token, online, 'secret');
  confirmNextHand(room, 2, token, online, 'secret');
  expect(room.match!.currentHandIndex).toBe(hand);
  expect(() => confirmNextHand(room, 3, token, new Set(['owner', 'p1', 'p2']), 'secret')).toThrow(
    '掉线',
  );
  const restored = JSON.parse(JSON.stringify(room)) as typeof room;
  expect(restored.nextHandReady).toEqual([0, 1, 2]);
  confirmNextHand(restored, 3, token, online, 'secret');
  expect(restored.match!.currentHandIndex).toBe(hand + 1);
  expect(restored.nextHandReady).toEqual([]);
  expect(restored.remainingMs).toBeNull();
  expect(() => confirmNextHand(restored, 3, token, online, 'secret')).toThrow();
});
