import { describe, expect, it } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  prepareNextHand,
  settlePendingScoringEvents,
  startCurrentHand,
  type GameAction,
  type GameState,
  type MahjongTile,
  type MatchState,
  type Meld,
  type OrdinaryHandTile,
  type Tile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();
const east = { category: 'wind', wind: 'east' } as const;
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
const twoMeldWait = [
  'wan-1-1',
  'wan-2-1',
  'wan-3-1',
  'tiao-1-1',
  'tiao-2-1',
  'tiao-3-1',
  'wind-east-1',
] satisfies TileId[];

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

function act(match: MatchState, action: GameAction): MatchState {
  return applyGameActionToMatch(match, action);
}

function respondAndResolve(
  match: MatchState,
  responses: Readonly<Partial<Record<number, 'pass' | 'hu' | 'peng' | 'ming-gang'>>> = {},
): MatchState {
  let next = match;
  for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
    next = act(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responses[responder.playerIndex] ?? 'pass',
    });
  }
  return act(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function realMingGangPackage(
  beneficiaryHand: readonly TileId[],
  tail: readonly Tile[],
  playerThreeHand: readonly TileId[] = [],
  beneficiaryMelds: readonly Meld[] = [],
): MatchState {
  const base = createGame();
  let match = matchWithHand({
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-9-1')]
          : index === 1
            ? beneficiaryHand.map(ordinary)
            : index === 3
              ? playerThreeHand.map(ordinary)
              : [],
      melds: index === 1 ? [...beneficiaryMelds] : [],
    })),
    wall: [...tail],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  });
  match = act(match, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
  return respondAndResolve(match, { 1: 'ming-gang' });
}

