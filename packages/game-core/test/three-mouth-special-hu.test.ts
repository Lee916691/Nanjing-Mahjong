import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  getAvailableSelfDrawHu,
  prepareNextHand,
  settlePendingScoringEvents,
  NANJING_OPEN_RULE_SET,
  type GameState,
  type MatchState,
  type OrdinaryHandTile,
  type ScoreTransfer,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();
afterEach(() => vi.restoreAllMocks());

function ordinary(id: TileId): OrdinaryHandTile {
  const tile = deck.find((candidate) => candidate.id === id);
  if (!tile || tile.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return tile;
}

function activeMelds() {
  return [1, 2, 3].map((rank, index) => ({
    id: `meld-${index + 1}`,
    type: 'peng' as const,
    tiles: [1, 2, 3].map((copy) => ordinary(`wan-${rank}-${copy}` as TileId)),
    claimedTileId: `wan-${rank}-1` as TileId,
    fromPlayerIndex: 0,
  }));
}

function specialDiscardState(fromPlayerIndex = 0, matchingCount: 2 | 3 = 2): GameState {
  const base = createGame();
  const matching = Array.from({ length: matchingCount }, (_, index) =>
    ordinary(`wan-9-${index + 2}` as TileId),
  );
  const players = base.players.map((player, index) => ({
    ...player,
    hand:
      index === fromPlayerIndex
        ? [ordinary('wan-9-1')]
        : index === 1
          ? [...matching, ordinary('tiao-9-1')]
          : [],
    melds: index === 1 ? activeMelds() : [],
  }));
  return {
    ...base,
    nextMeldSequence: 4,
    players,
    wall: [ordinary('wind-north-4')],
    currentPlayerIndex: fromPlayerIndex,
    dealerIndex: fromPlayerIndex,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: {
      playerIndex: fromPlayerIndex,
      seat: players[fromPlayerIndex]!.seat,
      type: 'discard',
    },
    threeMouthState: [
      base.threeMouthState[0],
      { status: 'active', payerPlayerIndex: 0 },
      base.threeMouthState[2],
      base.threeMouthState[3],
    ],
  };
}

function submitAll(state: GameState, beneficiaryResponse: 'hu' | 'pass'): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === 1 ? beneficiaryResponse : 'pass',
    });
  }
  return next;
}

function resolveSpecialDiscard(fromPlayerIndex = 0, matchingCount: 2 | 3 = 2): GameState {
  const opened = applyAction(specialDiscardState(fromPlayerIndex, matchingCount), {
    type: 'DISCARD_TILE',
    tileId: 'wan-9-1',
  });
  return applyAction(submitAll(opened, 'hu'), { type: 'RESOLVE_REACTION_WINDOW' });
}

function specialSelfDrawState(): GameState {
  const base = createGame();
  const players = base.players.map((player, index) =>
    index === 1
      ? {
          ...player,
          hand: [
            ...[1, 2, 3, 4].map((copy) => ordinary(`wan-9-${copy}` as TileId)),
            ordinary('tiao-9-1'),
          ],
          melds: activeMelds(),
        }
      : player,
  );
  return {
    ...base,
    nextMeldSequence: 4,
    players,
    wall: [ordinary('wind-north-4')],
    currentPlayerIndex: 1,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
    selfDrawProvenance: { playerIndex: 1, tileId: 'wan-9-4', source: 'wall-head' },
    threeMouthState: [
      base.threeMouthState[0],
      { status: 'active', payerPlayerIndex: 0 },
      base.threeMouthState[2],
      base.threeMouthState[3],
    ],
  };
}

function matchWithHand(hand: GameState): MatchState {
  return {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: hand,
  };
}

