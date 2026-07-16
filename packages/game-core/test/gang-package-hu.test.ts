import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NANJING_OPEN_RULE_SET,
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableSelfDrawHu,
  getAvailableAnGangs,
  prepareNextHand,
  type GameState,
  type FlowerTile,
  type MatchState,
  type OrdinaryHandTile,
  type ScoreTransfer,
  type Tile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();
const winningTileId = 'wind-east-2' satisfies TileId;
const oneMeldWait = [
  'wan-1-1',
  'wan-2-1',
  'wan-3-1',
  'tiao-1-1',
  'tiao-2-1',
  'tiao-3-1',
  'tong-1-1',
  'tong-2-1',
  'tong-3-1',
  'wind-east-1',
] satisfies TileId[];

function ordinary(id: TileId): OrdinaryHandTile {
  const tile = deck.find((candidate) => candidate.id === id);
  if (!tile || tile.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return tile;
}

function flower(id: TileId): FlowerTile {
  const tile = deck.find((candidate) => candidate.id === id);
  if (!tile || tile.category !== 'flower') throw new Error(`Missing flower tile ${id}`);
  return tile;
}

function submitAll(state: GameState, winnerResponse: 'ming-gang' | 'pass'): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === 1 ? winnerResponse : 'pass',
    });
  }
  return next;
}

function realMingGangTail(tail: readonly Tile[] = [ordinary(winningTileId)]): GameState {
  const base = createGame();
  const beforeDiscard: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-9-1')]
          : index === 1
            ? [...oneMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4'].map((id) => ordinary(id as TileId))
            : [],
    })),
    wall: [...tail],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  const opened = applyAction(beforeDiscard, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
  return applyAction(submitAll(opened, 'ming-gang'), { type: 'RESOLVE_REACTION_WINDOW' });
}

function matchWithHand(hand: GameState, effectiveDealerTurn = 1): MatchState {
  return {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    effectiveDealerTurn,
    isFinalDealerTurn: effectiveDealerTurn === 16,
    currentHand: hand,
  };
}

const validBaseTransfers = [
  { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 148 },
  { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 148 },
  { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 148 },
] satisfies ScoreTransfer[];

const invalidBaseTransferTopologies: readonly [string, unknown][] = [
  ['empty', []],
  ['fewer than three', validBaseTransfers.slice(0, 2)],
  ['more than three', [...validBaseTransfers, validBaseTransfers[0]]],
  [
    'wrong receiver',
    [validBaseTransfers[0], { ...validBaseTransfers[1], toPlayerIndex: 0 }, validBaseTransfers[2]],
  ],
  [
    'unequal amounts',
    [validBaseTransfers[0], { ...validBaseTransfers[1], amount: 150 }, validBaseTransfers[2]],
  ],
  [
    'duplicate payer',
    [
      validBaseTransfers[0],
      { ...validBaseTransfers[1], fromPlayerIndex: 0 },
      validBaseTransfers[2],
    ],
  ],
  [
    'missing another player',
    [
      validBaseTransfers[0],
      validBaseTransfers[1],
      { ...validBaseTransfers[2], fromPlayerIndex: 2 },
    ],
  ],
  [
    'invalid payer index',
    [
      { ...validBaseTransfers[0], fromPlayerIndex: -1 },
      validBaseTransfers[1],
      validBaseTransfers[2],
    ],
  ],
  [
    'invalid receiver index',
    [validBaseTransfers[0], { ...validBaseTransfers[1], toPlayerIndex: 4 }, validBaseTransfers[2]],
  ],
  [
    'payer equals receiver',
    [
      { ...validBaseTransfers[0], fromPlayerIndex: 1 },
      validBaseTransfers[1],
      validBaseTransfers[2],
    ],
  ],
  [
    'extra field',
    [validBaseTransfers[0], { ...validBaseTransfers[1], extra: true }, validBaseTransfers[2]],
  ],
  [
    'invalid amount',
    [validBaseTransfers[0], { ...validBaseTransfers[1], amount: 0 }, validBaseTransfers[2]],
  ],
];

afterEach(() => vi.restoreAllMocks());

