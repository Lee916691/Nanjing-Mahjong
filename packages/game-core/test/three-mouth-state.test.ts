import { describe, expect, it, vi } from 'vitest';

import {
  applyAction,
  createGame,
  createInitialGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  getAvailableBuGangs,
  NANJING_OPEN_RULE_SET,
  prepareNextHand,
  type GameState,
  type OrdinaryHandTile,
  type ThreeMouthPlayerState,
  type ThreeMouthState,
  type Tile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();
const initialPlayerState = (): ThreeMouthPlayerState => ({
  status: 'tracking',
  mouthCount: 0,
  lockedPayerPlayerIndex: null,
});

function ordinary(id: TileId): OrdinaryHandTile {
  const tile = deck.find((candidate) => candidate.id === id);
  if (!tile || tile.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return tile;
}

function anyTile(id: TileId): Tile {
  const found = deck.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing tile ${id}`);
  return found;
}

function withPlayerState(playerIndex: number, playerState: ThreeMouthPlayerState): ThreeMouthState {
  const states: ThreeMouthState = [
    initialPlayerState(),
    initialPlayerState(),
    initialPlayerState(),
    initialPlayerState(),
  ];
  return [
    playerIndex === 0 ? playerState : states[0],
    playerIndex === 1 ? playerState : states[1],
    playerIndex === 2 ? playerState : states[2],
    playerIndex === 3 ? playerState : states[3],
  ];
}

function discardClaimState(
  responseType: 'peng' | 'ming-gang',
  playerState: ThreeMouthPlayerState = initialPlayerState(),
  sourcePlayerIndex = 0,
  beneficiaryPlayerIndex = 1,
): GameState {
  const base = createGame();
  const matchingIds =
    responseType === 'peng'
      ? (['wan-3-2', 'wan-3-3'] as const)
      : (['wan-3-2', 'wan-3-3', 'wan-3-4'] as const);
  const players = base.players.map((player, index) => ({
    ...player,
    hand:
      index === sourcePlayerIndex
        ? [ordinary('wan-3-1')]
        : index === beneficiaryPlayerIndex
          ? matchingIds.map(ordinary)
          : [],
  }));
  return {
    ...base,
    players,
    wall: [ordinary('wan-9-1'), ordinary('tiao-9-1')],
    currentPlayerIndex: sourcePlayerIndex,
    dealerIndex: sourcePlayerIndex,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: {
      playerIndex: sourcePlayerIndex,
      seat: players[sourcePlayerIndex]!.seat,
      type: 'discard',
    },
    threeMouthState: withPlayerState(beneficiaryPlayerIndex, playerState),
  };
}

function runDiscardClaim(
  responseType: 'peng' | 'ming-gang',
  playerState: ThreeMouthPlayerState = initialPlayerState(),
  sourcePlayerIndex = 0,
  beneficiaryPlayerIndex = 1,
) {
  const before = discardClaimState(
    responseType,
    playerState,
    sourcePlayerIndex,
    beneficiaryPlayerIndex,
  );
  const opened = applyAction(before, { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
  let submitted = opened;
  for (const responder of opened.reactionWindow?.responderOrder ?? []) {
    submitted = applyAction(submitted, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === beneficiaryPlayerIndex ? responseType : 'pass',
    });
  }
  return {
    before,
    opened,
    submitted,
    resolved: applyAction(submitted, { type: 'RESOLVE_REACTION_WINDOW' }),
  };
}

function anGangState(
  playerState: ThreeMouthPlayerState = initialPlayerState(),
  hand: readonly OrdinaryHandTile[] = [1, 2, 3, 4].map((copy) =>
    ordinary(`wan-1-${copy}` as TileId),
  ),
  wall: readonly Tile[] = [ordinary('wan-9-1')],
): GameState {
  const base = createGame();
  const players = base.players.map((player, index) =>
    index === 0 ? { ...player, hand: [...hand] } : player,
  );
  return {
    ...base,
    players,
    wall: [...wall],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    threeMouthState: withPlayerState(0, playerState),
  };
}

function activeBuGangState(): GameState {
  const base = anGangState({ status: 'active', payerPlayerIndex: 2 });
  const robbingHand = [
    'wan-5-1',
    'wan-6-1',
    'tiao-1-1',
    'tiao-2-1',
    'tiao-3-1',
    'tiao-4-1',
    'tiao-5-1',
    'tiao-6-1',
    'tong-1-1',
    'tong-2-1',
    'tong-3-1',
    'wind-east-1',
    'wind-east-2',
  ] satisfies TileId[];
  const players = base.players.map((player, index) =>
    index === 0
      ? {
          ...player,
          hand: [ordinary('wan-7-4')],
          melds: [
            {
              id: 'meld-7',
              type: 'peng' as const,
              tiles: [ordinary('wan-7-1'), ordinary('wan-7-2'), ordinary('wan-7-3')],
              claimedTileId: 'wan-7-3' as const,
              fromPlayerIndex: 2,
            },
          ],
          buGangDrawProvenance: [{ targetMeldId: 'meld-7', tileId: 'wan-7-4' as const }],
        }
      : index === 1
        ? { ...player, hand: robbingHand.map(ordinary) }
        : player,
  );
  return { ...base, nextMeldSequence: 8, players, wall: [ordinary('wan-9-1')] };
}

function huPriorityState(): GameState {
  const base = discardClaimState('peng');
  const winningHand = [
    'wan-3-2',
    'wan-3-3',
    'wan-1-1',
    'wan-1-2',
    'wan-1-3',
    'wan-2-1',
    'wan-2-2',
    'wan-2-3',
    'tiao-1-1',
    'tiao-1-2',
    'tiao-1-3',
    'tong-1-1',
    'tong-1-2',
  ] satisfies TileId[];
  return {
    ...base,
    players: base.players.map((player, index) =>
      index === 1 ? { ...player, hand: winningHand.map(ordinary) } : player,
    ),
  };
}

describe('D. initialization behavior', () => {
  it('starts all four players at tracking zero without a locked payer', () => {
    expect(createInitialGame().threeMouthState).toEqual(
      Array.from({ length: 4 }, initialPlayerState),
    );
  });
});

describe('B. short public action chains from legal fixtures', () => {
  it('advances Peng only after the reaction window formally resolves', () => {
    const trace = runDiscardClaim('peng');
    expect(trace.opened.threeMouthState[1]).toEqual(initialPlayerState());
    expect(trace.submitted.threeMouthState[1]).toEqual(initialPlayerState());
    expect(trace.resolved.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    });
    expect(trace.resolved.players[1]?.melds.at(-1)?.type).toBe('peng');
  });

  it('advances MingGang only after formal resolution and keeps its live event', () => {
    const trace = runDiscardClaim('ming-gang');
    expect(trace.submitted.threeMouthState[1]).toEqual(initialPlayerState());
    expect(trace.resolved.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    });
    expect(trace.resolved.pendingScoringEvents.at(-1)?.type).toBe('ming-gang-created');
  });

  it('makes a successful AnGang advance one mouth atomically', () => {
    const state = anGangState();
    const result = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    expect(result.players[0]?.melds.at(-1)?.type).toBe('an-gang');
    expect(result.threeMouthState[0]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: null,
    });
    expect(result.pendingScoringEvents[0]?.type).toBe('an-gang-created');
  });

  it('makes three real pure AnGang actions invalid without rolling back the third gang', () => {
    const hand = [
      ...[1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}` as TileId)),
      ...[1, 2, 3, 4].map((copy) => ordinary(`wan-2-${copy}` as TileId)),
      ...[1, 2, 3, 4].map((copy) => ordinary(`wan-3-${copy}` as TileId)),
    ];
    let state = anGangState(initialPlayerState(), hand, [
      ordinary('tong-9-1'),
      ordinary('tong-8-1'),
      ordinary('tong-7-1'),
    ]);
    for (const rank of [1, 2, 3] as const) {
      state = applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank },
      });
    }
    expect(state.players[0]?.melds.filter((meld) => meld.type === 'an-gang')).toHaveLength(3);
    expect(state.threeMouthState[0]).toEqual({ status: 'invalid' });
    expect(state.handProgressFacts.successfulAnGangCount).toBe(3);
  });

  it('does not advance a Peng candidate suppressed by a real higher-priority Hu', () => {
    let state = applyAction(huPriorityState(), { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
    expect(state.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
      'pass',
      'hu',
      'peng',
    ]);
    for (const responder of state.reactionWindow?.responderOrder ?? []) {
      state = applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex === 1 ? 'hu' : 'pass',
      });
    }
    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(state.phase).toBe('ended');
    expect(state.threeMouthState[1]).toEqual(initialPlayerState());
    expect(state.players[1]?.melds).toEqual([]);
  });
});