function allPassAndResolve(state: GameState): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: 'pass',
    });
  }
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function activeFromRealThirdPeng(): GameState {
  const base = createGame();
  const players = base.players.map((player, index) => ({
    ...player,
    hand:
      index === 0
        ? [ordinary('wan-3-1'), ordinary('wan-9-1')]
        : index === 1
          ? [
              ordinary('wan-3-2'),
              ordinary('wan-3-3'),
              ordinary('wan-9-2'),
              ordinary('wan-9-3'),
              ordinary('tiao-8-1'),
              ordinary('tiao-8-2'),
              ordinary('tiao-8-3'),
              ordinary('tiao-9-1'),
            ]
          : [],
    melds: index === 1 ? activeMelds().slice(0, 2) : [],
  }));
  const before: GameState = {
    ...base,
    nextMeldSequence: 3,
    players,
    wall: [ordinary('tong-7-1'), ordinary('tong-8-1'), ordinary('tong-9-1'), ordinary('tiao-8-4')],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    threeMouthState: [
      base.threeMouthState[0],
      { status: 'tracking', mouthCount: 2, lockedPayerPlayerIndex: 0 },
      base.threeMouthState[2],
      base.threeMouthState[3],
    ],
  };
  let opened = applyAction(before, { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
  for (const responder of opened.reactionWindow?.responderOrder ?? []) {
    opened = applyAction(opened, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === 1 ? 'peng' : 'pass',
    });
  }
  const active = applyAction(opened, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(active.threeMouthState[1]).toEqual({ status: 'active', payerPlayerIndex: 0 });
  expect(active.players[1]?.melds).toHaveLength(3);
  return active;
}

function rotateFromActiveToPlayer(active: GameState, targetPlayerIndex: number): GameState {
  let state = allPassAndResolve(applyAction(active, { type: 'DISCARD_TILE', tileId: 'tiao-9-1' }));
  while (
    state.currentPlayerIndex !== targetPlayerIndex ||
    state.turnStage !== 'waiting-for-discard'
  ) {
    state = applyAction(state, { type: 'DRAW_TILE' });
    if (state.currentPlayerIndex === targetPlayerIndex) break;
    const tileId = state.selfDrawProvenance?.tileId;
    if (!tileId) throw new Error('Expected rotation draw provenance');
    state = allPassAndResolve(applyAction(state, { type: 'DISCARD_TILE', tileId }));
  }
  return state;
}

describe('B. three-mouth special Hu legal fixtures', () => {
  it('continues a real third-Peng active chain into a fourth discard special Hu', () => {
    const payerTurn = rotateFromActiveToPlayer(activeFromRealThirdPeng(), 0);
    const opened = applyAction(payerTurn, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
    expect(
      opened.reactionWindow?.availableReactions.find(({ playerIndex }) => playerIndex === 1)
        ?.responseTypes,
    ).toEqual(['pass', 'hu']);
    const resolved = applyAction(submitAll(opened, 'hu'), { type: 'RESOLVE_REACTION_WINDOW' });
    expect(resolved.phase).toBe('ended');
    expect(resolved.players[1]?.melds).toHaveLength(3);
  });

  it('continues a real third-Peng active chain into a provenance-bound special self-draw', () => {
    let payerTurn = rotateFromActiveToPlayer(activeFromRealThirdPeng(), 0);
    const drawnId = payerTurn.selfDrawProvenance?.tileId;
    if (!drawnId) throw new Error('Expected payer rotation draw');
    payerTurn = allPassAndResolve(
      applyAction(payerTurn, { type: 'DISCARD_TILE', tileId: drawnId }),
    );
    const beneficiaryTurn = applyAction(payerTurn, { type: 'DRAW_TILE' });
    expect(beneficiaryTurn.selfDrawProvenance?.tileId).toBe('tiao-8-4');
    expect(getAvailableSelfDrawHu(beneficiaryTurn, 1)?.winningTile.id).toBe('tiao-8-4');
    const resolved = applyAction(beneficiaryTurn, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(resolved.phase).toBe('ended');
    expect(resolved.players[1]?.melds).toHaveLength(3);
  });
  it.each([
    ['Peng', 2],
    ['MingGang', 3],
  ] as const)('replaces a fourth %s opportunity with one Hu option', (_, matchingCount) => {
    const opened = applyAction(specialDiscardState(0, matchingCount), {
      type: 'DISCARD_TILE',
      tileId: 'wan-9-1',
    });
    const availability = opened.reactionWindow?.availableReactions.find(
      ({ playerIndex }) => playerIndex === 1,
    );
    expect(availability?.responseTypes).toEqual(['pass', 'hu']);
    expect(
      applyAction(opened, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: matchingCount === 2 ? 'peng' : 'ming-gang',
      }),
    ).toBe(opened);
  });

  it('forces global-single-wait when the locked payer discards and preserves three shares', () => {
    const resolved = resolveSpecialDiscard(0);
    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-1' },
    });
    expect(
      resolved.result?.type === 'win' && resolved.result.source !== 'self-draw'
        ? resolved.result.winners[0]?.evaluation.patterns
        : [],
    ).toContain('global-single-wait');
    expect(resolved.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
    ]);
    expect(resolved.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 0,
    });
    const event = resolved.pendingScoringEvents.at(-1);
    expect(event).toMatchObject({
      source: 'discard',
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-1' },
      threeMouthResolution: {
        triggerSource: 'discard-peng-opportunity',
        triggerPlayerIndex: 0,
        settlementMode: 'self-draw',
        forcedBasePattern: 'global-single-wait',
        payerPlayerIndex: 0,
      },
    });
    expect(settlePendingScoringEvents(matchWithHand(resolved)).cumulativeScores).toEqual([
      268, 1732, 1000, 1000,
    ]);
  });

  it('forces all-pungs when a third player discards but still charges the locked payer', () => {
    const resolved = resolveSpecialDiscard(2);
    const event = resolved.pendingScoringEvents.at(-1);
    expect(event?.type).toBe('hu-resolved');
    expect(event?.type === 'hu-resolved' ? event.evaluation.patterns : []).toContain('all-pungs');
    expect(event?.type === 'hu-resolved' ? event.evaluation.patterns : []).not.toContain(
      'global-single-wait',
    );
    expect(event).toMatchObject({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-1' },
      threeMouthResolution: {
        triggerSource: 'discard-peng-opportunity',
        triggerPlayerIndex: 2,
        settlementMode: 'self-draw',
        forcedBasePattern: 'all-pungs',
        payerPlayerIndex: 0,
      },
    });
    expect(event?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
    ]);
    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-1' },
      winners: [
        {
          playerIndex: 1,
          threeMouthResolution: {
            triggerPlayerIndex: 2,
            payerPlayerIndex: 0,
          },
        },
      ],
    });
    expect(settlePendingScoringEvents(matchWithHand(resolved)).cumulativeScores).toEqual([
      568, 1432, 1000, 1000,
    ]);
  });
});

