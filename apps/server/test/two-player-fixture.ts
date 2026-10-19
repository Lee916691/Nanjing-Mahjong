import { createGame, createNanjingMahjongDeck } from '@nanjing-mahjong/game-core';
import type { GameState, OrdinaryHandTile } from '@nanjing-mahjong/game-core';
import { advance, apply, newRoom, start } from '../src/table.js';
import type { SavedRoom } from '../src/table.js';
const mode = 'nanjing-open-duo' as const;

export function twoPlayerRoom() {
  const value = newRoom('p0', '玩家0', mode);
  value.members[1] = { session: 'p1', name: '玩家1', ready: true, joined: 1 };
  value.members[0]!.ready = true;
  start(value);
  return value;
}

export function prepareTwoPlayerWin(value: SavedRoom, bigHand = false) {
  const deck = createNanjingMahjongDeck();
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
  if (bigHand)
    ids.splice(
      0,
      ids.length,
      ...[
        'wan-1-1',
        'wan-1-2',
        'wan-2-1',
        'wan-2-2',
        'wan-3-1',
        'wan-3-2',
        'tiao-1-1',
        'tiao-1-2',
        'tiao-2-1',
        'tiao-2-2',
        'tong-1-1',
        'tong-1-2',
        'tong-2-1',
      ],
    );
  const winner = 1 - value.match!.dealerIndex;
  const base = createGame({ ruleSetId: mode, dealerIndex: value.match!.dealerIndex });
  const hand = ids.map((id) => deck.find((entry) => entry.id === id)! as OrdinaryHandTile);
  const flowers = deck.filter(
    (entry) => entry.id === 'flower-plum-1' || entry.id === 'flower-orchid-1',
  );
  const winning = deck.find((entry) => entry.id === (bigHand ? 'tong-2-2' : 'wind-east-2'))!;
  const used = new Set([...hand, ...flowers, winning].map((entry) => entry.id));
  const other = deck
    .filter((entry) => entry.category !== 'flower' && !used.has(entry.id))
    .slice(0, 13);
  other.forEach((entry) => used.add(entry.id));
  const state = {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-draw',
    currentPlayerIndex: winner,
    pendingAction: { type: 'draw', playerIndex: winner, seat: base.players[winner]!.seat },
    players: base.players.map((player, index) =>
      index === winner ? { ...player, hand, flowers } : { ...player, hand: other },
    ),
    wall: [winning, ...deck.filter((entry) => !used.has(entry.id))],
  } as GameState;
  value.match = { ...value.match!, currentHandStatus: 'playing', currentHand: state };
  return winner;
}

export function completeTwoPlayerWin(value: SavedRoom) {
  const winner = prepareTwoPlayerWin(value);
  apply(value, { type: 'DRAW_TILE' });
  apply(value, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: winner });
  advance(value);
}