describe('B. legal fixtures completed through public actions', () => {
  it('turns a fixture-based third MingGang mouth active while also creating gangPackage', () => {
    const result = runDiscardClaim('ming-gang', {
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 0,
    }).resolved;
    expect(result.threeMouthState[1]).toEqual({ status: 'active', payerPlayerIndex: 0 });
    expect(result.gangPackage).toMatchObject({
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
    });
  });

  it('keeps the same payer across a second Peng and activates on the third external mouth', () => {
    expect(
      runDiscardClaim('peng', {
        status: 'tracking',
        mouthCount: 1,
        lockedPayerPlayerIndex: 0,
      }).resolved.threeMouthState[1],
    ).toEqual({ status: 'tracking', mouthCount: 2, lockedPayerPlayerIndex: 0 });
    expect(
      runDiscardClaim('peng', {
        status: 'tracking',
        mouthCount: 2,
        lockedPayerPlayerIndex: 0,
      }).resolved.threeMouthState[1],
    ).toEqual({ status: 'active', payerPlayerIndex: 0 });
  });

  it('activates for Peng + Peng + MingGang from the same payer', () => {
    expect(
      runDiscardClaim('ming-gang', {
        status: 'tracking',
        mouthCount: 2,
        lockedPayerPlayerIndex: 0,
      }).resolved.threeMouthState[1],
    ).toEqual({ status: 'active', payerPlayerIndex: 0 });
  });

  it('combines a locked external mouth with one or two AnGangs', () => {
    const once = applyAction(
      anGangState({ status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 2 }),
      {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      },
    );
    expect(once.threeMouthState[0]).toEqual({
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 2,
    });
    const twice = applyAction(
      anGangState({ status: 'tracking', mouthCount: 2, lockedPayerPlayerIndex: 2 }),
      {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      },
    );
    expect(twice.threeMouthState[0]).toEqual({ status: 'active', payerPlayerIndex: 2 });
  });

  it('allows two anonymous AnGangs followed by one external mouth', () => {
    expect(
      runDiscardClaim('peng', {
        status: 'tracking',
        mouthCount: 2,
        lockedPayerPlayerIndex: null,
      }).resolved.threeMouthState[1],
    ).toEqual({ status: 'active', payerPlayerIndex: 0 });
  });

  it('invalidates a different external source through a public Peng resolution', () => {
    const invalid = runDiscardClaim(
      'peng',
      { status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 },
      2,
      1,
    ).resolved;
    expect(invalid.players[1]?.melds.at(-1)?.type).toBe('peng');
    expect(invalid.threeMouthState[1]).toEqual({ status: 'invalid' });
  });

  it('does not count BuGang again and still lets an active player finish it', () => {
    const state = activeBuGangState();
    expect(getAvailableBuGangs(state, 0)).toHaveLength(1);
    let result = applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-7' });
    for (const responder of result.reactionWindow?.responderOrder ?? []) {
      result = applyAction(result, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: 'pass',
      });
    }
    result = applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.players[0]?.melds[0]?.type).toBe('bu-gang');
    expect(result.threeMouthState[0]).toEqual({ status: 'active', payerPlayerIndex: 2 });
  });

  it('does not alter active three-mouth state when a BuGang is robbed', () => {
    const state = activeBuGangState();
    let result = applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-7' });
    expect(result.reactionWindow?.availableReactions[0]?.responseTypes).toContain('hu');
    for (const responder of result.reactionWindow?.responderOrder ?? []) {
      result = applyAction(result, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex === 1 ? 'hu' : 'pass',
      });
    }
    result = applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.phase).toBe('ended');
    expect(result.players[0]?.melds[0]?.type).toBe('peng');
    expect(result.threeMouthState[0]).toEqual({ status: 'active', payerPlayerIndex: 2 });
  });

  it('does not count runtime FlowerKong or ordinary flower replacement', () => {
    const base = createGame();
    const active = withPlayerState(0, { status: 'active', payerPlayerIndex: 2 });
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              flowers: [
                anyTile('flower-red-center-1'),
                anyTile('flower-red-center-2'),
                anyTile('flower-red-center-3'),
              ].filter((value) => value.category === 'flower'),
            }
          : player,
      ),
      wall: [anyTile('flower-red-center-4'), ordinary('wan-9-1')],
      phase: 'playing',
      turnStage: 'waiting-for-draw',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
      threeMouthState: active,
    };
    expect(applyAction(state, { type: 'DRAW_TILE' }).threeMouthState).toEqual(active);
  });

  it('removes Peng and MingGang availability after active and rejects forged submit', () => {
    const state = discardClaimState('ming-gang', { status: 'active', payerPlayerIndex: 0 });
    const opened = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
    const availability = opened.reactionWindow?.availableReactions.find(
      (candidate) => candidate.playerIndex === 1,
    );
    expect(availability?.responseTypes).not.toContain('peng');
    expect(availability?.responseTypes).not.toContain('ming-gang');
    expect(
      applyAction(opened, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'peng',
      }),
    ).toBe(opened);
  });

  it('removes AnGang availability after active and makes declaration an original-reference no-op', () => {
    const state = anGangState({ status: 'active', payerPlayerIndex: 2 });
    expect(getAvailableAnGangs(state, 0)).toEqual([]);
    expect(
      applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toBe(state);
  });

  it('resets tracking, active, invalid, payer and counts in prepareNextHand', () => {
    const hand = {
      ...createGame(),
      phase: 'ended' as const,
      turnStage: 'hand-ended' as const,
      pendingAction: { playerIndex: null, seat: null, type: 'none' as const },
      result: { type: 'draw' as const, reason: 'wall-exhausted' as const },
      threeMouthState: [
        { status: 'active', payerPlayerIndex: 1 },
        { status: 'invalid' },
        { status: 'tracking', mouthCount: 2, lockedPayerPlayerIndex: 0 },
        initialPlayerState(),
      ] satisfies ThreeMouthState,
    };
    const match = {
      ...createMatch(),
      status: 'playing' as const,
      currentHandStatus: 'completed' as const,
      currentHand: hand,
    };
    expect(prepareNextHand(match).currentHand.threeMouthState).toEqual(
      Array.from({ length: 4 }, initialPlayerState),
    );
  });

  it('does not advance MingGang when scoring transfer validation fails', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers').mockReturnValue([]);
    const trace = runDiscardClaim('ming-gang');
    expect(trace.resolved.threeMouthState[1]).toEqual(initialPlayerState());
    expect(trace.resolved.players[1]?.melds).toEqual([]);
    expect(trace.resolved.pendingScoringEvents).toEqual([]);
    hook.mockRestore();
  });

  it('does not advance AnGang when the wall tail is exhausted', () => {
    const state = anGangState(initialPlayerState(), undefined, []);
    expect(
      applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toBe(state);
    expect(state.threeMouthState[0]).toEqual(initialPlayerState());
  });
});