describe('B. special Hu pass and self-draw semantics', () => {
  it('records discard Pass-Hu, preserves active, and lets the window continue normally', () => {
    const opened = applyAction(specialDiscardState(), {
      type: 'DISCARD_TILE',
      tileId: 'wan-9-1',
    });
    const submitted = submitAll(opened, 'pass');
    expect(submitted.players[1]?.passHu).toBe(true);
    const resolved = applyAction(submitted, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(resolved.threeMouthState[1]).toEqual({ status: 'active', payerPlayerIndex: 0 });
    expect(resolved.players[1]?.melds).toHaveLength(3);
    expect(resolved.players[0]?.discardPile.at(-1)?.claimedByMeldId).toBeUndefined();
    expect(resolved.handProgressFacts).toMatchObject({
      packageSettlementCount: 0,
      selfDrawCount: 0,
    });
    expect(applyAction(resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(resolved);
  });

  it('does not let three-mouth bypass an existing Pass-Hu restriction', () => {
    const base = specialDiscardState();
    const state = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, passHu: true } : player,
      ),
    };
    const opened = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
    expect(
      opened.reactionWindow?.availableReactions.find(({ playerIndex }) => playerIndex === 1)
        ?.responseTypes,
    ).toEqual(['pass']);
  });

  it('offers the provenance-bound fourth tile as special self-draw and keeps AnGang unavailable', () => {
    const state = specialSelfDrawState();
    const availability = getAvailableSelfDrawHu(state, 1);
    expect(availability?.winningTile.id).toBe('wan-9-4');
    expect(availability?.evaluation.patterns).toContain('global-single-wait');
    expect(getAvailableAnGangs(state, 1)).toEqual([]);
    expect(
      applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: { category: 'number', suit: 'wan', rank: 9 },
      }),
    ).toBe(state);
  });

  it('resolves special self-draw without creating an AnGang, tail draw, or realtime gang score', () => {
    const state = specialSelfDrawState();
    const resolved = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(resolved.phase).toBe('ended');
    expect(resolved.wall).toEqual(state.wall);
    expect(resolved.players[1]?.melds).toHaveLength(3);
    expect(resolved.pendingScoringEvents).toHaveLength(1);
    expect(resolved.pendingScoringEvents[0]).toMatchObject({
      source: 'self-draw',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-4' },
      threeMouthResolution: {
        triggerSource: 'self-draw-an-gang-opportunity',
        triggerPlayerIndex: 1,
        forcedBasePattern: 'global-single-wait',
        payerPlayerIndex: 0,
      },
    });
    expect(resolved.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 244 },
    ]);
    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'self-draw',
      payerPlayerIndex: 0,
      winningTile: { id: 'wan-9-4' },
      winner: {
        playerIndex: 1,
        threeMouthResolution: { triggerPlayerIndex: 1, payerPlayerIndex: 0 },
      },
    });
    expect(resolved.handProgressFacts).toMatchObject({
      successfulAnGangCount: 0,
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 0,
    });
    expect(settlePendingScoringEvents(matchWithHand(resolved)).cumulativeScores).toEqual([
      268, 1732, 1000, 1000,
    ]);
  });

  it('abandons special self-draw through a normal discard without recording Pass-Hu', () => {
    const state = specialSelfDrawState();
    const discarded = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tiao-9-1' });
    expect(discarded.players[1]?.passHu).toBe(false);
    expect(discarded.threeMouthState[1]).toEqual({ status: 'active', payerPlayerIndex: 0 });
    expect(discarded.selfDrawProvenance).toBeUndefined();
    expect(discarded.pendingScoringEvents).toEqual([]);
    expect(discarded.handProgressFacts).toMatchObject({
      packageSettlementCount: 0,
      selfDrawCount: 0,
    });
  });

  it('does not re-offer an old four-tile group when provenance points at an unrelated draw', () => {
    const state: GameState = {
      ...specialSelfDrawState(),
      selfDrawProvenance: { playerIndex: 1, tileId: 'tiao-9-1', source: 'wall-head' },
    };
    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
  });

  it('offers a newly completed different four-tile group bound to its new provenance', () => {
    const base = specialSelfDrawState();
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1
          ? {
              ...player,
              hand: [1, 2, 3, 4].map((copy) => ordinary(`tiao-8-${copy}` as TileId)),
            }
          : player,
      ),
      selfDrawProvenance: { playerIndex: 1, tileId: 'tiao-8-4', source: 'wall-head' },
    };
    expect(getAvailableSelfDrawHu(state, 1)?.winningTile.id).toBe('tiao-8-4');
  });

  it.each([
    ['wall-head', { source: 'wall-head' }, []],
    [
      'flower replacement',
      { source: 'flower-replacement', formedFlowerKongDuringReplacement: false },
      ['hua-kai'],
    ],
    [
      'flower-kong replacement',
      { source: 'flower-replacement', formedFlowerKongDuringReplacement: true },
      ['gang-kai'],
    ],
    ['AnGang tail', { source: 'an-gang-tail' }, ['gang-kai']],
  ] as const)('uses only a real %s provenance for Hua Kai/Gang Kai', (_, source, expected) => {
    const state = {
      ...specialSelfDrawState(),
      selfDrawProvenance: { playerIndex: 1, tileId: 'wan-9-4', ...source },
    } as unknown as GameState;
    const patterns = getAvailableSelfDrawHu(state, 1)?.evaluation.patterns ?? [];
    const expectedPatterns: readonly string[] = expected;
    expect(patterns.includes('hua-kai')).toBe(expectedPatterns.includes('hua-kai'));
    expect(patterns.includes('gang-kai')).toBe(expectedPatterns.includes('gang-kai'));
  });

  it.each([
    ['wrong owner', { playerIndex: 2, tileId: 'wan-9-4', source: 'wall-head' }],
    ['missing entity', { playerIndex: 1, tileId: 'tiao-1-4', source: 'wall-head' }],
    ['initial-dealer source', { playerIndex: 1, tileId: 'wan-9-4', source: 'initial-dealer' }],
  ] as const)('rejects corrupt special self-draw provenance: %s', (_, provenance) => {
    const state = { ...specialSelfDrawState(), selfDrawProvenance: provenance } as GameState;
    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
  });
});

