import { describe, expect, it, vi } from 'vitest';
import * as core from '@nanjing-mahjong/game-core';
import type { GameAction, ThreeMouthPlayerState } from '@nanjing-mahjong/game-core';
import { advance, apply, restoreRoomRules, start, view } from '../src/table.js';
import { eventRoom, eventTile, ordinary, setEventHand } from './event-fixture.js';

const confirmed = (room: ReturnType<typeof eventRoom>) =>
  room.tableEvents.filter((event) => event.type === 'special-rule-confirmed');
const locks = (room: ReturnType<typeof eventRoom>) =>
  room.tableEvents.filter((event) => event.type === 'mouth-locked');
function claim(room: ReturnType<typeof eventRoom>, kind: 'peng' | 'ming-gang' | 'pass') {
  for (const seat of [1, 2, 3])
    apply(room, {
      type: 'SUBMIT_REACTION',
      playerIndex: seat,
      responseType: seat === 1 ? kind : 'pass',
    });
  apply(room, { type: 'RESOLVE_REACTION_WINDOW' });
}
function mouthRoom(mouth: ThreeMouthPlayerState) {
  const room = eventRoom();
  const game = room.match!.currentHand;
  game.threeMouthState = [
    game.threeMouthState[0]!,
    mouth,
    game.threeMouthState[2]!,
    game.threeMouthState[3]!,
  ];
  setEventHand(room, 0, [ordinary('wan-1-1')]);
  setEventHand(
    room,
    1,
    [2, 3, 4].map((copy) => ordinary(`wan-1-${copy}`)),
  );
  return room;
}