describe('C. corrupt state defenses', () => {
  const corruptValues: readonly unknown[] = [
    null,
    1,
    {},
    [],
    [initialPlayerState(), initialPlayerState(), initialPlayerState()],
    [
      initialPlayerState(),
      initialPlayerState(),
      initialPlayerState(),
      initialPlayerState(),
      initialPlayerState(),
    ],
    Object.assign(new Array(4), { 0: initialPlayerState(), 2: initialPlayerState() }),
    withPlayerState(0, {
      status: 'tracking',
      mouthCount: 0,
      lockedPayerPlayerIndex: 1,
    }),
    withPlayerState(0, {
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    }),
    withPlayerState(0, { status: 'active', payerPlayerIndex: 0 }),
    withPlayerState(0, { status: 'active', payerPlayerIndex: Number.NaN }),
    withPlayerState(0, { status: 'active', payerPlayerIndex: Number.POSITIVE_INFINITY }),
    withPlayerState(0, { status: 'active', payerPlayerIndex: 1.5 }),
    withPlayerState(0, { status: 'active', payerPlayerIndex: 4 }),
    withPlayerState(0, { status: 'tracking', mouthCount: 1 } as unknown as ThreeMouthPlayerState),
    withPlayerState(0, {
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: null,
      extra: true,
    } as unknown as ThreeMouthPlayerState),
    withPlayerState(0, {
      status: 'active',
      payerPlayerIndex: 1,
      extra: true,
    } as unknown as ThreeMouthPlayerState),
    withPlayerState(0, { status: 'unknown' } as unknown as ThreeMouthPlayerState),
    withPlayerState(0, { status: 'invalid', reason: 'extra' } as unknown as ThreeMouthPlayerState),
  ];

  it.each(corruptValues)('rejects malformed tuple/player value %# transactionally', (value) => {
    const valid = anGangState();
    const corrupt = { ...valid, threeMouthState: value } as unknown as GameState;
    expect(getAvailableAnGangs(corrupt, 0)).toEqual([]);
    expect(
      applyAction(corrupt, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toBe(corrupt);
    expect(corrupt.players[0]?.hand).toBe(valid.players[0]?.hand);
    expect(corrupt.wall).toBe(valid.wall);
    expect(corrupt.pendingScoringEvents).toBe(valid.pendingScoringEvents);
  });
});

describe('D. state invariants and non-effects', () => {
  it('updates only the beneficiary state object during a formal mouth transition', () => {
    const trace = runDiscardClaim('peng');
    for (const index of [0, 2, 3] as const) {
      expect(trace.resolved.threeMouthState[index]).toBe(trace.submitted.threeMouthState[index]);
    }
    expect(trace.resolved.threeMouthState[1]).not.toBe(trace.submitted.threeMouthState[1]);
  });

  it('does not increment packageSettlementCount merely by becoming active', () => {
    const result = runDiscardClaim('ming-gang', {
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 0,
    }).resolved;
    expect(result.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it('does not change hand completion/dealer facts merely because tracking is invalid', () => {
    const state = { ...createGame(), threeMouthState: withPlayerState(0, { status: 'invalid' }) };
    expect(state.handProgressFacts).toEqual(createGame().handProgressFacts);
    expect(state.dealerIndex).toBe(createGame().dealerIndex);
  });

  it('keeps active payer stable on repeated illegal AnGang actions', () => {
    const active: ThreeMouthPlayerState = { status: 'active', payerPlayerIndex: 2 };
    const state = anGangState(active);
    const repeated = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    expect(repeated).toBe(state);
    expect(repeated.threeMouthState[0]).toEqual(active);
  });

  it('makes repeated reaction resolution an original-reference no-op without double counting', () => {
    const resolved = runDiscardClaim('peng').resolved;
    const repeated = applyAction(resolved, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(repeated).toBe(resolved);
    expect(repeated.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    });
  });
});
