import { describe, expect, it } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  evaluateHuStructure,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  settlePendingScoringEvents,
  startCurrentHand,
  type GameState,
  type MahjongTile,
  type MatchState,
  type OrdinaryHandTile,
  type PendingHuScoringEvent,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function tile(id: TileId): MahjongTile {
  const found = deck.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing tile ${id}`);
  return found;
}

function ordinary(id: TileId): OrdinaryHandTile {
  const found = tile(id);
  if (found.category === 'flower') throw new Error(`Expected ordinary tile ${id}`);
  return found;
}

const standardWaitIds = [
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
] satisfies TileId[];

const sevenPairsWaitIds = [
  'wan-1-1',
  'wan-1-2',
  'wan-3-1',
  'wan-3-2',
  'tiao-1-1',
  'tiao-1-2',
  'tiao-3-1',
  'tiao-3-2',
  'tong-1-1',
  'tong-1-2',
  'tong-3-1',
  'tong-3-2',
  'wind-east-1',
] satisfies TileId[];

const dragonSevenPairsWaitIds = [
  'wan-1-1',
  'wan-1-2',
  'wan-3-1',
  'wan-3-2',
  'tiao-1-1',
  'tiao-1-2',
  'tiao-3-1',
  'tiao-3-2',
  'tong-1-1',
  'tong-1-2',
  'wind-east-1',
  'wind-east-2',
  'wind-east-3',
] satisfies TileId[];

const anGangWaitIds = [
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
  'wan-9-1',
  'wan-9-2',
  'wan-9-3',
] satisfies TileId[];

const robBuGangWaitIds = [
  'wan-5-1',
  'wan-6-1',
  'tiao-1-1',
  'tiao-2-1',
  'tiao-3-1',
  'tong-1-1',
  'tong-2-1',
  'tong-3-1',
  'wind-east-1',
  'wind-east-2',
  'wind-east-3',
  'wind-south-1',
  'wind-south-2',
] satisfies TileId[];

function fillHand(
  required: readonly TileId[],
  size: 13 | 14,
  used: Set<TileId>,
  reserved: ReadonlySet<TileId>,
): MahjongTile[] {
  const result = required.map((id) => {
    if (used.has(id)) throw new Error(`Duplicate required tile ${id}`);
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
  expect(result).toHaveLength(size);
  return result;
}

function deterministicWall(
  requiredHands: readonly (readonly TileId[])[],
  options: {
    readonly headDraws?: readonly TileId[];
    readonly tailDraws?: readonly TileId[];
  } = {},
): MahjongTile[] {
  const used = new Set<TileId>();
  const reservedDraws = [...(options.headDraws ?? []), ...(options.tailDraws ?? [])];
  const allReserved = [...requiredHands.flat(), ...reservedDraws];
  expect(new Set(allReserved).size).toBe(allReserved.length);
  const reserved = new Set(allReserved);
  for (const id of reservedDraws) used.add(id);
  const hands = [0, 1, 2, 3].map((playerIndex) =>
    fillHand(requiredHands[playerIndex] ?? [], playerIndex === 0 ? 14 : 13, used, reserved),
  );
  const deal: MahjongTile[] = [];
  const positions = [0, 0, 0, 0];
  while (positions.some((position, index) => position < hands[index]!.length)) {
    for (let playerIndex = 0; playerIndex < 4; playerIndex += 1) {
      const next = hands[playerIndex]![positions[playerIndex]!];
      if (!next) continue;
      deal.push(next);
      positions[playerIndex] = positions[playerIndex]! + 1;
    }
  }
  const middle = deck.filter((candidate) => !used.has(candidate.id));
  const wall = [
    ...deal,
    ...(options.headDraws ?? []).map(tile),
    ...middle,
    ...(options.tailDraws ?? []).map(tile).reverse(),
  ];
  expect(wall).toHaveLength(144);
  expect(new Set(wall.map((candidate) => candidate.id)).size).toBe(144);
  return wall;
}

function declaredMatch(
  requiredHands: readonly (readonly TileId[])[],
  declaredPlayerIndices: readonly number[],
  options: Parameters<typeof deterministicWall>[1] = {},
): MatchState {
  const readyHand = { ...createGame(), wall: deterministicWall(requiredHands, options) };
  let match = startCurrentHand({ ...createMatch(), currentHand: readyHand });
  while (match.currentHand.diHuDeclarations?.status === 'collecting') {
    const playerIndex = match.currentHand.diHuDeclarations.pendingPlayerIndices[0]!;
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex,
      decision: declaredPlayerIndices.includes(playerIndex) ? 'declare' : 'pass',
    });
  }
  expect(match.currentHand.diHuDeclarations).toMatchObject({
    status: 'closed',
    declarations: declaredPlayerIndices.map((playerIndex) => ({ playerIndex })),
  });
  return match;
}

function respond(
  match: MatchState,
  responseTypes: Readonly<Partial<Record<number, 'pass' | 'hu' | 'peng' | 'ming-gang'>>>,
): MatchState {
  let next = match;
  for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
    next = applyGameActionToMatch(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responseTypes[responder.playerIndex] ?? 'pass',
    });
  }
  return next;
}

function resolveWithVisibleEvent(match: MatchState): {
  readonly raw: GameState;
  readonly settled: MatchState;
} {
  const raw = applyAction(match.currentHand, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(raw.pendingScoringEvents.length).toBeGreaterThan(0);
  const unsettled = { ...match, currentHand: raw };
  return {
    raw,
    settled: applyGameActionToMatch(unsettled, { type: 'RESOLVE_REACTION_WINDOW' }),
  };
}

function discardHuMatch(
  winnerHands: readonly { readonly playerIndex: number; readonly hand: readonly TileId[] }[],
  declaredPlayerIndices: readonly number[],
  winningTileId: TileId,
): { readonly raw: GameState; readonly settled: MatchState; readonly beforeResolve: MatchState } {
  const hands: TileId[][] = [[], [], [], []];
  hands[0] = [winningTileId];
  for (const winner of winnerHands) hands[winner.playerIndex] = [...winner.hand];
  let match = declaredMatch(hands, declaredPlayerIndices);
  match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: winningTileId });
  for (const winner of winnerHands) {
    expect(
      match.currentHand.reactionWindow?.availableReactions.find(
        (availability) => availability.playerIndex === winner.playerIndex,
      )?.responseTypes,
    ).toContain('hu');
  }
  const submitted = respond(
    match,
    Object.fromEntries(winnerHands.map(({ playerIndex }) => [playerIndex, 'hu'])),
  );
  const repeatedWinner = winnerHands[0]!.playerIndex;
  expect(
    applyGameActionToMatch(submitted, {
      type: 'SUBMIT_REACTION',
      playerIndex: repeatedWinner,
      responseType: 'hu',
    }),
  ).toBe(submitted);
  return { ...resolveWithVisibleEvent(submitted), beforeResolve: submitted };
}

function advanceToPlayerOneDraw(match: MatchState, dealerDiscardId: TileId): MatchState {
  let next = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: dealerDiscardId });
  next = respond(next, {});
  next = applyGameActionToMatch(next, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(next.currentHand.currentPlayerIndex).toBe(1);
  expect(next.currentHand.turnStage).toBe('waiting-for-draw');
  return next;
}

function assertScoreConservation(scores: readonly number[]): void {
  expect(scores.reduce((total, score) => total + score, 0)).toBe(4000);
}

function allPassAndResolve(match: MatchState): MatchState {
  return applyGameActionToMatch(respond(match, {}), { type: 'RESOLVE_REACTION_WINDOW' });
}

describe('Di Hu end-to-end resolution and scoring', () => {
  it('settles a real discard Di Hu exactly once and keeps the ordinary +60 comparison explicit', () => {
    const { raw, settled, beforeResolve } = discardHuMatch(
      [{ playerIndex: 1, hand: standardWaitIds }],
      [1],
      'wind-east-2',
    );
    expect(raw.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 0,
      winningTile: { id: 'wind-east-2' },
      winners: [{ playerIndex: 1, evaluation: { patterns: expect.arrayContaining(['di-hu']) } }],
    });
    if (raw.result?.type !== 'win' || raw.result.source === 'self-draw') throw new Error('win');
    expect(raw.result.winners[0]!.evaluation.patterns).not.toContain('tian-hu');
    expect(raw.pendingScoringEvents).toHaveLength(1);
    expect(raw.pendingScoringEvents[0]).toMatchObject({
      type: 'hu-resolved',
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      winningTile: { id: 'wind-east-2' },
      transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 164 }],
    });
    // Ordinary 104; Di Hu adds 30 before open-head x2, so 104 + 30 x2 = 164.
    expect(164 - 104).toBe(60);
    expect(settled.cumulativeScores).toEqual([836, 1164, 1000, 1000]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settled.currentHand.phase).toBe('ended');
    expect(settled.currentHand.handProgressFacts).toMatchObject({
      selfDrawCount: 0,
      gangKaiCount: 0,
    });
    expect(applyAction(raw, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(raw);
    expect(applyGameActionToMatch(settled, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(settled);
    expect(resolveWithVisibleEvent(beforeResolve).settled.cumulativeScores).toEqual(
      settled.cumulativeScores,
    );
    assertScoreConservation(settled.cumulativeScores);
  });

  it('settles a real wall-head self-draw Di Hu with three equal transfers exactly once', () => {
    let match = declaredMatch([['wind-south-1'], standardWaitIds, [], []], [1], {
      headDraws: ['wind-east-2'],
    });
    match = advanceToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'wall-head',
    });
    expect(getAvailableSelfDrawHu(match.currentHand, 1)?.evaluation.patterns).toContain('di-hu');
    const raw = applyAction(match.currentHand, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(raw.result).toMatchObject({
      type: 'win',
      source: 'self-draw',
      drawSource: 'wall-head',
      winningTile: { id: 'wind-east-2' },
      winner: { playerIndex: 1 },
    });
    if (raw.result?.type !== 'win' || raw.result.source !== 'self-draw') throw new Error('win');
    expect(raw.result.winner.evaluation.patterns).toContain('di-hu');
    expect(raw.result.winner.evaluation.patterns).not.toContain('tian-hu');
    expect(raw.players[1]!.hand.filter(({ id }) => id === 'wind-east-2')).toHaveLength(1);
    expect(raw.pendingScoringEvents).toHaveLength(1);
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 164 },
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 164 },
      { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 164 },
    ]);
    expect(raw.handProgressFacts).toMatchObject({ selfDrawCount: 1, gangKaiCount: 0 });
    const unsettled = { ...match, currentHand: raw };
    const settled = applyGameActionToMatch(unsettled, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    expect(settled.cumulativeScores).toEqual([836, 1492, 836, 836]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settled.currentHand.phase).toBe('ended');
    expect(applyAction(raw, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(raw);
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      settled,
    );
    assertScoreConservation(settled.cumulativeScores);
  });

  it('evaluates two real discard winners independently in stable Multi-Hu order', () => {
    const { raw, settled } = discardHuMatch(
      [
        { playerIndex: 1, hand: standardWaitIds },
        {
          playerIndex: 2,
          hand: standardWaitIds.map((id) => id.replace(/-1$/, '-2') as TileId),
        },
      ],
      [1],
      'wind-east-3',
    );
    if (raw.result?.type !== 'win' || raw.result.source === 'self-draw') throw new Error('win');
    expect(raw.result.winners.map(({ playerIndex }) => playerIndex)).toEqual([1, 2]);
    expect(raw.result.winners[0]!.evaluation.patterns).toContain('di-hu');
    expect(raw.result.winners[1]!.evaluation.patterns).not.toContain('di-hu');
    expect(raw.pendingScoringEvents.map((event) => event.transfers[0])).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 164 },
      { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 104 },
    ]);
    expect(settled.cumulativeScores).toEqual([732, 1164, 1104, 1000]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(completeCurrentHand(settled)).toMatchObject({
      dealerIndex: 0,
      effectiveDealerTurn: 1,
    });
    assertScoreConservation(settled.cumulativeScores);
  });

  it('settles a real Rob-BuGang Di Hu without forming or scoring the BuGang', () => {
    let match = declaredMatch(
      [['wan-7-3'], robBuGangWaitIds, ['wan-7-1', 'wan-7-2', 'wind-north-1'], []],
      [1],
      { headDraws: ['wan-8-4', 'tiao-8-4', 'tong-8-4', 'wan-7-4'] },
    );
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-7-3' });
    expect(
      match.currentHand.reactionWindow?.availableReactions.find(
        ({ playerIndex }) => playerIndex === 1,
      )?.responseTypes,
    ).toContain('hu');
    match = respond(match, { 2: 'peng' });
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    const peng = match.currentHand.players[2]!.melds[0]!;
    expect(peng.type).toBe('peng');
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-north-1' });
    match = allPassAndResolve(match);
    for (const [playerIndex, drawnTileId] of [
      [3, 'wan-8-4'],
      [0, 'tiao-8-4'],
      [1, 'tong-8-4'],
    ] as const) {
      expect(match.currentHand.currentPlayerIndex).toBe(playerIndex);
      match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
      match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: drawnTileId });
      match = allPassAndResolve(match);
    }
    expect(match.currentHand.players[1]!.passHu).toBe(false);
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 2,
      tileId: 'wan-7-4',
      source: 'wall-head',
    });
    expect(getAvailableBuGangs(match.currentHand, 2)).toEqual([
      {
        targetMeldId: peng.id,
        tileFace: { category: 'number', suit: 'wan', rank: 7 },
      },
    ]);
    const wallBefore = match.currentHand.wall;
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 2,
      meldId: peng.id,
    });
    expect(match.currentHand.reactionWindow?.source).toBe('bu-gang');
    expect(
      match.currentHand.reactionWindow?.availableReactions.find(
        ({ playerIndex }) => playerIndex === 1,
      )?.responseTypes,
    ).toContain('hu');
    match = respond(match, { 1: 'hu' });
    const { raw, settled } = resolveWithVisibleEvent(match);
    expect(raw.result).toMatchObject({
      type: 'win',
      source: 'rob-bu-gang',
      payerPlayerIndex: 2,
      winningTile: { id: 'wan-7-4' },
      winners: [{ playerIndex: 1, evaluation: { patterns: expect.arrayContaining(['di-hu']) } }],
    });
    const declarations = raw.diHuDeclarations;
    if (declarations?.status !== 'closed') throw new Error('declarations');
    expect(declarations.declarations[0]!.winningTileFaces).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 7,
    });
    expect(raw.pendingScoringEvents).toHaveLength(1);
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 492 },
    ]);
    expect(raw.players[2]!.melds[0]).toEqual(peng);
    expect(raw.players[2]!.hand.map(({ id }) => id)).not.toContain('wan-7-4');
    expect(raw.wall).toEqual(wallBefore);
    expect(raw.selfDrawProvenance).toBeUndefined();
    expect(raw.pendingScoringEvents.some((event) => event.type === 'bu-gang-created')).toBe(false);
    expect(settled.cumulativeScores).toEqual([1000, 1492, 508, 1000]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(applyAction(raw, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(raw);
    assertScoreConservation(settled.cumulativeScores);
  });

  it.each([
    {
      name: 'seven pairs',
      hand: sevenPairsWaitIds,
      winningTileId: 'wind-east-2' as const,
      structure: 'seven-pairs',
      pattern: 'seven-pairs',
      amount: 260,
      scores: [740, 1260, 1000, 1000],
    },
    {
      name: 'dragon seven pairs',
      hand: dragonSevenPairsWaitIds,
      winningTileId: 'wind-east-4' as const,
      structure: 'dragon-seven-pairs',
      pattern: 'dragon-seven-pairs',
      amount: 360,
      scores: [640, 1360, 1000, 1000],
    },
  ])('stacks Di Hu with $name through a public discard Hu action', (scenario) => {
    const { raw, settled } = discardHuMatch(
      [{ playerIndex: 1, hand: scenario.hand }],
      [1],
      scenario.winningTileId,
    );
    if (raw.result?.type !== 'win' || raw.result.source === 'self-draw') throw new Error('win');
    const evaluation = raw.result.winners[0]!.evaluation;
    expect(evaluation.structure.type).toBe(scenario.structure);
    expect(evaluation.patterns).toEqual(expect.arrayContaining(['di-hu', scenario.pattern]));
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: scenario.amount },
    ]);
    expect(settled.cumulativeScores).toEqual(scenario.scores);
    assertScoreConservation(settled.cumulativeScores);
  });

  it('stacks Di Hu with a real flower-replacement Hua Kai and settles 128 per payer', () => {
    let match = declaredMatch([['wind-south-1'], standardWaitIds, [], []], [1], {
      headDraws: ['season-spring-1'],
      tailDraws: ['wind-east-2'],
    });
    match = advanceToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    expect(match.currentHand.players[1]!.flowers.map(({ id }) => id)).toContain('season-spring-1');
    const raw = applyAction(match.currentHand, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    if (raw.result?.type !== 'win' || raw.result.source !== 'self-draw') throw new Error('win');
    expect(raw.result.winner.evaluation.patterns).toEqual(
      expect.arrayContaining(['di-hu', 'hua-kai']),
    );
    expect(raw.result.winner.evaluation.patterns).not.toContain('gang-kai');
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 128 },
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 128 },
      { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 128 },
    ]);
    expect(raw.handProgressFacts).toMatchObject({ selfDrawCount: 1, gangKaiCount: 0 });
    const settled = settlePendingScoringEvents({ ...match, currentHand: raw });
    expect(settled.cumulativeScores).toEqual([872, 1384, 872, 872]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      settled,
    );
    assertScoreConservation(settled.cumulativeScores);
  });

  it('settles a real AnGang event before Di Hu Gang Kai and preserves both scores', () => {
    let match = declaredMatch([['wind-south-1'], anGangWaitIds, [], []], [1], {
      headDraws: ['wan-9-4'],
      tailDraws: ['wind-east-2'],
    });
    match = advanceToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(getAvailableAnGangs(match.currentHand, 1)).toEqual([
      { category: 'number', suit: 'wan', rank: 9 },
    ]);
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });
    expect(match.cumulativeScores).toEqual([990, 1030, 990, 990]);
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'an-gang-tail',
    });
    const raw = applyAction(match.currentHand, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    if (raw.result?.type !== 'win' || raw.result.source !== 'self-draw') throw new Error('win');
    expect(raw.result.winner.evaluation.patterns).toEqual(
      expect.arrayContaining(['di-hu', 'gang-kai']),
    );
    expect(raw.result.winner.evaluation.patterns).not.toContain('hua-kai');
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 212 },
      { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 212 },
      { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 212 },
    ]);
    expect(raw.handProgressFacts).toMatchObject({
      successfulAnGangCount: 1,
      selfDrawCount: 1,
      gangKaiCount: 1,
    });
    const settled = settlePendingScoringEvents({ ...match, currentHand: raw });
    expect(settled.cumulativeScores).toEqual([778, 1666, 778, 778]);
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      settled,
    );
    assertScoreConservation(settled.cumulativeScores);
  });
});

describe('Di Hu final-turn and transactional boundaries', () => {
  it.each([
    { turn: 15, dealerIndex: 1, effectiveDealerTurn: 16, reason: 'normal-dealer-advance' },
    { turn: 16, dealerIndex: 0, effectiveDealerTurn: 16, reason: 'final-turn-continuation' },
  ] as const)('uses the real discard Di Hu result at effective dealer turn $turn', (scenario) => {
    let match = declaredMatch([['wind-east-2'], standardWaitIds, [], []], [1]);
    match = {
      ...match,
      effectiveDealerTurn: scenario.turn,
      isFinalDealerTurn: scenario.turn === 16,
      cumulativeScores: [900, 1100, 1000, 1000],
      completedHands: Array.from({ length: scenario.turn - 1 }, (_, handIndex) => ({
        handIndex,
        dealerIndex: handIndex % 4,
        result: { type: 'draw', reason: 'wall-exhausted' } as const,
      })),
    };
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    match = respond(match, { 1: 'hu' });
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(match.cumulativeScores).toEqual([736, 1264, 1000, 1000]);
    const completed = completeCurrentHand(match);
    expect(completed).toMatchObject({
      dealerIndex: scenario.dealerIndex,
      effectiveDealerTurn: scenario.effectiveDealerTurn,
    });
    expect(completed.completedHands).toHaveLength(scenario.turn);
    expect(completed.completedHands.at(-1)?.reason).toBe(scenario.reason);
    expect(() => completeCurrentHand(completed)).toThrow(/must be playing/i);
  });

  it('combines turn-16 self-draw and big-hand continuation into one completion', () => {
    let match = declaredMatch([['wind-south-1'], standardWaitIds, [], []], [1], {
      headDraws: ['wind-east-2'],
    });
    match = {
      ...match,
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
      completedHands: Array.from({ length: 15 }, (_, handIndex) => ({
        handIndex,
        dealerIndex: handIndex % 4,
        result: { type: 'draw', reason: 'wall-exhausted' } as const,
      })),
    };
    match = advanceToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    match = applyGameActionToMatch(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(match.currentHand.handProgressFacts.selfDrawCount).toBe(1);
    const completed = completeCurrentHand(match);
    expect(completed).toMatchObject({ dealerIndex: 0, effectiveDealerTurn: 16 });
    expect(completed.completedHands).toHaveLength(16);
    expect(completed.completedHands.at(-1)?.reason).toBe('final-turn-continuation');
    expect(completed.cumulativeScores).toEqual([836, 1492, 836, 836]);
    expect(() => completeCurrentHand(completed)).toThrow(/must be playing/i);
  });

  it.each(['valid-first', 'invalid-first'] as const)(
    'rejects a $order mixed pending Hu batch without partial settlement',
    (order) => {
      const { raw } = discardHuMatch(
        [{ playerIndex: 1, hand: standardWaitIds }],
        [1],
        'wind-east-2',
      );
      const valid = raw.pendingScoringEvents[0] as PendingHuScoringEvent;
      const invalid = {
        ...valid,
        transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 0, amount: 164 }],
      } as unknown as PendingHuScoringEvent;
      const events = order === 'valid-first' ? [valid, invalid] : [invalid, valid];
      const match: MatchState = {
        ...createMatch(),
        status: 'playing',
        currentHandStatus: 'playing',
        cumulativeScores: [900, 1100, 1000, 1000],
        currentHand: { ...raw, pendingScoringEvents: events },
      };
      expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
      expect(match.cumulativeScores).toEqual([900, 1100, 1000, 1000]);
      expect(match.currentHand.pendingScoringEvents).toEqual(events);
      expect(() => completeCurrentHand(match)).toThrow(/invariant/i);
      expect(match.completedHands).toEqual([]);
    },
  );

  it('keeps Tian Hu fixed at 1000 and rejects Tian Hu plus Di Hu metadata atomically', () => {
    const structure = evaluateHuStructure({
      concealedTiles: standardWaitIds.map(ordinary),
      winningTile: ordinary('wind-east-2'),
      melds: [],
    });
    if (!structure) throw new Error('Expected structure');
    const corruptEvaluation = {
      structure,
      patterns: ['di-hu', 'tian-hu'],
      hardFlowerCount: 0,
      softFlowerCount: 0,
    } as unknown as PendingHuScoringEvent['evaluation'];
    const corruptEvent = {
      type: 'hu-resolved',
      source: 'self-draw',
      winnerPlayerIndex: 0,
      winningTile: ordinary('wind-east-2'),
      evaluation: corruptEvaluation,
      drawSource: 'initial-dealer',
      transfers: [1, 2, 3].map((fromPlayerIndex) => ({
        fromPlayerIndex,
        toPlayerIndex: 0,
        amount: 1000,
      })),
      status: 'pending',
    } as const;
    const match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: {
        ...createGame(),
        pendingScoringEvents: [corruptEvent as unknown as PendingHuScoringEvent],
      },
    };
    expect(() => settlePendingScoringEvents(match)).toThrow(/invariant/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toHaveLength(1);

    const corruptResultMatch: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: {
        ...createGame(),
        phase: 'ended',
        turnStage: 'hand-ended',
        pendingAction: { playerIndex: null, seat: null, type: 'none' },
        result: {
          type: 'win',
          source: 'self-draw',
          winningTile: ordinary('wind-east-2'),
          winner: { playerIndex: 0, evaluation: corruptEvaluation },
          drawSource: 'initial-dealer',
        },
      },
    };
    expect(() => completeCurrentHand(corruptResultMatch)).toThrow(/valid result/i);
    expect(corruptResultMatch.completedHands).toEqual([]);
  });

  it('keeps a real dealer Tian Hu mutually exclusive and fixed at 1000 after Di Hu decisions', () => {
    const dealerWait = standardWaitIds.map((id) => id.replace(/-1$/, '-2') as TileId);
    let match = declaredMatch([[...dealerWait, 'wind-east-3'], standardWaitIds, [], []], []);
    const availability = getAvailableSelfDrawHu(match.currentHand, 0);
    expect(availability?.evaluation.patterns).toEqual(['tian-hu']);
    expect(availability?.evaluation.patterns).not.toContain('di-hu');
    const raw = applyAction(match.currentHand, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 0,
    });
    expect(raw.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 1000 },
      { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 1000 },
      { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 1000 },
    ]);
    match = settlePendingScoringEvents({ ...match, currentHand: raw });
    expect(match.cumulativeScores).toEqual([4000, 0, 0, 0]);
    expect(match.currentHand.diHuDeclarations).toMatchObject({
      status: 'closed',
      declarations: [],
    });
    assertScoreConservation(match.cumulativeScores);
  });
});
