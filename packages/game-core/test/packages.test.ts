import { describe, it, expect } from 'vitest';
import { threeMouth, threePure, updateRacks, packageNaturalWins } from '../src/packages.js';
import {
  createGame,
  createNanjingMahjongDeck,
  NANJING_OPEN_RULE_SET,
  applyAction,
  createMatch,
  settlePendingScoringEvents,
  completeCurrentHand,
} from '../src/index.js';
import type { GameState, Meld, OrdinaryHandTile, TileId } from '../src/index.js';
const deck = createNanjingMahjongDeck();
const tile = (id: TileId) => deck.find((t) => t.id === id) as OrdinaryHandTile;
function meld(
  rank: number,
  from: number | undefined = 0,
  suit = 'wan',
  type: 'peng' | 'an-gang' | 'bu-gang' = 'peng',
): Meld {
  return {
    id: 'meld-' + rank,
    type,
    tiles: [1, 2, 3, ...(type !== 'peng' ? [4] : [])].map((n) =>
      tile(`${suit}-${rank}-${n}` as TileId),
    ),
    ...(from === undefined
      ? {}
      : { fromPlayerIndex: from, claimedTileId: `${suit}-${rank}-3` as TileId }),
  };
}
describe('package prerequisites', () => {
  it('requires one unique supplier among the first three mouths', () => {
    expect(
      threeMouth([
        meld(1),
        meld(2, undefined, 'wan', 'an-gang'),
        meld(3, undefined, 'wan', 'an-gang'),
      ]),
    ).toBe(0);
    expect(
      threeMouth([
        meld(1, undefined, 'wan', 'an-gang'),
        meld(2, undefined, 'wan', 'an-gang'),
        meld(3),
      ]),
    ).toBe(0);
    expect(threeMouth([meld(1), meld(2, 2), meld(3)])).toBe(null);
    expect(
      threeMouth([
        meld(1, undefined, 'wan', 'an-gang'),
        meld(2, undefined, 'wan', 'an-gang'),
        meld(3, undefined, 'wan', 'an-gang'),
      ]),
    ).toBe(null);
    expect(threeMouth([meld(1), meld(2, 0, 'wan', 'bu-gang')])).toBe(null);
  });
  it('recognizes three same-category melds and invalidates a different category', () => {
    expect(threePure([meld(1), meld(2), meld(3)])).toBe('wan');
    expect(threePure([meld(1), meld(2), meld(3), meld(4, 0, 'tong')])).toBe(null);
  });
  it('records the rack only after the fourth peng discard and never revives changed waits', () => {
    const base = createGame();
    const melds = [meld(1), meld(2), meld(3), meld(4)];
    const before: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, melds, hand: [tile('tong-5-1'), tile('tong-7-1')] } : p,
      ),
    };
    const after: GameState = {
      ...before,
      players: before.players.map((p, i) => (i === 1 ? { ...p, hand: [tile('tong-7-1')] } : p)),
    };
    const tracked = updateRacks(before, after, { type: 'DISCARD_TILE', tileId: 'tong-5-1' });
    expect(tracked.globalRacks?.[1]?.tile.id).toBe('tong-5-1');
    const changed = {
      ...tracked,
      players: tracked.players.map((p, i) => (i === 1 ? { ...p, hand: [tile('tong-6-1')] } : p)),
    };
    const invalid = updateRacks(tracked, changed, { type: 'DISCARD_TILE', tileId: 'tong-7-1' });
    expect(invalid.globalRacks?.[1]?.active).toBe(false);
    expect(
      updateRacks(invalid, tracked, { type: 'DISCARD_TILE', tileId: 'tong-6-1' }).globalRacks?.[1]
        ?.active,
    ).toBe(false);
  });
});
describe('natural package settlement', () => {
  function state(): GameState {
    const base = createGame();
    const melds = [meld(1), meld(2), meld(3)];
    const player = {
      ...base.players[1]!,
      melds,
      hand: ['tong-5-1', 'tong-5-2', 'tong-5-3', 'tong-7-1'].map((id) => tile(id as TileId)),
    };
    const winningTile = tile('tong-7-2');
    const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 2,
      playerCount: 4,
      winningTile,
      concealedTiles: player.hand,
      melds,
      flowers: [],
      allMelds: melds,
      dealerIndex: 0,
    })!;
    return {
      ...base,
      players: base.players.map((p, i) => (i === 1 ? player : p)),
      threeMouthState: [
        base.threeMouthState[0],
        { status: 'active', payerPlayerIndex: 0 },
        base.threeMouthState[2],
        base.threeMouthState[3],
      ],
      phase: 'ended',
      turnStage: 'hand-ended',
      result: {
        type: 'win',
        source: 'discard',
        winningTile,
        payerPlayerIndex: 2,
        winners: [{ playerIndex: 1, evaluation }],
      },
      pendingScoringEvents: [
        {
          type: 'hu-resolved',
          source: 'discard',
          winningTile,
          payerPlayerIndex: 2,
          winnerPlayerIndex: 1,
          evaluation,
          status: 'pending',
          transfers: [{ fromPlayerIndex: 2, toPlayerIndex: 1, amount: 84 }],
        },
      ],
    };
  }
  it('three-mouth takes precedence and retains three independently paid shares', () => {
    const ended = state(),
      before = { ...ended, phase: 'playing' as const, result: undefined, pendingScoringEvents: [] };
    const next = packageNaturalWins(before, ended);
    expect(next.handProgressFacts.packageSettlementCount).toBe(1);
    const event = next.pendingScoringEvents[0]!;
    expect(event.transfers).toHaveLength(3);
    expect(event.transfers.every((t) => t.fromPlayerIndex === 0 && t.toPlayerIndex === 1)).toBe(
      true,
    );
    expect(packageNaturalWins(next, next)).toBe(next);
  });
  it('upgrades supplier-discard all-pungs to global without stacking both patterns', () => {
    const ended = state();
    if (ended.result?.type !== 'win' || ended.result.source === 'self-draw')
      throw new Error('fixture');
    ended.result = { ...ended.result, payerPlayerIndex: 0 };
    const event = ended.pendingScoringEvents[0]!;
    if (event.type !== 'hu-resolved' || event.source === 'self-draw') throw new Error('fixture');
    ended.pendingScoringEvents = [{ ...event, payerPlayerIndex: 0 }];
    const next = packageNaturalWins({ ...ended, phase: 'playing', result: undefined }, ended);
    const scored = next.pendingScoringEvents[0]!;
    if (scored.type !== 'hu-resolved') throw new Error('fixture');
    expect(scored.evaluation.patterns).toContain('global-single-wait');
    expect(scored.evaluation.patterns).not.toContain('all-pungs');
  });
});

