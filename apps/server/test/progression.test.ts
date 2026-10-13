import { describe, expect, it } from 'vitest';
import { createGame, createNanjingMahjongDeck } from '@nanjing-mahjong/game-core';
import type { TileId, OrdinaryHandTile, FlowerTile } from '@nanjing-mahjong/game-core';
import { newRoom, start, apply, advance, nextHand, choices } from '../src/table.js';
const deck = createNanjingMahjongDeck();
const tile = (id: TileId) => deck.find((t) => t.id === id) as OrdinaryHandTile;
describe('complete match progression', () => {
  it('resolves sixteen hands through legal discard/reaction actions and ends automatically', () => {
    const room = newRoom('one', '玩家');
    start(room);
    const firstDealer = room.match!.dealerIndex;
    for (let turn = 1; turn <= 16; turn++) {
      const dealer = room.match!.dealerIndex,
        winner = (dealer + 1) % 4;
      const base = createGame({ dealerIndex: dealer });
      const hand = [
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
      ] as TileId[];
      room.match = {
        ...room.match!,
        currentHand: {
          ...base,
          phase: 'playing',
          turnStage: 'waiting-for-discard',
          currentPlayerIndex: dealer,
          pendingAction: { type: 'discard', playerIndex: dealer, seat: base.players[dealer]!.seat },
          players: base.players.map((p, i) => ({
            ...p,
            hand: i === dealer ? [tile('wind-east-2')] : i === winner ? hand.map(tile) : [],
            flowers:
              i === winner ? [deck.find((t) => t.id === 'flower-red-center-1') as FlowerTile] : [],
          })),
          wall: [tile('tong-9-4')],
        },
      };
      apply(room, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
      room.epoch++;
      advance(room);
      const hu = choices(room, winner, 'test').find(
        (c) => c.action.type === 'SUBMIT_REACTION' && c.action.responseType === 'hu',
      );
      expect(hu).toBeDefined();
      room.reactions[String(winner)] = 'hu';
      advance(room);
      expect(room.match!.currentHandStatus).toBe('completed');
      const huScore = [...room.scores]
        .reverse()
        .find((score) => score.calculation?.winner === winner);
      expect(huScore?.calculation?.formula).toBe('(10+10+2+2)×2=48');
      expect(huScore?.calculation?.terms.at(-1)?.label).toBe('独占 1 花');
      expect(room.match!.cumulativeScores.reduce((a, b) => a + b)).toBe(4000);
      if (turn < 16) {
        expect(room.status).toBe('playing');
        expect(room.remainingMs).toBe(45000);
        expect(room.match!.effectiveDealerTurn).toBe(turn + 1);
        nextHand(room);
        expect(room.match!.currentHandIndex).toBe(turn);
        expect(room.match!.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
      }
    }
    expect(room.status).toBe('completed');
    expect(room.remainingMs).toBe(null);
    expect(room.match!.completedHands).toHaveLength(16);
    expect(room.match!.dealerIndex).toBe(firstDealer);
  });
  it('shuffles every newly started hand without dropping or duplicating tiles', () => {
    const first = newRoom('a', '甲'),
      second = newRoom('b', '乙');
    start(first);
    start(second);
    const game = first.match!.currentHand;
    const ids = [...game.wall, ...game.players.flatMap((p) => [...p.hand, ...p.flowers])].map(
      (t) => t.id,
    );
    expect(ids).toHaveLength(144);
    expect(new Set(ids).size).toBe(144);
    expect(game.wall.map((t) => t.id)).not.toEqual(second.match!.currentHand.wall.map((t) => t.id));
  });
});
