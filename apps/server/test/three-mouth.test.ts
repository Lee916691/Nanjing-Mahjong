import { describe, expect, it } from 'vitest';
import { advance, apply, choices, restoreRoomRules, start, view } from '../src/table.js';
import { Store } from '../src/store.js';
import { threeMouthRoom } from './three-mouth-fixture.js';

const online = new Set(['p0', 'p1', 'p2', 'p3']);
describe('three-mouth multiplayer integration', () => {
  it('completes supplier-triggered special hu and self-draw special hu', () => {
    for (const selfDraw of [false, true]) {
      const room = threeMouthRoom(selfDraw);
      if (selfDraw) apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
      else {
        const game = room.match!.currentHand;
        game.players = game.players.map((p, i) =>
          i === 0 ? { ...p, hand: game.players[2]!.hand } : i === 2 ? { ...p, hand: [] } : p,
        );
        game.currentPlayerIndex = 0;
        game.pendingAction = { type: 'discard', playerIndex: 0, seat: 'east' };
        apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
        room.reactions['1'] = 'hu';
      }
      advance(room);
      expect(room.match!.currentHandStatus).toBe('completed');
      expect(
        room.match!.currentHand.threeMouthState.every(
          (p) => p.status === 'tracking' && p.mouthCount === 0 && p.lockedPayerPlayerIndex === null,
        ),
      ).toBe(true);
      expect(room.scores.at(-1)!.reason).toContain('global-single-wait');
      expect(room.scores.at(-1)!.transfers).toHaveLength(3);
    }
  });
  it('offers hu/pass, persists the pending opportunity and settles the responsible player once', () => {
    const room = threeMouthRoom();
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
    advance(room);
    const store = new Store(':memory:');
    try {
      store.commit(room);
      const restored = store.rooms()[0]!;
      expect(choices(restored, 1, 'secret').map((c) => c.view.kind)).toEqual(['pass', 'hu']);
      const safe = view(restored, 'p2', online, 'secret');
      expect(JSON.stringify(safe)).not.toContain('threeMouthState');
      expect(JSON.stringify(safe)).not.toContain('lockedPayerPlayerIndex');
      restored.reactions['1'] = 'hu';
      advance(restored);
      expect(restored.match!.currentHandStatus).toBe('completed');
      expect(restored.match!.currentHand.players[1]!.melds).toHaveLength(3);
      const score = restored.scores.at(-1)!;
      expect(score.reason).toContain('three-mouth');
      expect(score.responsibility).toEqual({ trigger: 2, payer: 0 });
      expect(score.transfers).toHaveLength(3);
      expect(score.transfers.every((t) => t.from === 0 && t.to === 1)).toBe(true);
      expect(score.calculation!.total).toBe(score.transfers.reduce((sum, t) => sum + t.amount, 0));
      const savedScores = structuredClone(restored.scores);
      advance(restored);
      expect(restored.scores).toEqual(savedScores);
    } finally {
      store.close();
    }
  });
  it('passes discard special hu and keeps the active state across refresh', () => {
    const room = threeMouthRoom();
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
    room.reactions['1'] = 'pass';
    advance(room);
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    expect(restored.match!.currentHand.threeMouthState[1]!).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
    });
    expect(restored.match!.currentHand.phase).toBe('playing');
    expect(restored.scores).toEqual([]);
  });
  it('offers self-draw hu and legal discards, never an-gang, and can decline by discarding', () => {
    const room = threeMouthRoom(true);
    const actions = choices(room, 1, 'secret');
    expect(actions.some((c) => c.action.type === 'DECLARE_SELF_DRAW_HU')).toBe(true);
    expect(actions.some((c) => c.action.type === 'DECLARE_AN_GANG')).toBe(false);
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-4' });
    expect(room.match!.currentHand.threeMouthState[1]!.status).toBe('active');
    expect(room.scores).toEqual([]);
  });
  it('loads V1.0.8 without changing scores or pending responses, then uses V1.0.11 for a new match', () => {
    const room = threeMouthRoom();
    room.rules = 'V1.0.8';
    room.match!.currentHand.legacyThreeMouth = true;
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
    const raw = JSON.parse(JSON.stringify(room));
    delete raw.match.currentHand.threeMouthState;
    const restored = restoreRoomRules(raw);
    expect(restored.match!.currentHand.legacyThreeMouth).toBe(true);
    expect(restored.match!.cumulativeScores).toEqual(room.match!.cumulativeScores);
    expect(restored.reactions).toEqual(room.reactions);
    expect(restored.match!.currentHand.reactionWindow).toEqual(
      room.match!.currentHand.reactionWindow,
    );
    start(restored);
    expect(restored.rules).toBe('V1.0.11');
    expect(restored.match!.currentHand.legacyThreeMouth).toBeUndefined();
  });
  it.each(['V1.0.9', 'V1.0.10'] as const)(
    'upgrades %s room metadata without changing stored history',
    (version) => {
      const room = threeMouthRoom();
      room.rules = version;
      room.scores = [
        {
          hand: 1,
          reason: 'discard、men-qing、seven-pairs',
          transfers: [{ from: 1, to: 0, amount: 148 }],
          calculation: {
            terms: [{ label: '七对', points: 50 }],
            factors: [],
            formula: '历史快照',
            perPayment: 148,
            payments: 1,
            total: 148,
          },
        },
      ];
      const before = structuredClone(room);
      const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
      expect(restored).toEqual({ ...before, rules: 'V1.0.11' });
      const store = new Store(':memory:');
      try {
        store.commit(restored);
        expect(store.rooms()[0]).toEqual(restored);
        expect(
          store.db.prepare("SELECT value FROM metadata WHERE key='version'").get()?.value,
        ).toBe('2:room-modes');
      } finally {
        store.close();
      }
    },
  );
});