it('a fourth peng opportunity offers special hu without forming a meld', () => {
  const base = createGame();
  const melds = [meld(1), meld(2), meld(3)];
  const before: GameState = {
    ...base,
    threeMouthState: [
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
      { status: 'active', payerPlayerIndex: 0 },
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
    ],
    nextMeldSequence: 4,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    players: base.players.map((p, i) => ({
      ...p,
      hand:
        i === 2
          ? [tile('tong-8-1')]
          : i === 1
            ? [tile('tong-8-2'), tile('tong-8-3'), tile('wan-5-1'), tile('tiao-7-1')]
            : [],
      melds: i === 1 ? melds : [],
    })),
    currentPlayerIndex: 2,
    pendingAction: { type: 'discard', playerIndex: 2, seat: 'west' },
    wall: [tile('wan-9-1')],
  };
  let next = applyAction(before, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
  for (const responder of next.reactionWindow!.responderOrder) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === 1 ? 'hu' : 'pass',
    });
  }
  next = applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(next.phase).toBe('ended');
  expect(next.result?.type).toBe('win');
  expect(next.players[1]!.melds).toHaveLength(3);
  const hu = next.pendingScoringEvents.find((e) => e.type === 'hu-resolved')!;
  expect(hu.transfers.every((t) => t.fromPlayerIndex === 0)).toBe(true);
  expect(next.pendingScoringEvents.map((e) => e.type)).toEqual(['hu-resolved']);
  expect(next.wall).toEqual(before.wall);
  const match = settlePendingScoringEvents({
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: next,
  });
  expect(match.cumulativeScores.reduce((a, b) => a + b)).toBe(4000);
  expect(completeCurrentHand(match).dealerIndex).toBe(0);
});