describe('C. forced patterns, priority, and corrupt topology', () => {
  it('stacks a valid Di Hu declaration without requiring an ordinary complete Hu structure', () => {
    const state: GameState = {
      ...specialSelfDrawState(),
      dealerIndex: 0,
      diHuDeclarations: {
        status: 'closed',
        declarations: [
          { playerIndex: 1, winningTileFaces: [{ category: 'number', suit: 'wan', rank: 9 }] },
        ],
      },
    };
    expect(getAvailableSelfDrawHu(state, 1)?.evaluation.patterns).toContain('di-hu');
  });

  it('gives three-mouth payer priority over a different active gang-package payer', () => {
    const base = specialSelfDrawState();
    const first = base.players[1]!.melds[0]!;
    const packageMeld = {
      ...first,
      type: 'ming-gang' as const,
      tiles: [...first.tiles, ordinary('wan-1-4')],
      fromPlayerIndex: 3,
    };
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, melds: [packageMeld, ...player.melds.slice(1)] } : player,
      ),
      gangPackage: {
        status: 'active',
        payerPlayerIndex: 3,
        beneficiaryPlayerIndex: 1,
        source: 'ming-gang',
        establishedByMeldId: packageMeld.id,
      },
    };
    const resolved = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(
      resolved.pendingScoringEvents[0]?.transfers.every(
        ({ fromPlayerIndex }) => fromPlayerIndex === 0,
      ),
    ).toBe(true);
    expect(resolved.gangPackage).toEqual({ status: 'none' });
    expect(resolved.handProgressFacts.packageSettlementCount).toBe(1);
  });

  it('rejects malformed RuleSet three-mouth transfers transactionally', () => {
    const state = specialSelfDrawState();
    const original = NANJING_OPEN_RULE_SET.getThreeMouthForcedHuResolution;
    vi.spyOn(NANJING_OPEN_RULE_SET, 'getThreeMouthForcedHuResolution').mockImplementation(
      (context) => {
        const resolution = original(context);
        return resolution ? { ...resolution, transfers: [] } : null;
      },
    );
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
    expect(state.result).toBeUndefined();
    expect(state.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it.each([
    ['empty', () => []],
    ['two shares', (transfers: readonly ScoreTransfer[]) => transfers.slice(0, 2)],
    ['four shares', (transfers: readonly ScoreTransfer[]) => [...transfers, transfers[0]!]],
    [
      'wrong payer',
      (transfers: readonly ScoreTransfer[]) => [
        { ...transfers[0]!, fromPlayerIndex: 2 },
        ...transfers.slice(1),
      ],
    ],
    [
      'wrong receiver',
      (transfers: readonly ScoreTransfer[]) => [
        { ...transfers[0]!, toPlayerIndex: 2 },
        ...transfers.slice(1),
      ],
    ],
    [
      'unequal amount',
      (transfers: readonly ScoreTransfer[]) => [
        { ...transfers[0]!, amount: transfers[0]!.amount + 2 },
        ...transfers.slice(1),
      ],
    ],
    [
      'self payment',
      (transfers: readonly ScoreTransfer[]) => [
        { ...transfers[0]!, fromPlayerIndex: 1 },
        ...transfers.slice(1),
      ],
    ],
    [
      'extra field',
      (transfers: readonly ScoreTransfer[]) => [
        { ...transfers[0]!, extra: true },
        ...transfers.slice(1),
      ],
    ],
  ] as const)('rejects corrupt forced transfer topology: %s', (_, mutate) => {
    const state = specialSelfDrawState();
    const original = NANJING_OPEN_RULE_SET.getThreeMouthForcedHuResolution;
    vi.spyOn(NANJING_OPEN_RULE_SET, 'getThreeMouthForcedHuResolution').mockImplementation(
      (context) => {
        const resolution = original(context);
        return resolution ? { ...resolution, transfers: mutate([...resolution.transfers]) } : null;
      },
    );
    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
    expect(state.pendingScoringEvents).toEqual([]);
  });

  it('keeps a special winner isolated from a normal winner in stable Multi-Hu order', () => {
    const base = specialDiscardState(2);
    const normalWait = [
      'tiao-1-1',
      'tiao-2-1',
      'tiao-3-1',
      'tiao-4-1',
      'tiao-5-1',
      'tiao-6-1',
      'tong-1-1',
      'tong-2-1',
      'tong-3-1',
      'tong-4-1',
      'tong-5-1',
      'tong-6-1',
      'wan-9-4',
    ] satisfies TileId[];
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 3 ? { ...player, hand: normalWait.map(ordinary) } : player,
      ),
    };
    let opened = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
    for (const responder of opened.reactionWindow?.responderOrder ?? []) {
      opened = applyAction(opened, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex === 1 || responder.playerIndex === 3 ? 'hu' : 'pass',
      });
    }
    const resolved = applyAction(opened, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(
      resolved.result?.type === 'win' && resolved.result.source === 'discard'
        ? resolved.result.winners.map(({ playerIndex }) => playerIndex)
        : [],
    ).toEqual([3, 1]);
    const events = resolved.pendingScoringEvents.filter(({ type }) => type === 'hu-resolved');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: 'discard',
      winnerPlayerIndex: 3,
      payerPlayerIndex: 2,
    });
    expect(events[0]?.transfers).toEqual([{ fromPlayerIndex: 2, toPlayerIndex: 3, amount: 104 }]);
    expect(events[1]).toMatchObject({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      threeMouthResolution: {
        triggerPlayerIndex: 2,
        payerPlayerIndex: 0,
        forcedBasePattern: 'all-pungs',
      },
    });
    expect(events[1]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 144 },
    ]);
    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 0,
      triggerPlayerIndex: 2,
    });
    expect(resolved.handProgressFacts.packageSettlementCount).toBe(1);
    expect(settlePendingScoringEvents(matchWithHand(resolved)).cumulativeScores).toEqual([
      568, 1432, 896, 1104,
    ]);
    expect(applyAction(resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(resolved);
  });

  it('rejects an extra transfer field at Match settlement without partial score changes', () => {
    const resolved = applyAction(specialSelfDrawState(), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const event = resolved.pendingScoringEvents[0]!;
    const corrupt = {
      ...resolved,
      pendingScoringEvents: [
        {
          ...event,
          transfers: [{ ...event.transfers[0], extra: true }, ...event.transfers.slice(1)],
        },
      ],
    } as GameState;
    const match = matchWithHand(corrupt);
    expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it.each([
    [
      'top-level payer mismatch',
      (event: Record<string, unknown>) => ({ ...event, payerPlayerIndex: 2 }),
    ],
    [
      'resolution payer mismatch',
      (event: Record<string, unknown>) => ({
        ...event,
        threeMouthResolution: {
          ...(event.threeMouthResolution as Record<string, unknown>),
          payerPlayerIndex: 2,
        },
      }),
    ],
    [
      'invalid trigger player',
      (event: Record<string, unknown>) => ({
        ...event,
        threeMouthResolution: {
          ...(event.threeMouthResolution as Record<string, unknown>),
          triggerPlayerIndex: Number.NaN,
        },
      }),
    ],
    [
      'self-draw trigger differs from winner',
      (event: Record<string, unknown>) => ({
        ...event,
        threeMouthResolution: {
          ...(event.threeMouthResolution as Record<string, unknown>),
          triggerPlayerIndex: 2,
        },
      }),
    ],
    [
      'forced pattern differs from trigger metadata',
      (event: Record<string, unknown>) => ({
        ...event,
        threeMouthResolution: {
          ...(event.threeMouthResolution as Record<string, unknown>),
          forcedBasePattern: 'all-pungs',
        },
      }),
    ],
    [
      'forced patterns coexist',
      (event: Record<string, unknown>) => ({
        ...event,
        evaluation: {
          ...(event.evaluation as Record<string, unknown>),
          patterns: [
            ...((event.evaluation as { patterns: readonly string[] }).patterns ?? []),
            'all-pungs',
          ],
        },
      }),
    ],
    [
      'extra resolution field',
      (event: Record<string, unknown>) => ({
        ...event,
        threeMouthResolution: {
          ...(event.threeMouthResolution as Record<string, unknown>),
          extra: true,
        },
      }),
    ],
  ] as const)('rejects corrupt three-mouth metadata transactionally: %s', (_, mutate) => {
    const resolved = applyAction(specialSelfDrawState(), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const event = resolved.pendingScoringEvents[0]!;
    const corrupt = {
      ...resolved,
      pendingScoringEvents: [mutate(event as unknown as Record<string, unknown>)],
    } as unknown as GameState;
    const match = matchWithHand(corrupt);
    expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toHaveLength(1);
  });

  it.each(['valid-invalid', 'invalid-valid'] as const)(
    'rejects a %s Match batch without partial settlement',
    (order) => {
      const resolved = applyAction(specialSelfDrawState(), {
        type: 'DECLARE_SELF_DRAW_HU',
        playerIndex: 1,
      });
      const valid = resolved.pendingScoringEvents[0]!;
      const invalid = { ...valid, payerPlayerIndex: 2 };
      const events = order === 'valid-invalid' ? [valid, invalid] : [invalid, valid];
      const match = matchWithHand({ ...resolved, pendingScoringEvents: events } as GameState);
      expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
      expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
      expect(match.currentHand.pendingScoringEvents).toHaveLength(2);
    },
  );

  it('rejects a discard trigger that equals the winner without settling', () => {
    const resolved = resolveSpecialDiscard(2);
    const event = resolved.pendingScoringEvents.at(-1)!;
    if (event.type !== 'hu-resolved') throw new Error('Expected Hu event');
    const corruptEvent = {
      ...event,
      threeMouthResolution: {
        ...event.threeMouthResolution!,
        triggerPlayerIndex: 1,
      },
    };
    const match = matchWithHand({
      ...resolved,
      pendingScoringEvents: [corruptEvent],
    } as GameState);
    expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toHaveLength(1);
  });
});

describe('D. facts, Match settlement, and lifecycle', () => {
  it('settles three equal payer shares and uses package fact for no dealer advance', () => {
    const settled = applyGameActionToMatch(matchWithHand(specialSelfDrawState()), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(settled.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
    expect(settled.cumulativeScores[0]).toBeLessThan(1000);
    expect(settled.cumulativeScores[1]).toBeGreaterThan(1000);
    expect(settled.cumulativeScores[2]).toBe(1000);
    expect(settled.cumulativeScores[3]).toBe(1000);
    const completed = completeCurrentHand(settled);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');
    const next = prepareNextHand(completed);
    expect(next.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
    expect(next.currentHand.threeMouthState.every(({ status }) => status === 'tracking')).toBe(
      true,
    );
  });
});
