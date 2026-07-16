import { describe, expect, it } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  startCurrentHand,
  type GameAction,
  type GameState,
  type MahjongTile,
  type MatchState,
  type OrdinaryHandTile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function tile(id: TileId): MahjongTile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing tile ${id}`);
  return value;
}

function ordinary(id: TileId): OrdinaryHandTile {
  const value = tile(id);
  if (value.category === 'flower') throw new Error(`Expected ordinary tile ${id}`);
  return value;
}

function fillHand(
  required: readonly TileId[],
  size: 13 | 14,
  used: Set<TileId>,
  reserved: ReadonlySet<TileId>,
): MahjongTile[] {
  const result = required.map((id) => {
    if (used.has(id)) throw new Error(`Duplicate tile ${id}`);
    used.add(id);
    return tile(id);
  });
  for (const candidate of deck) {
    if (result.length === size) break;
    if (candidate.category === 'flower' || used.has(candidate.id) || reserved.has(candidate.id)) {
      continue;
    }
    used.add(candidate.id);
    result.push(candidate);
  }
  expect(result).toHaveLength(size);
  return result;
}

function deterministicWall(
  requiredHands: readonly (readonly TileId[])[],
  headDraws: readonly TileId[],
  tailDraws: readonly TileId[] = [],
): MahjongTile[] {
  const reservedIds = [...requiredHands.flat(), ...headDraws, ...tailDraws];
  expect(new Set(reservedIds).size).toBe(reservedIds.length);
  const reserved = new Set(reservedIds);
  const used = new Set<TileId>([...headDraws, ...tailDraws]);
  const hands = requiredHands.map((required, index) =>
    fillHand(required, index === 0 ? 14 : 13, used, reserved),
  );
  const deal: MahjongTile[] = [];
  const positions = [0, 0, 0, 0];
  while (positions.some((position, index) => position < hands[index]!.length)) {
    for (let index = 0; index < 4; index += 1) {
      const next = hands[index]![positions[index]!];
      if (!next) continue;
      deal.push(next);
      positions[index] = positions[index]! + 1;
    }
  }
  const wall = [
    ...deal,
    ...headDraws.map(tile),
    ...deck.filter((candidate) => !used.has(candidate.id)),
    ...tailDraws.map(tile).reverse(),
  ];
  expect(wall).toHaveLength(144);
  expect(new Set(wall.map(({ id }) => id)).size).toBe(144);
  return wall;
}

function startDeterministicHand(
  requiredHands: readonly (readonly TileId[])[],
  headDraws: readonly TileId[],
  tailDraws: readonly TileId[] = [],
): MatchState {
  const ready = {
    ...createGame(),
    wall: deterministicWall(requiredHands, headDraws, tailDraws),
  };
  let match = startCurrentHand({ ...createMatch(), currentHand: ready });
  while (match.currentHand.diHuDeclarations?.status === 'collecting') {
    const playerIndex = match.currentHand.diHuDeclarations.pendingPlayerIndices[0]!;
    match = act(match, { type: 'SUBMIT_DI_HU_DECISION', playerIndex, decision: 'pass' });
  }
  expect(match.currentHand.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
  return match;
}

function act(match: MatchState, action: GameAction): MatchState {
  return applyGameActionToMatch(match, action);
}

function submitResponses(
  match: MatchState,
  claimantPlayerIndex?: number,
  claim: 'hu' | 'peng' | 'ming-gang' = 'peng',
): MatchState {
  let next = match;
  for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
    next = act(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === claimantPlayerIndex ? claim : 'pass',
    });
  }
  return next;
}

function allPassAndResolve(match: MatchState): MatchState {
  return act(submitResponses(match), { type: 'RESOLVE_REACTION_WINDOW' });
}

function claimDiscard(
  match: MatchState,
  tileId: TileId,
  claimantPlayerIndex: number,
  claim: 'peng' | 'ming-gang',
): { readonly submitted: MatchState; readonly resolved: MatchState } {
  const opened = act(match, { type: 'DISCARD_TILE', tileId });
  expect(
    opened.currentHand.reactionWindow?.availableReactions.find(
      ({ playerIndex }) => playerIndex === claimantPlayerIndex,
    )?.responseTypes,
  ).toContain(claim);
  const submitted = submitResponses(opened, claimantPlayerIndex, claim);
  return {
    submitted,
    resolved: act(submitted, { type: 'RESOLVE_REACTION_WINDOW' }),
  };
}

function discardAndAdvanceTo(
  match: MatchState,
  discardId: TileId,
  targetPlayerIndex: number,
): MatchState {
  let next = allPassAndResolve(act(match, { type: 'DISCARD_TILE', tileId: discardId }));
  while (
    next.currentHand.currentPlayerIndex !== targetPlayerIndex ||
    next.currentHand.turnStage !== 'waiting-for-discard'
  ) {
    expect(next.currentHand.turnStage).toBe('waiting-for-draw');
    next = act(next, { type: 'DRAW_TILE' });
    const drawnId = next.currentHand.selfDrawProvenance?.tileId;
    if (!drawnId) throw new Error('Expected an ordinary head draw');
    if (next.currentHand.currentPlayerIndex === targetPlayerIndex) break;
    next = allPassAndResolve(act(next, { type: 'DISCARD_TILE', tileId: drawnId }));
  }
  return next;
}

const rotationDraws = [
  'tiao-7-1',
  'tong-7-1',
  'wan-8-1',
  'tiao-8-1',
  'tong-8-1',
  'wind-north-1',
  'wind-south-1',
  'wind-west-1',
] satisfies TileId[];

function threeClaimMatch(thirdClaim: 'peng' | 'ming-gang'): MatchState {
  const playerOne = [
    'wan-1-2',
    'wan-1-3',
    'wan-2-2',
    'wan-2-3',
    'wan-3-2',
    'wan-3-3',
    ...(thirdClaim === 'ming-gang' ? (['wan-3-4'] as const) : []),
    'tiao-9-1',
    'tong-9-1',
  ] satisfies TileId[];
  return startDeterministicHand(
    [['wan-1-1', 'wan-2-1', 'wan-3-1'], playerOne, [], []],
    rotationDraws,
    thirdClaim === 'ming-gang' ? ['wind-west-4'] : [],
  );
}

function activateThroughThreePublicPeng(match: MatchState): MatchState {
  const first = claimDiscard(match, 'wan-1-1', 1, 'peng');
  match = discardAndAdvanceTo(first.resolved, 'tiao-9-1', 0);
  const second = claimDiscard(match, 'wan-2-1', 1, 'peng');
  match = discardAndAdvanceTo(second.resolved, 'tong-9-1', 0);
  const third = claimDiscard(match, 'wan-3-1', 1, 'peng');
  expect(third.resolved.currentHand.threeMouthState[1]).toEqual({
    status: 'active',
    payerPlayerIndex: 0,
  });
  return third.resolved;
}

const specialHuRotationDraws = [
  'tiao-7-1',
  'tong-7-1',
  'wan-8-1',
  'tiao-7-2',
  'tong-7-2',
  'wan-8-2',
  'wind-north-1',
  'wind-south-1',
  'wind-west-1',
] satisfies TileId[];

describe('A. continuous public production action chains', () => {
  it('continues three public Peng resolutions into a real special discard Hu and Match settlement', () => {
    let match = startDeterministicHand(
      [
        ['wan-1-1', 'wan-2-1', 'wan-3-1', 'wan-9-1'],
        [
          'wan-1-2',
          'wan-1-3',
          'wan-2-2',
          'wan-2-3',
          'wan-3-2',
          'wan-3-3',
          'wan-9-2',
          'wan-9-3',
          'tiao-9-1',
          'tong-9-1',
          'wind-east-4',
        ],
        [],
        [],
      ],
      specialHuRotationDraws,
    );
    match = activateThroughThreePublicPeng(match);
    match = discardAndAdvanceTo(match, 'wind-east-4', 0);
    let opened = act(match, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
    expect(
      opened.currentHand.reactionWindow?.availableReactions.find(
        ({ playerIndex }) => playerIndex === 1,
      )?.responseTypes,
    ).toEqual(['pass', 'hu']);
    opened = submitResponses(opened, 1, 'hu');
    const raw = applyAction(opened.currentHand, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(raw.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'hu-resolved',
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      threeMouthResolution: { triggerPlayerIndex: 0, payerPlayerIndex: 0 },
    });
    match = act(opened, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(match.currentHand.phase).toBe('ended');
    expect(match.currentHand.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
    });
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
  });

  it('continues three public Peng resolutions into a provenance-bound special self-draw and Match settlement', () => {
    const headDraws = [...specialHuRotationDraws, 'tiao-8-4'] satisfies TileId[];
    let match = startDeterministicHand(
      [
        ['wan-1-1', 'wan-2-1', 'wan-3-1'],
        [
          'wan-1-2',
          'wan-1-3',
          'wan-2-2',
          'wan-2-3',
          'wan-3-2',
          'wan-3-3',
          'tiao-8-1',
          'tiao-8-2',
          'tiao-8-3',
          'tiao-9-1',
          'tong-9-1',
          'wind-east-4',
        ],
        [],
        [],
      ],
      headDraws,
    );
    match = activateThroughThreePublicPeng(match);
    match = discardAndAdvanceTo(match, 'wind-east-4', 1);
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'tiao-8-4',
      source: 'wall-head',
    });
    expect(getAvailableSelfDrawHu(match.currentHand, 1)).toMatchObject({
      playerIndex: 1,
      winningTile: { id: 'tiao-8-4' },
      threeMouthResolution: { triggerPlayerIndex: 1, payerPlayerIndex: 0 },
    });
    const raw = applyAction(match.currentHand, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(raw.pendingScoringEvents.at(-1)).toMatchObject({
      source: 'self-draw',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      threeMouthResolution: { triggerPlayerIndex: 1, payerPlayerIndex: 0 },
    });
    match = act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(match.currentHand.phase).toBe('ended');
    expect(match.currentHand.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      successfulAnGangCount: 0,
    });
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
  });

  it('activates three-mouth through three consecutive Peng resolutions from one payer', () => {
    let match = threeClaimMatch('peng');
    const first = claimDiscard(match, 'wan-1-1', 1, 'peng');
    expect(first.submitted.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 0,
      lockedPayerPlayerIndex: null,
    });
    expect(first.resolved.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    });
    match = discardAndAdvanceTo(first.resolved, 'tiao-9-1', 0);

    const second = claimDiscard(match, 'wan-2-1', 1, 'peng');
    expect(second.submitted.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 1,
      lockedPayerPlayerIndex: 0,
    });
    expect(second.resolved.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 0,
    });
    match = discardAndAdvanceTo(second.resolved, 'tong-9-1', 0);

    const third = claimDiscard(match, 'wan-3-1', 1, 'peng');
    expect(third.submitted.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 0,
    });
    expect(third.resolved.currentHand.threeMouthState[1]).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
    });
    const pengs = third.resolved.currentHand.players[1]!.melds.filter(
      ({ type }) => type === 'peng',
    );
    expect(pengs).toHaveLength(3);
    expect(new Set(pengs.flatMap(({ tiles }) => tiles.map(({ id }) => id))).size).toBe(9);
    expect(act(third.resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(third.resolved);
  });

  it('makes a real third MingGang atomically establish active three-mouth and gangPackage', () => {
    let match = threeClaimMatch('ming-gang');
    const first = claimDiscard(match, 'wan-1-1', 1, 'peng');
    match = discardAndAdvanceTo(first.resolved, 'tiao-9-1', 0);
    const second = claimDiscard(match, 'wan-2-1', 1, 'peng');
    match = discardAndAdvanceTo(second.resolved, 'tong-9-1', 0);

    const third = claimDiscard(match, 'wan-3-1', 1, 'ming-gang');
    const rawResolved = applyAction(third.submitted.currentHand, {
      type: 'RESOLVE_REACTION_WINDOW',
    });
    expect(third.submitted.currentHand.threeMouthState[1]).toEqual({
      status: 'tracking',
      mouthCount: 2,
      lockedPayerPlayerIndex: 0,
    });
    expect(third.submitted.currentHand.gangPackage).toEqual({ status: 'none' });
    expect(third.resolved.currentHand.threeMouthState[1]).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
    });
    const meld = third.resolved.currentHand.players[1]!.melds.at(-1)!;
    expect(meld.type).toBe('ming-gang');
    expect(third.resolved.currentHand.gangPackage).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: meld.id,
    });
    expect(rawResolved.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'ming-gang-created',
      payerPlayerIndex: 0,
      receiverPlayerIndex: 1,
      meldId: meld.id,
      transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 }],
    });
    expect(third.resolved.currentHand.selfDrawProvenance?.source).toBe('ming-gang-tail');
    expect(act(third.resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(third.resolved);
  });

  it('keeps an off-source third MingGang and package but permanently invalidates three-mouth', () => {
    let match = startDeterministicHand(
      [
        ['wan-1-1', 'wan-2-1'],
        [
          'wan-1-2',
          'wan-1-3',
          'wan-2-2',
          'wan-2-3',
          'wan-3-2',
          'wan-3-3',
          'wan-3-4',
          'tiao-9-1',
          'tong-9-1',
        ],
        ['wan-3-1'],
        [],
      ],
      rotationDraws,
      ['wind-west-4'],
    );
    const first = claimDiscard(match, 'wan-1-1', 1, 'peng');
    match = discardAndAdvanceTo(first.resolved, 'tiao-9-1', 0);
    const second = claimDiscard(match, 'wan-2-1', 1, 'peng');
    match = discardAndAdvanceTo(second.resolved, 'tong-9-1', 2);
    const third = claimDiscard(match, 'wan-3-1', 1, 'ming-gang');
    const rawResolved = applyAction(third.submitted.currentHand, {
      type: 'RESOLVE_REACTION_WINDOW',
    });
    const meld = third.resolved.currentHand.players[1]!.melds.at(-1)!;
    expect(third.resolved.currentHand.threeMouthState[1]).toEqual({ status: 'invalid' });
    expect(third.resolved.currentHand.gangPackage).toEqual({
      status: 'active',
      payerPlayerIndex: 2,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: meld.id,
    });
    expect(rawResolved.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'ming-gang-created',
      payerPlayerIndex: 2,
      receiverPlayerIndex: 1,
      transfers: [{ fromPlayerIndex: 2, toPlayerIndex: 1, amount: 20 }],
    });
    expect(third.resolved.currentHand.selfDrawProvenance?.source).toBe('ming-gang-tail');
    expect(act(third.resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(third.resolved);
  });

  it('keeps a genuinely produced invalid state through another external mouth and AnGang', () => {
    let match = startDeterministicHand(
      [
        ['wan-1-1', 'wan-3-1'],
        [
          'wan-1-2',
          'wan-1-3',
          'wan-2-2',
          'wan-2-3',
          'wan-3-2',
          'wan-3-3',
          'tong-9-1',
          'tong-9-2',
          'tong-9-3',
          'tong-9-4',
          'tiao-9-1',
          'tiao-9-2',
          'tiao-9-3',
        ],
        ['wan-2-1'],
        [],
      ],
      rotationDraws,
      ['wind-west-4'],
    );
    const first = claimDiscard(match, 'wan-1-1', 1, 'peng');
    match = discardAndAdvanceTo(first.resolved, 'tiao-9-1', 2);
    const differentSource = claimDiscard(match, 'wan-2-1', 1, 'peng');
    expect(differentSource.resolved.currentHand.threeMouthState[1]).toEqual({ status: 'invalid' });
    const invalidState = differentSource.resolved.currentHand.threeMouthState[1];

    match = discardAndAdvanceTo(differentSource.resolved, 'tiao-9-2', 0);
    const laterExternal = claimDiscard(match, 'wan-3-1', 1, 'peng');
    expect(laterExternal.resolved.currentHand.threeMouthState[1]).toEqual(invalidState);
    expect(laterExternal.resolved.currentHand.players[1]!.melds).toHaveLength(3);
    expect(act(laterExternal.resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(
      laterExternal.resolved,
    );

    match = discardAndAdvanceTo(laterExternal.resolved, 'tiao-9-3', 1);
    const afterAnGang = applyAction(match.currentHand, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'tong', rank: 9 },
    });
    expect(afterAnGang.players[1]!.melds.at(-1)?.type).toBe('an-gang');
    expect(afterAnGang.pendingScoringEvents.at(-1)?.type).toBe('an-gang-created');
    expect(afterAnGang.threeMouthState[1]).toEqual(invalidState);
  });
});

type CorruptState = GameState & { readonly threeMouthState: unknown };

function corrupt(state: GameState, threeMouthState: unknown): GameState {
  return { ...state, threeMouthState } as CorruptState as GameState;
}

function expectTransactionalNoOp(before: GameState, after: GameState): void {
  expect(after).toBe(before);
  expect(after.players).toBe(before.players);
  expect(after.players.map(({ hand }) => hand)).toEqual(before.players.map(({ hand }) => hand));
  expect(after.players.map(({ melds }) => melds)).toEqual(before.players.map(({ melds }) => melds));
  expect(after.players.map(({ discardPile }) => discardPile)).toEqual(
    before.players.map(({ discardPile }) => discardPile),
  );
  expect(after.wall).toBe(before.wall);
  expect(after.reactionWindow).toBe(before.reactionWindow);
  expect(after.pendingScoringEvents).toBe(before.pendingScoringEvents);
  expect(after.gangPackage).toBe(before.gangPackage);
  expect(after.threeMouthState).toBe(before.threeMouthState);
  expect(after.handProgressFacts).toBe(before.handProgressFacts);
  expect(after.selfDrawProvenance).toBe(before.selfDrawProvenance);
}

function discardClaimFixture(responseType: 'peng' | 'ming-gang'): GameState {
  const base = createGame();
  const claimTiles =
    responseType === 'peng'
      ? (['wan-3-2', 'wan-3-3'] as const)
      : (['wan-3-2', 'wan-3-3', 'wan-3-4'] as const);
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand: index === 0 ? [ordinary('wan-3-1')] : index === 1 ? claimTiles.map(ordinary) : [],
    })),
    wall: [ordinary('wind-west-4')],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

function submittedClaimFixture(responseType: 'peng' | 'ming-gang'): GameState {
  let state = applyAction(discardClaimFixture(responseType), {
    type: 'DISCARD_TILE',
    tileId: 'wan-3-1',
  });
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    state = applyAction(state, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responder.playerIndex === 1 ? responseType : 'pass',
    });
  }
  return state;
}

function buGangFixture(): GameState {
  const base = createGame();
  return {
    ...base,
    nextMeldSequence: 2,
    players: base.players.map((player, index) =>
      index === 0
        ? {
            ...player,
            hand: [ordinary('wan-7-4')],
            melds: [
              {
                id: 'meld-1',
                type: 'peng' as const,
                tiles: ['wan-7-1', 'wan-7-2', 'wan-7-3'].map((id) => ordinary(id as TileId)),
                claimedTileId: 'wan-7-3' as const,
                fromPlayerIndex: 2,
              },
            ],
            buGangDrawProvenance: [{ targetMeldId: 'meld-1', tileId: 'wan-7-4' as const }],
          }
        : player,
    ),
    wall: [ordinary('wind-west-4')],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

describe('C. corrupt authoritative entry defenses', () => {
  it('rejects reaction availability when the tuple is short', () => {
    const state = corrupt(discardClaimFixture('peng'), createGame().threeMouthState.slice(0, 3));
    const result = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
    expectTransactionalNoOp(state, result);
    expect(result.reactionWindow).toBeUndefined();
  });

  it('rejects reaction submission when the tuple has a fifth item', () => {
    const opened = applyAction(discardClaimFixture('peng'), {
      type: 'DISCARD_TILE',
      tileId: 'wan-3-1',
    });
    const state = corrupt(opened, [...createGame().threeMouthState, { status: 'invalid' }]);
    const result = applyAction(state, {
      type: 'SUBMIT_REACTION',
      playerIndex: 1,
      responseType: 'peng',
    });
    expectTransactionalNoOp(state, result);
    expect(result.reactionWindow?.responses).toEqual([]);
  });

  it('rejects resolution transactionally and resolves the same window after field repair', () => {
    const submitted = submittedClaimFixture('ming-gang');
    const invalidTracking = createGame().threeMouthState.map((value, index) =>
      index === 1 ? { status: 'tracking', mouthCount: 0, lockedPayerPlayerIndex: 0 } : value,
    );
    const state = corrupt(submitted, invalidTracking);
    const blocked = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expectTransactionalNoOp(state, blocked);
    expect(blocked.reactionWindow?.status).toBe('awaiting-resolution');

    const repaired = { ...blocked, threeMouthState: createGame().threeMouthState };
    const resolved = applyAction(repaired, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(resolved.reactionWindow?.status).toBe('closed');
    expect(resolved.players[1]!.melds.at(-1)?.type).toBe('ming-gang');
  });

  it('rejects BuGang before moving the fourth tile or opening a rob window', () => {
    const valid = buGangFixture();
    expect(getAvailableBuGangs(valid, 0)).toHaveLength(1);
    const invalidActive = createGame().threeMouthState.map((value, index) =>
      index === 0 ? { status: 'active', payerPlayerIndex: 0 } : value,
    );
    const state = corrupt(valid, invalidActive);
    expect(getAvailableBuGangs(state, 0)).toHaveLength(1);
    const result = applyAction(state, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-1',
    });
    expectTransactionalNoOp(state, result);
    expect(result.players[0]!.melds[0]!.type).toBe('peng');
    expect(result.reactionWindow).toBeUndefined();
  });

  it('rejects an ordinary DRAW_TILE when an invalid variant has an extra field', () => {
    const base = createGame();
    const state = corrupt(
      {
        ...base,
        wall: [ordinary('wan-9-1')],
        phase: 'playing',
        turnStage: 'waiting-for-draw',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
      },
      [{ status: 'invalid', reason: 'extra' }, ...createGame().threeMouthState.slice(1)],
    );
    expectTransactionalNoOp(state, applyAction(state, { type: 'DRAW_TILE' }));
  });

  it('rejects flower replacement and FlowerKong before consuming any wall tile', () => {
    const base = createGame();
    const flowers = ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map(
      (id) => tile(id as TileId),
    );
    const state = corrupt(
      {
        ...base,
        players: base.players.map((player, index) =>
          index === 0
            ? {
                ...player,
                flowers: flowers.filter((value) => value.category === 'flower'),
              }
            : player,
        ),
        wall: [tile('flower-red-center-4'), ordinary('wan-9-1')],
        phase: 'playing',
        turnStage: 'waiting-for-draw',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
      },
      [{ status: 'active', payerPlayerIndex: 0 }, ...createGame().threeMouthState.slice(1)],
    );
    expectTransactionalNoOp(state, applyAction(state, { type: 'DRAW_TILE' }));
  });
});

describe('D. availability ownership boundaries', () => {
  it('makes AnGang availability read three-mouth while unrelated queries ignore it', () => {
    const valid = buGangFixture();
    const state = corrupt(valid, createGame().threeMouthState.slice(0, 3));
    expect(getAvailableAnGangs(state, 0)).toEqual([]);
    expect(getAvailableBuGangs(state, 0)).toEqual(getAvailableBuGangs(valid, 0));
    expect(getAvailableSelfDrawHu(state, 0)).toEqual(getAvailableSelfDrawHu(valid, 0));
  });
});