describe('package scoring combinations', () => {
  function finish(
    melds: Meld[],
    hand: TileId[],
    winning: TileId,
    payer: number,
    selfDraw = false,
  ): [GameState, GameState] {
    const base = createGame();
    const winningTile = tile(winning);
    const player = { ...base.players[1]!, melds, hand: hand.map(tile) };
    const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
      ...(selfDraw
        ? { source: 'self-draw' as const, drawSource: 'wall-head' as const }
        : { source: 'discard' as const, payerPlayerIndex: payer }),
      winnerPlayerIndex: 1,
      playerCount: 4,
      winningTile,
      concealedTiles: player.hand,
      melds,
      flowers: [],
      allMelds: melds,
      dealerIndex: 0,
    })!;
    expect(evaluation).not.toBeNull();
    const before: GameState = {
      ...base,
      phase: 'playing',
      players: base.players.map((p, i) => (i === 1 ? player : p)),
    };
    const event = selfDraw
      ? {
          type: 'hu-resolved' as const,
          source: 'self-draw' as const,
          drawSource: 'wall-head' as const,
          winningTile,
          winnerPlayerIndex: 1,
          evaluation,
          status: 'pending' as const,
          transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 1 }],
        }
      : {
          type: 'hu-resolved' as const,
          source: 'discard' as const,
          winningTile,
          payerPlayerIndex: payer,
          winnerPlayerIndex: 1,
          evaluation,
          status: 'pending' as const,
          transfers: [{ fromPlayerIndex: payer, toPlayerIndex: 1, amount: 1 }],
        };
    const after: GameState = {
      ...before,
      phase: 'ended',
      turnStage: 'hand-ended',
      result: selfDraw
        ? {
            type: 'win',
            source: 'self-draw',
            drawSource: 'wall-head',
            winningTile,
            winner: { playerIndex: 1, evaluation },
          }
        : {
            type: 'win',
            source: 'discard',
            winningTile,
            payerPlayerIndex: payer,
            winners: [{ playerIndex: 1, evaluation }],
          },
      pendingScoringEvents: [event],
    };
    return [before, after];
  }
  it('three-pure discard all-pungs becomes pure global and has exactly one payer', () => {
    const [before, after] = finish(
      [meld(1, 0), meld(2, 2), meld(3, 3)],
      ['wan-4-1', 'wan-4-2', 'wan-4-3', 'wan-5-1'],
      'wan-5-2',
      2,
    );
    const next = packageNaturalWins(before, after),
      event = next.pendingScoringEvents[0]!;
    if (event.type !== 'hu-resolved') throw new Error('event');
    expect(event.evaluation.patterns).toContain('pure-one-suit');
    expect(event.evaluation.patterns).toContain('global-single-wait');
    expect(event.evaluation.patterns).not.toContain('all-pungs');
    expect(event.transfers).toEqual(
      Array.from({ length: 3 }, () => ({ fromPlayerIndex: 2, toPlayerIndex: 1, amount: 320 })),
    );
  });
  it('three-pure self-draw and non-pure discard do not redirect', () => {
    const melds = [meld(1, 0), meld(2, 2), meld(3, 3)];
    let pair = finish(melds, ['wan-4-1', 'wan-4-2', 'wan-4-3', 'wan-5-1'], 'wan-5-2', 2, true);
    expect(packageNaturalWins(...pair)).toBe(pair[1]);
    pair = finish(melds, ['tong-4-1', 'tong-4-2', 'tong-4-3', 'tong-5-1'], 'tong-5-2', 2);
    expect(packageNaturalWins(...pair)).toBe(pair[1]);
  });
  it('global rack range redirects only a matching discard, not self-draw', () => {
    const melds = [meld(1, 0), meld(2, 2), meld(3, 3), meld(4, 0, 'tiao')];
    const [before, after] = finish(melds, ['tong-7-1'], 'tong-7-2', 2);
    before.globalRacks = {
      1: {
        tile: tile('tong-5-1'),
        wait: { category: 'number', suit: 'tong', rank: 7 },
        active: true,
      },
    };
    expect(packageNaturalWins(before, after).pendingScoringEvents[0]!.transfers).toHaveLength(3);
    before.globalRacks = { 1: { ...before.globalRacks[1]!, tile: tile('tong-4-1') } };
    expect(packageNaturalWins(before, after)).toBe(after);
    before.globalRacks = {
      1: { ...before.globalRacks[1]!, tile: tile('tong-5-1'), active: false },
    };
    expect(packageNaturalWins(before, after)).toBe(after);
    const pair = finish(melds, ['tong-7-1'], 'tong-7-2', 2, true);
    pair[0].globalRacks = {
      1: {
        tile: tile('tong-5-1'),
        wait: { category: 'number', suit: 'tong', rank: 7 },
        active: true,
      },
    };
    expect(packageNaturalWins(...pair)).toBe(pair[1]);
  });
});