describe('gang-package Hua Kai / Gang Kai Hu settlement', () => {
  it('redirects a real MingGang Gang Kai Hu as three preserved 148-point shares', () => {
    const afterGang = realMingGangTail();
    expect(afterGang.gangPackage).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: 'meld-1',
    });
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: winningTileId,
      source: 'ming-gang-tail',
    });

    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(resolved.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 148 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 148 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 148 },
    ]);
    expect(resolved.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
    expect(resolved.gangPackage).toEqual({ status: 'none' });
    expect(applyAction(resolved, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(resolved);

    const settled = applyGameActionToMatch(matchWithHand(afterGang), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(settled.cumulativeScores).toEqual([536, 1464, 1000, 1000]);
    expect(settled.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
    const completed = completeCurrentHand(settled);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.completedHands).toHaveLength(1);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');
  });

  it('redirects a real MingGang replacement-chain Hua Kai as three 72-point shares', () => {
    const afterGang = realMingGangTail([ordinary(winningTileId), flower('season-spring-1')]);
    expect(afterGang.gangPackage.status).toBe('active');
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: winningTileId,
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    const availability = getAvailableSelfDrawHu(afterGang, 1);
    expect(availability?.evaluation.patterns).toContain('hua-kai');
    expect(availability?.evaluation.patterns).not.toContain('gang-kai');

    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(resolved.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 72 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 72 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 72 },
    ]);
    expect(resolved.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 0,
    });
    expect(resolved.gangPackage).toEqual({ status: 'none' });

    const settled = applyGameActionToMatch(matchWithHand(afterGang), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(settled.cumulativeScores).toEqual([764, 1236, 1000, 1000]);
    expect(settled.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
  });

  it('keeps an otherwise identical Gang Kai ordinary when no package is active', () => {
    const afterGang = { ...realMingGangTail(), gangPackage: { status: 'none' as const } };
    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(resolved.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 148 },
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 148 },
      { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 148 },
    ]);
    expect(resolved.handProgressFacts).toMatchObject({
      packageSettlementCount: 0,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
  });

  it.each([
    ['wall-head', { source: 'wall-head' }],
    ['initial-dealer', { source: 'initial-dealer' }],
  ] as const)('rejects active-package %s self-draw instead of downgrading it', (_, provenance) => {
    const base = realMingGangTail();
    const corrupt = {
      ...base,
      selfDrawProvenance: { playerIndex: 1, tileId: winningTileId, ...provenance },
    } as GameState;
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    expect(getAvailableSelfDrawHu(corrupt, 1)).toBeNull();
    expect(applyAction(corrupt, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(corrupt);
    expect(hook).not.toHaveBeenCalled();
  });

  it('rejects an active package whose beneficiary is not the self-draw winner', () => {
    const base = realMingGangTail();
    if (base.gangPackage.status !== 'active') throw new Error('Missing active gang package');
    const packageMeld = base.players[1]?.melds[0];
    if (!packageMeld) throw new Error('Missing MingGang meld');
    const winnerMeld = {
      id: 'meld-2',
      type: 'ming-gang' as const,
      tiles: [1, 2, 3, 4].map((copy) => ordinary(`wan-8-${copy}` as TileId)),
      claimedTileId: 'wan-8-4' as const,
      fromPlayerIndex: 3,
    };
    const mismatched: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1
          ? { ...player, melds: [winnerMeld] }
          : index === 2
            ? { ...player, melds: [packageMeld] }
            : player,
      ),
      nextMeldSequence: 3,
      gangPackage: { ...base.gangPackage, beneficiaryPlayerIndex: 2 },
    };
    const activeTileIds = mismatched.players.flatMap((player) => [
      ...player.hand.map((tile) => tile.id),
      ...player.flowers.map((tile) => tile.id),
      ...player.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
    ]);
    expect(new Set(activeTileIds).size).toBe(activeTileIds.length);
    expect(mismatched.players[2]?.melds.map((meld) => meld.id)).toEqual(['meld-1']);
    expect(mismatched.players[1]?.melds.map((meld) => meld.id)).toEqual(['meld-2']);
    const packageValidationProbe: GameState = {
      ...mismatched,
      players: mismatched.players.map((player, index) =>
        index === 2
          ? {
              ...player,
              hand: [1, 2, 3, 4].map((copy) => ordinary(`wan-6-${copy}` as TileId)),
            }
          : player,
      ),
      currentPlayerIndex: 2,
      wall: [ordinary('tong-9-1')],
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 2, seat: 'west', type: 'discard' },
      selfDrawProvenance: undefined,
    };
    expect(getAvailableAnGangs(packageValidationProbe, 2)).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 6,
    });
    const validWinnerPackage: GameState = {
      ...mismatched,
      gangPackage: {
        status: 'active',
        payerPlayerIndex: 3,
        beneficiaryPlayerIndex: 1,
        source: 'ming-gang',
        establishedByMeldId: 'meld-2',
      },
    };
    expect(getAvailableSelfDrawHu(validWinnerPackage, 1)?.evaluation.patterns).toContain(
      'gang-kai',
    );
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const before = structuredClone(mismatched);
    expect(getAvailableSelfDrawHu(mismatched, 1)).toBeNull();
    expect(applyAction(mismatched, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      mismatched,
    );
    expect(hook).not.toHaveBeenCalled();
    expect(mismatched).toEqual(before);
    expect(mismatched.gangPackage.status).toBe('active');
    expect(mismatched.result).toBeUndefined();
  });

  it('rejects malformed base self-draw transfers transactionally', () => {
    const state = realMingGangTail();
    vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers').mockReturnValue([
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 148 },
    ]);
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
    expect(state.gangPackage.status).toBe('active');
    expect(state.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it.each(invalidBaseTransferTopologies)(
    'rejects corrupt base self-draw topology: %s',
    (_, transfers) => {
      const state = realMingGangTail();
      const hook = vi
        .spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers')
        .mockReturnValue(transfers as readonly ScoreTransfer[]);
      const availability = getAvailableSelfDrawHu(state, 1);
      expect(availability).not.toBeNull();
      const before = structuredClone(state);
      expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
      expect(hook).toHaveBeenCalledTimes(1);
      expect(state).toEqual(before);
      expect(state.phase).not.toBe('ended');
      expect(state.result).toBeUndefined();
      expect(state.pendingScoringEvents).toHaveLength(1);
      expect(state.handProgressFacts).toMatchObject({
        packageSettlementCount: 0,
        selfDrawCount: 0,
        gangKaiCount: 0,
      });
      expect(state.gangPackage.status).toBe('active');
    },
  );

  it('continues turn 16 once and resets package facts in the next hand', () => {
    const settled = applyGameActionToMatch(matchWithHand(realMingGangTail(), 16), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const completed = completeCurrentHand(settled);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.effectiveDealerTurn).toBe(16);
    expect(completed.completedHands).toHaveLength(1);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');
    expect(() => completeCurrentHand(completed)).toThrow(/must be playing/i);
    const next = prepareNextHand(completed);
    expect(next.currentHand.gangPackage).toEqual({ status: 'none' });
    expect(next.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
  });
});