function packageAfterMingGangForAnGang(): MatchState {
  return realMingGangPackage(
    [...twoMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4', 'wan-8-1', 'wan-8-2', 'wan-8-3'],
    [ordinary(winningTileId), ordinary('wan-8-4')],
  );
}

function packageThenClear(multiHu = false): {
  readonly activePackage: Exclude<GameState['gangPackage'], { status: 'none' }>;
  readonly openHu: MatchState;
} {
  const playerThreeWait = [
    'wan-4-1',
    'wan-4-2',
    'wan-5-1',
    'wan-5-2',
    'wan-6-1',
    'wan-6-2',
    'tiao-4-1',
    'tiao-4-2',
    'tiao-5-1',
    'tiao-5-2',
    'tiao-6-1',
    'tiao-6-2',
    'wind-east-3',
  ] satisfies TileId[];
  let match = realMingGangPackage(
    [...oneMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4'],
    [ordinary(winningTileId), ordinary('wind-south-4'), ordinary('tong-9-4')],
    multiHu ? playerThreeWait : [],
  );
  if (match.currentHand.gangPackage.status !== 'active') throw new Error('Missing package');
  const activePackage = match.currentHand.gangPackage;
  match = act(match, { type: 'DISCARD_TILE', tileId: 'tong-9-4' });
  expect(match.currentHand.gangPackage).toEqual({ status: 'none' });
  match = respondAndResolve(match);
  match = act(match, { type: 'DRAW_TILE' });
  match = act(match, { type: 'DISCARD_TILE', tileId: winningTileId });
  return { activePackage, openHu: match };
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
    if (candidate.category === 'flower' || used.has(candidate.id) || reserved.has(candidate.id))
      continue;
    used.add(candidate.id);
    result.push(candidate);
  }
  return result;
}

function initialWall(
  playerOne: readonly TileId[],
  playerZero: readonly TileId[],
  tail: readonly TileId[],
): MahjongTile[] {
  const used = new Set<TileId>(tail);
  const reserved = new Set<TileId>([...playerOne, ...playerZero, ...tail]);
  const hands = [
    fillHand(playerZero, 14, used, reserved),
    fillHand(playerOne, 13, used, reserved),
    fillHand([], 13, used, reserved),
    fillHand([], 13, used, reserved),
  ];
  const deal: MahjongTile[] = [];
  const positions = [0, 0, 0, 0];
  while (positions.some((position, index) => position < hands[index]!.length)) {
    for (let index = 0; index < 4; index += 1) {
      const next = hands[index]![positions[index]!];
      if (next) {
        deal.push(next);
        positions[index] = positions[index]! + 1;
      }
    }
  }
  const selected = new Set([...deal, ...tail.map(tile)].map((value) => value.id));
  return [...deal, ...deck.filter((value) => !selected.has(value.id)), ...tail.map(tile).reverse()];
}

function declaredDiHuPackage(): MatchState {
  const playerOne = [...oneMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4'] satisfies TileId[];
  const ready = {
    ...createGame(),
    wall: initialWall(playerOne, ['wan-9-1'], [winningTileId]),
  };
  let match = startCurrentHand({ ...createMatch(), currentHand: ready });
  while (match.currentHand.diHuDeclarations?.status === 'collecting') {
    const playerIndex = match.currentHand.diHuDeclarations.pendingPlayerIndices[0]!;
    match = act(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex,
      decision: playerIndex === 1 ? 'declare' : 'pass',
    });
  }
  match = act(match, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
  return respondAndResolve(match, { 1: 'ming-gang' });
}

describe('gang package remaining public integration chains', () => {
  it('keeps the first MingGang package through AnGang and settles both real score batches once', () => {
    let match = packageAfterMingGangForAnGang();
    const originalPackage = match.currentHand.gangPackage;
    expect(originalPackage).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: 'meld-1',
    });
    expect(getAvailableAnGangs(match.currentHand, 1)).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 8,
    });
    match = act(match, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 8 },
    });
    expect(match.currentHand.gangPackage).toEqual(originalPackage);
    expect(match.cumulativeScores).toEqual([950, 1050, 1000, 1000]);
    expect(match.currentHand.selfDrawProvenance).toMatchObject({ source: 'an-gang-tail' });
    const availability = getAvailableSelfDrawHu(match.currentHand, 1);
    expect(availability?.evaluation.patterns).toContain('gang-kai');
    expect(availability?.evaluation.patterns).not.toContain('hua-kai');
    const beforeHu = match;
    expect(
      applyAction(match.currentHand, {
        type: 'DECLARE_SELF_DRAW_HU',
        playerIndex: 1,
      }).pendingScoringEvents.at(-1)?.transfers,
    ).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 160 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 160 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 160 },
    ]);
    match = act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(match.cumulativeScores).toEqual([470, 1530, 1000, 1000]);
    expect(match.currentHand.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
    expect(match.currentHand.gangPackage).toEqual({ status: 'none' });
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
    expect(settlePendingScoringEvents(match)).toBe(match);
    expect(act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(match);
    expect(
      act(beforeHu, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: { category: 'number', suit: 'wan', rank: 8 },
      }),
    ).toBe(beforeHu);
  });

  it('preserves a real MingGang package while a legal old Peng fixture becomes BuGang', () => {
    const oldPeng = {
      id: 'meld-8',
      type: 'peng' as const,
      tiles: ['wan-7-1', 'wan-7-2', 'wan-7-3'].map((id) => ordinary(id as TileId)),
      claimedTileId: 'wan-7-3' as const,
      fromPlayerIndex: 2,
    };
    let match = realMingGangPackage(
      [...twoMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4'],
      [ordinary(winningTileId), ordinary('wan-7-4')],
      [],
      [oldPeng],
    );
    const originalPackage = match.currentHand.gangPackage;
    expect(getAvailableBuGangs(match.currentHand, 1)[0]?.targetMeldId).toBe(oldPeng.id);
    match = act(match, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: oldPeng.id });
    expect(match.currentHand.reactionWindow?.source).toBe('bu-gang');
    match = respondAndResolve(match);
    expect(match.currentHand.gangPackage).toEqual(originalPackage);
    expect(match.currentHand.players[1]?.melds.find((meld) => meld.id === oldPeng.id)?.type).toBe(
      'bu-gang',
    );
    expect(match.cumulativeScores).toEqual([960, 1040, 1000, 1000]);
    expect(match.currentHand.selfDrawProvenance).toMatchObject({ source: 'bu-gang-tail' });
    expect(
      applyAction(match.currentHand, {
        type: 'DECLARE_SELF_DRAW_HU',
        playerIndex: 1,
      }).pendingScoringEvents.at(-1)?.transfers,
    ).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 156 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 156 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 156 },
    ]);
    match = act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(match.cumulativeScores).toEqual([492, 1508, 1000, 1000]);
    expect(match.currentHand.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
    expect(match.currentHand.gangPackage).toEqual({ status: 'none' });
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
    expect(act(match, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(match);
  });

  it('stacks a public Di Hu declaration with a real packaged Gang Kai', () => {
    let match = declaredDiHuPackage();
    const declaration = match.currentHand.diHuDeclarations;
    expect(declaration?.status).toBe('closed');
    expect(
      declaration?.status === 'closed' ? declaration.declarations[0]?.winningTileFaces : [],
    ).toContainEqual(east);
    expect(match.currentHand.gangPackage.status).toBe('active');
    const availability = getAvailableSelfDrawHu(match.currentHand, 1);
    expect(availability?.evaluation.patterns).toEqual(
      expect.arrayContaining(['di-hu', 'gang-kai']),
    );
    expect(availability?.evaluation.patterns).not.toContain('tian-hu');
    expect(availability?.evaluation.patterns).not.toContain('hua-kai');
    expect(
      applyAction(match.currentHand, {
        type: 'DECLARE_SELF_DRAW_HU',
        playerIndex: 1,
      }).pendingScoringEvents.at(-1)?.transfers,
    ).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 208 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 208 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 208 },
    ]);
    match = act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(match.cumulativeScores).toEqual([356, 1644, 1000, 1000]);
    expect(match.currentHand.handProgressFacts).toMatchObject({
      packageSettlementCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
  });

  it('keeps the dealer on effective turn 15 after one real package settlement', () => {
    const hand = realMingGangPackage(
      [...oneMeldWait, 'wan-9-2', 'wan-9-3', 'wan-9-4'],
      [ordinary(winningTileId)],
    ).currentHand;
    let match = matchWithHand(hand, 15);
    match = act(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    const scores = match.cumulativeScores;
    const completed = completeCurrentHand(match);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.effectiveDealerTurn).toBe(15);
    expect(completed.completedHands).toHaveLength(1);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');
    expect(completed.cumulativeScores).toEqual(scores);
    expect(() => completeCurrentHand(completed)).toThrow(/must be playing/i);
    const next = prepareNextHand(completed);
    expect(next.currentHand.gangPackage).toEqual({ status: 'none' });
    expect(next.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it('clears the package before a later real discard Hu and charges the actual discarder', () => {
    const { openHu } = packageThenClear();
    const match = respondAndResolve(openHu, { 1: 'hu' });
    expect(match.currentHand.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 2,
      winners: [{ playerIndex: 1 }],
    });
    expect(match.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
    expect(match.cumulativeScores).toEqual([980, 1128, 892, 1000]);
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
    expect(act(match, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(match);
  });

  it('keeps a cleared package out of a later real ordered Multi-Hu', () => {
    const { openHu } = packageThenClear(true);
    const match = respondAndResolve(openHu, { 1: 'hu', 3: 'hu' });
    expect(match.currentHand.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 2,
      winners: [{ playerIndex: 3 }, { playerIndex: 1 }],
    });
    expect(match.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
    expect(match.cumulativeScores).toEqual([980, 1128, 688, 1204]);
    expect(match.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(4000);
  });
});

describe('active package incompatible Hu recovery', () => {
  it('closes an otherwise legal discard-Hu window without result, event, or partial mutation', () => {
    const { activePackage, openHu } = packageThenClear();
    const corrupt = {
      ...openHu,
      currentHand: { ...openHu.currentHand, gangPackage: activePackage },
    } as unknown as MatchState;
    let submitted = corrupt;
    for (const responder of corrupt.currentHand.reactionWindow?.responderOrder ?? []) {
      submitted = act(submitted, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex === 1 ? 'hu' : 'pass',
      });
    }
    const beforePlayers = structuredClone(submitted.currentHand.players);
    const beforeWall = structuredClone(submitted.currentHand.wall);
    const resolved = act(submitted, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(resolved.currentHand.phase).toBe('playing');
    expect(resolved.currentHand.result).toBeUndefined();
    expect(resolved.currentHand.pendingScoringEvents).toEqual([]);
    expect(resolved.currentHand.gangPackage).toEqual(activePackage);
    expect(resolved.currentHand.reactionWindow?.status).toBe('closed');
    expect(resolved.currentHand.players).toEqual(beforePlayers);
    expect(resolved.currentHand.wall).toEqual(beforeWall);
    expect(resolved.currentHand.handProgressFacts.packageSettlementCount).toBe(0);
    expect(act(resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(resolved);
  });

  it('cancels an otherwise legal rob-BuGang window without upgrading, scoring, or tail draw', () => {
    const base = createGame();
    const peng = {
      id: 'meld-1',
      type: 'peng' as const,
      tiles: ['wan-7-1', 'wan-7-2', 'wan-7-3'].map((id) => ordinary(id as TileId)),
      claimedTileId: 'wan-7-3' as const,
      fromPlayerIndex: 2,
    };
    const packageMeld = {
      id: 'meld-2',
      type: 'ming-gang' as const,
      tiles: [1, 2, 3, 4].map((copy) => ordinary(`tiao-9-${copy}` as TileId)),
      claimedTileId: 'tiao-9-4' as const,
      fromPlayerIndex: 2,
    };
    const robWait = [
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
    let match = matchWithHand({
      ...base,
      nextMeldSequence: 3,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              hand: [ordinary('wan-7-4')],
              melds: [peng],
              buGangDrawProvenance: [{ targetMeldId: peng.id, tileId: 'wan-7-4' }],
            }
          : index === 1
            ? { ...player, hand: robWait.map(ordinary) }
            : index === 3
              ? { ...player, melds: [packageMeld] }
              : player,
      ),
      wall: [ordinary('tong-9-1')],
      currentPlayerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      gangPackage: {
        status: 'active',
        payerPlayerIndex: 2,
        beneficiaryPlayerIndex: 3,
        source: 'ming-gang',
        establishedByMeldId: packageMeld.id,
      },
    });
    expect(
      new Set(
        match.currentHand.players.flatMap((player) => [
          ...player.hand.map((value) => value.id),
          ...player.melds.flatMap((meld) => meld.tiles.map((value) => value.id)),
        ]),
      ).size,
    ).toBe(21);
    expect(getAvailableBuGangs(match.currentHand, 0)[0]?.targetMeldId).toBe(peng.id);
    match = act(match, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: peng.id });
    expect(match.currentHand.reactionWindow?.availableReactions[0]?.responseTypes).toContain('hu');
    const wall = match.currentHand.wall;
    match = respondAndResolve(match, { 1: 'hu' });
    expect(match.currentHand.phase).toBe('playing');
    expect(match.currentHand.result).toBeUndefined();
    expect(match.currentHand.players[0]?.melds[0]?.type).toBe('peng');
    expect(match.currentHand.players[0]?.hand.map((value) => value.id)).toContain('wan-7-4');
    expect(match.currentHand.wall).toEqual(wall);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.currentHand.gangPackage.status).toBe('active');
    expect(match.currentHand.reactionWindow?.status).toBe('closed');
    expect(match.currentHand.pendingAction).toMatchObject({ playerIndex: 0, type: 'discard' });
    expect(act(match, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(match);
  });
});