describe('fourth kong and special hu timing (V1.0.9)', () => {
  function kongState(
    suppliers: number[],
    category = 'wan',
    tail: TileId = 'flower-red-center-4',
  ): GameState {
    const base = createGame();
    return {
      ...base,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      currentPlayerIndex: 2,
      pendingAction: { type: 'discard', playerIndex: 2, seat: 'west' },
      wall: [deck.find((t) => t.id === tail)!],
      players: base.players.map((p, i) => ({
        ...p,
        melds: i === 1 ? [meld(1, suppliers[0]), meld(2, suppliers[1]), meld(3, suppliers[2])] : [],
        hand:
          i === 2
            ? [tile(`${category}-8-1` as TileId)]
            : i === 1
              ? [2, 3, 4]
                  .map((n) => tile(`${category}-8-${n}` as TileId))
                  .concat([tile('tiao-7-1')])
              : [],
      })),
      threeMouthState: [
        { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
        suppliers.every((p) => p === suppliers[0])
          ? { status: 'active', payerPlayerIndex: suppliers[0]! }
          : { status: 'invalid' },
        { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
        { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
      ],
      nextMeldSequence: 4,
    };
  }
  function claim(state: GameState): GameState {
    let next = applyAction(state, { type: 'DISCARD_TILE', tileId: state.players[2]!.hand[0]!.id });
    for (const responder of next.reactionWindow!.responderOrder)
      next = applyAction(next, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType:
          responder.playerIndex === 1
            ? threeMouth(state.players[1]!.melds) === null
              ? 'ming-gang'
              : 'hu'
            : 'pass',
      });
    return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
  }
  it('special hu replaces the fourth ming-gang and does not pay or consume its tail', () => {
    const state = kongState([0, 0, 0]),
      next = claim(state);
    expect(next.result?.type).toBe('win');
    expect(next.wall).toEqual(state.wall);
    expect(next.players[1]!.melds).toHaveLength(3);
    expect(next.players[1]!.hand).toEqual(state.players[1]!.hand);
    expect(next.pendingScoringEvents.map((e) => e.type)).toEqual(['hu-resolved']);
    expect(next.handProgressFacts.packageSettlementCount).toBe(1);
    expect(next.handProgressFacts.successfulMingOrBuGangCount).toBe(0);
  });
  it('three-pure fourth same-suit ming-gang forces pure global paid by the discarder', () => {
    const next = claim(kongState([0, 2, 3]));
    if (next.result?.type !== 'package') throw new Error('result');
    expect(next.result.kind).toBe('three-pure');
    expect(next.result.payerPlayerIndex).toBe(2);
    expect(next.result.evaluation.patterns).toContain('pure-one-suit');
    expect(next.result.evaluation.patterns).toContain('global-single-wait');
  });
  it('three-mouth fourth an-gang is replaced by self-draw hu with no gang payment', () => {
    const base = kongState([0, 0, 0], 'tong', 'wan-9-1');
    const state: GameState = {
      ...base,
      currentPlayerIndex: 1,
      pendingAction: { type: 'discard' as const, playerIndex: 1, seat: 'south' as const },
      players: base.players.map((p, i) =>
        i === 1
          ? {
              ...p,
              hand: [1, 2, 3, 4]
                .map((n) => tile(`tong-8-${n}` as TileId))
                .concat([tile('tiao-7-1')]),
            }
          : { ...p, hand: [] },
      ),
    };
    state.selfDrawProvenance = { source: 'wall-head', playerIndex: 1, tileId: 'tong-8-4' };
    expect(
      applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: { category: 'number', suit: 'tong', rank: 8 },
      }),
    ).toBe(state);
    const next = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(next.result?.type).toBe('win');
    expect(next.players[1]!.melds).toHaveLength(3);
    expect(next.pendingScoringEvents.map((e) => e.type)).toEqual(['hu-resolved']);
    expect(next.pendingScoringEvents[0]!.transfers).toHaveLength(3);
    expect(next.wall).toEqual(state.wall);
    expect(next.handProgressFacts.successfulAnGangCount).toBe(0);
  });
  it('same-suit fourth an-gang with no three-mouth supplier continues normally', () => {
    const base = kongState([0, 2, 3], 'wan', 'tong-9-1');
    const state = {
      ...base,
      currentPlayerIndex: 1,
      pendingAction: { type: 'discard' as const, playerIndex: 1, seat: 'south' as const },
      players: base.players.map((p, i) =>
        i === 1
          ? {
              ...p,
              hand: [1, 2, 3, 4]
                .map((n) => tile(`wan-8-${n}` as TileId))
                .concat([tile('tiao-7-1')]),
            }
          : p,
      ),
    };
    const next = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 8 },
    });
    expect(next.phase).toBe('playing');
    expect(next.wall).toHaveLength(0);
    expect(next.handProgressFacts.packageSettlementCount).toBe(0);
  });
});