describe('special rule confirmation events', () => {
  it('does not turn an ordinary flower replacement into a flower-kong confirmation', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: ['flower-plum-1', 'wan-9-1'].map(eventTile),
    });
    apply(room, { type: 'DRAW_TILE' });
    expect(room.tableEvents.map((event) => event.type)).toEqual([
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
    ]);
    expect(room.scores).toEqual([]);
  });
  it('creates initial flower facts before settlement, preserving multiple combinations', () => {
    const random = vi.spyOn(core, 'applyAction');
    // Keep the real reducer; only fix the wall for the randomized server deal.
    random.mockImplementation((state, action) => {
      if (action.type === 'START_GAME') {
        const deck = core.createNanjingMahjongDeck();
        const flowers = deck.filter(
          (tile) => tile.category === 'flower' && tile.flowerGroup === 'four-copy',
        );
        const ids = new Set<string>(flowers.map((tile) => tile.id));
        const rest = deck.filter((tile) => !ids.has(tile.id));
        const head = Array.from({ length: 48 }, (_, index) =>
          index % 4 === 0 ? flowers.shift()! : rest.shift()!,
        );
        state.wall = [...head, ...rest];
      }
      return realApply(state, action);
    });
    const room = eventRoom();
    try {
      start(room);
      expect(confirmed(room)).toHaveLength(5);
      expect(new Set(confirmed(room).map((event) => event.id)).size).toBe(5);
      expect(confirmed(room).length).toBe(
        room.scores.filter((score) => score.reason === 'flower-kong-created').length,
      );
      expect(
        confirmed(room).every(
          (event) =>
            event.sequence <
            room.tableEvents.find((candidate) => candidate.type === 'score-changed')!.sequence,
        ),
      ).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it.each([false, true])('uses effective runtime flower results (last flower=%s)', (last) => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: (last ? ['flower-red-center-4'] : ['flower-red-center-4', 'wan-9-1']).map(eventTile),
    });
    const game = room.match!.currentHand;
    game.players = game.players.map((player, seat) =>
      seat === 0
        ? {
            ...player,
            flowers: core
              .createNanjingMahjongDeck()
              .filter((tile) => tile.category === 'flower')
              .filter((tile) =>
                ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].includes(
                  tile.id,
                ),
              ),
          }
        : player,
    );
    apply(room, { type: 'DRAW_TILE' });
    expect(confirmed(room)).toEqual(
      last ? [] : [expect.objectContaining({ rule: 'flower-kong', seat: 0 })],
    );
    if (!last) expect(confirmed(room)[0]!.sequence).toBeLessThan(room.tableEvents.at(-1)!.sequence);
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    expect(restored.tableEvents).toEqual(room.tableEvents);
    expect(view(restored, 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'secret').tableEvents).toEqual(
      room.tableEvents,
    );
  });

  it('confirms before scoring is consumed, without changing the scoring call order', () => {
    const room = eventRoom();
    const game = room.match!.currentHand;
    game.specialDiscardTracking = {
      ...game.specialDiscardTracking,
      windSequences: game.specialDiscardTracking.windSequences.map((sequence, seat) =>
        seat === 0 ? { playerIndex: 0, winds: ['east', 'south', 'west'] } : sequence,
      ),
    };
    setEventHand(room, 0, [ordinary('wind-north-1')]);
    const settle = vi.spyOn(core, 'settlePendingScoringEvents').mockImplementation((match) => {
      expect(confirmed(room)).toEqual([
        expect.objectContaining({ rule: 'four-winds-gathered', seat: 0 }),
      ]);
      expect(room.scores).toEqual([]);
      return realSettle(match);
    });
    try {
      apply(room, { type: 'DISCARD_TILE', tileId: 'wind-north-1' });
      expect(settle).toHaveBeenCalledOnce();
      expect(room.match!.currentHand.turnStage).toBe('waiting-for-reaction');
      expect(room.tableEvents.map((event) => event.type)).toEqual([
        'tile-discarded',
        'special-rule-confirmed',
        'score-changed',
      ]);
    } finally {
      settle.mockRestore();
    }
  });

  it.each([0, 1, 2])(
    'only confirms a completed follow cycle (%s prior followers)',
    (followerCount) => {
      const room = eventRoom();
      room.match!.currentHand.specialDiscardTracking = {
        ...room.match!.currentHand.specialDiscardTracking,
        followDiscard: {
          initiatorPlayerIndex: (3 - followerCount + 4) % 4,
          expectedPlayerIndex: 0,
          followerCount,
          tileFace: { category: 'number', suit: 'wan', rank: 1 },
        },
      };
      setEventHand(room, 0, [ordinary('wan-1-1')]);
      apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
      expect(confirmed(room)).toEqual(
        followerCount === 2 ? [expect.objectContaining({ rule: 'follow-discard', seat: 1 })] : [],
      );
    },
  );

  it('does not confirm a mismatched follow and resets a wind sequence', () => {
    const room = eventRoom();
    const game = room.match!.currentHand;
    game.specialDiscardTracking = {
      followDiscard: {
        initiatorPlayerIndex: 1,
        expectedPlayerIndex: 0,
        followerCount: 2,
        tileFace: { category: 'number', suit: 'wan', rank: 2 },
      },
      windSequences: game.specialDiscardTracking.windSequences.map((sequence, seat) =>
        seat === 0 ? { playerIndex: 0, winds: ['east', 'south', 'west'] } : sequence,
      ),
    };
    setEventHand(room, 0, [ordinary('wan-1-1')]);
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    expect(confirmed(room)).toEqual([]);
    expect(game.specialDiscardTracking.windSequences[0]!.winds).toHaveLength(3);
    expect(room.match!.currentHand.specialDiscardTracking.windSequences[0]!.winds).toEqual([]);
    const saved = structuredClone(room);
    expect(() => apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' })).toThrow();
    expect(room).toEqual(saved);
  });

  it('only repeats wind confirmation after a new full sequence of real discards', () => {
    const east = [
      'wind-east-1',
      'wind-east-2',
      'wind-south-1',
      'wind-west-1',
      'wind-north-1',
      'wind-north-2',
      'wind-east-3',
      'wind-south-2',
      'wind-west-2',
    ];
    const hands = [
      east,
      ...['tiao', 'tong', 'wan'].map((suit) =>
        Array.from({ length: 8 }, (_, index) => `${suit}-${index + 1}-1`),
      ),
    ];
    const used = new Set(hands.flat());
    const room = eventRoom({
      wall: core
        .createNanjingMahjongDeck()
        .filter((tile) => tile.category !== 'flower')
        .filter((tile) => !used.has(tile.id))
        .slice(0, 40),
    });
    hands.forEach((hand, seat) => setEventHand(room, seat, hand.map(ordinary)));
    east.forEach((tileId, round) => {
      const discards =
        round === east.length - 1
          ? [tileId]
          : [tileId, ...hands.slice(1).map((hand) => hand[round]!)];
      for (const id of discards) {
        apply(room, { type: 'DISCARD_TILE', tileId: id });
        if (id === tileId)
          expect(
            room.scores.filter((score) => score.reason === 'four-winds-gathered'),
          ).toHaveLength(round < 4 ? 0 : round < 8 ? 1 : 2);
        for (const seat of room.match!.currentHand.reactionWindow!.responderOrder)
          room.reactions[String(seat.playerIndex)] = 'pass';
        advance(room);
      }
    });
    expect(confirmed(room).filter((event) => event.rule === 'four-winds-gathered')).toHaveLength(2);
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    advance(restored);
    expect(restored.tableEvents).toEqual(room.tableEvents);
  });

  it('does not lock when the engine rejects an invalid response or an exhausted-tail AnGang', () => {
    const room = mouthRoom({ status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 });
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    const saved = structuredClone(room);
    expect(() =>
      apply(room, { type: 'SUBMIT_REACTION', playerIndex: 3, responseType: 'peng' }),
    ).toThrow();
    expect(room).toEqual(saved);
    const gang = eventRoom({ wall: [] });
    const game = gang.match!.currentHand;
    game.threeMouthState = [
      { status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 2 },
      game.threeMouthState[1]!,
      game.threeMouthState[2]!,
      game.threeMouthState[3]!,
    ];
    setEventHand(
      gang,
      0,
      [1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}`)),
    );
    const before = structuredClone(gang);
    expect(() =>
      apply(gang, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toThrow();
    expect(gang).toEqual(before);
  });
});

const realApply = core.applyAction;
const realSettle = core.settlePendingScoringEvents;

describe('authoritative mouth lock events', () => {
  it.each(['peng', 'ming-gang'] as const)('confirms two mouths only after %s resolves', (kind) => {
    const room = mouthRoom({ status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 });
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    expect(locks(room)).toEqual([]);
    claim(room, kind);
    expect(locks(room)).toEqual([expect.objectContaining({ seat: 1, fromSeat: 0, mouths: 2 })]);
    const types = room.tableEvents.map((event) => event.type);
    expect(types.indexOf('mouth-locked')).toBe(types.indexOf(kind) + 1);
    if (kind === 'ming-gang')
      expect(types.indexOf('mouth-locked')).toBeLessThan(types.indexOf('tile-drawn'));
    const saved = structuredClone(room);
    expect(() => apply(room, { type: 'RESOLVE_REACTION_WINDOW' })).toThrow();
    expect(room).toEqual(saved);
    const online = new Set(['p0', 'p1', 'p2', 'p3']);
    for (const seat of [0, 1, 2, 3])
      expect(view(room, `p${seat}`, online, 'secret').tableEvents).toEqual(room.tableEvents);
  });

  it.each([0, null])(
    'directly activates three mouths from two tracked mouths (payer=%s)',
    (payer) => {
      const room = mouthRoom({ status: 'tracking', mouthCount: 2, lockedPayerPlayerIndex: payer });
      apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
      claim(room, 'peng');
      expect(locks(room)).toEqual([expect.objectContaining({ seat: 1, fromSeat: 0, mouths: 3 })]);
      expect(room.match!.currentHand.phase).toBe('playing');
    },
  );

  it.each([null, 2])('does not invent a lock for a pass or different source (%s)', (payer) => {
    const room = mouthRoom({ status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: payer });
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    claim(room, payer === null ? 'pass' : 'peng');
    expect(locks(room)).toEqual([]);
  });

  it('emits two then three on successful AnGang and suppresses anonymous/failed/legacy locks', () => {
    for (const payer of [2, null]) {
      const room = eventRoom({ wall: ['tong-9-1', 'tong-9-2'].map(ordinary) });
      const game = room.match!.currentHand;
      game.threeMouthState = [
        { status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: payer },
        game.threeMouthState[1]!,
        game.threeMouthState[2]!,
        game.threeMouthState[3]!,
      ];
      setEventHand(
        room,
        0,
        [1, 2].flatMap((rank) => [1, 2, 3, 4].map((copy) => ordinary(`wan-${rank}-${copy}`))),
      );
      for (const rank of [1, 2]) {
        const action: GameAction = {
          type: 'DECLARE_AN_GANG',
          playerIndex: 0,
          tileFace: { category: 'number', suit: 'wan', rank: rank as 1 | 2 },
        };
        apply(room, action);
        const saved = structuredClone(room);
        expect(() => apply(room, action)).toThrow();
        expect(room).toEqual(saved);
      }
      expect(locks(room).map((event) => event.mouths)).toEqual(payer === null ? [] : [2, 3]);
      expect(locks(room).every((event) => event.seat === 0 && event.fromSeat === 2)).toBe(true);
      advance(restoreRoomRules(JSON.parse(JSON.stringify(room))));
    }
    const legacy = mouthRoom({ status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 });
    legacy.rules = 'V1.0.8';
    restoreRoomRules(legacy);
    apply(legacy, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    claim(legacy, 'peng');
    expect(locks(legacy)).toEqual([]);
  });
});