it('three-mouth bu-gang tail hu uses global plus gang-kai once, with the bu-gang fee separate', () => {
  const base = createGame();
  const melds = [meld(1, 0), meld(2, 0), meld(3, 0)];
  const target = tile('wan-1-4');
  const before: GameState = {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    currentPlayerIndex: 1,
    pendingAction: { type: 'discard', playerIndex: 1, seat: 'south' },
    threeMouthState: [
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
      { status: 'active', payerPlayerIndex: 0 },
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
      { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: null },
    ],
    nextMeldSequence: 4,
    players: base.players.map((p, i) =>
      i === 1
        ? {
            ...p,
            melds,
            hand: ['tong-5-1', 'tong-5-2', 'tong-5-3', 'tong-7-1']
              .map((id) => tile(id as TileId))
              .concat([target]),
            buGangDrawProvenance: [{ targetMeldId: 'meld-1', tileId: target.id }],
          }
        : p,
    ),
    wall: [tile('tong-7-2')],
    selfDrawProvenance: { source: 'wall-head', playerIndex: 1, tileId: target.id },
  };
  let next = applyAction(before, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: 'meld-1' });
  expect(next.reactionWindow?.source).toBe('bu-gang');
  for (const r of next.reactionWindow!.responderOrder)
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: r.playerIndex,
      responseType: 'pass',
    });
  next = applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(next.phase).toBe('playing');
  const ended = applyAction(next, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
  expect(ended.phase).toBe('ended');
  const event = ended.pendingScoringEvents.find((e) => e.type === 'hu-resolved');
  if (!event || event.type !== 'hu-resolved') throw new Error('hu event');
  expect(event.evaluation.patterns).toContain('global-single-wait');
  expect(event.evaluation.patterns).toContain('gang-kai');
  expect(event.evaluation.patterns).not.toContain('all-pungs');
  expect(event.transfers).toHaveLength(3);
  expect(event.transfers.every((t) => t.fromPlayerIndex === 0)).toBe(true);
  expect(ended.pendingScoringEvents.filter((e) => e.type === 'bu-gang-created')).toHaveLength(1);
  expect(ended.handProgressFacts.packageSettlementCount).toBe(1);
  expect(ended.handProgressFacts.gangKaiCount).toBe(1);
});

it('legacy in-progress games retain the automatic fourth-meld rule', () => {
  const base = createGame();
  const state: GameState = {
    ...base,
    legacyThreeMouth: true,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    currentPlayerIndex: 2,
    pendingAction: { type: 'discard', playerIndex: 2, seat: 'west' },
    nextMeldSequence: 4,
    wall: [tile('wan-9-1')],
    players: base.players.map((p, i) => ({
      ...p,
      melds: i === 1 ? [meld(1), meld(2), meld(3)] : [],
      hand:
        i === 2
          ? [tile('tong-8-1')]
          : i === 1
            ? [tile('tong-8-2'), tile('tong-8-3'), tile('wan-5-1'), tile('tiao-7-1')]
            : [],
    })),
  };
  let next = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
  expect(
    next.reactionWindow!.availableReactions.find((r) => r.playerIndex === 1)!.responseTypes,
  ).toContain('peng');
  for (const r of next.reactionWindow!.responderOrder)
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: r.playerIndex,
      responseType: r.playerIndex === 1 ? 'peng' : 'pass',
    });
  next = applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(next.result?.type).toBe('package');
  expect(next.players[1]!.melds).toHaveLength(4);
  expect(next.legacyThreeMouth).toBe(true);
});
