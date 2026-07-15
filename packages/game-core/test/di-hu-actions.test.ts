import { describe, expect, it, vi } from 'vitest';

import {
  NANJING_OPEN_RULE_SET,
  applyAction,
  applyGameActionToMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  startCurrentHand,
  type GameState,
  type MahjongTile,
  type MatchState,
  type OrdinaryHandTile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();
const east = { category: 'wind', wind: 'east' } as const;
const wan2 = { category: 'number', suit: 'wan', rank: 2 } as const;
const wan9 = { category: 'number', suit: 'wan', rank: 9 } as const;

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

function ordinaryTiles(ids: readonly TileId[]): OrdinaryHandTile[] {
  return ids.map(ordinary);
}

const eastWaitIds = [
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

const eastWaitWithWan9TripletIds = [
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

const changingWan2TripletIds = [
  'wan-1-1',
  'wan-2-1',
  'wan-3-1',
  'wan-4-1',
  'wan-5-1',
  'wan-6-1',
  'wan-7-1',
  'wan-8-1',
  'wan-9-1',
  'wan-2-2',
  'wan-2-3',
  'wan-3-2',
  'wan-4-2',
] satisfies TileId[];

function fillHand(
  required: readonly TileId[],
  size: 13 | 14,
  used: Set<TileId>,
  reserved: ReadonlySet<TileId>,
): MahjongTile[] {
  const result = required.map((id) => {
    if (used.has(id)) throw new Error(`Duplicate reserved tile ${id}`);
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
  playerOneIds: readonly TileId[],
  options: {
    readonly playerZeroIds?: readonly TileId[];
    readonly playerTwoIds?: readonly TileId[];
    readonly playerThreeIds?: readonly TileId[];
    readonly headDraws?: readonly TileId[];
    readonly tailDraws?: readonly TileId[];
  } = {},
): MahjongTile[] {
  const used = new Set<TileId>();
  const requiredHands = [
    options.playerZeroIds ?? [],
    playerOneIds,
    options.playerTwoIds ?? [],
    options.playerThreeIds ?? [],
  ];
  const reservedDraws = [...(options.headDraws ?? []), ...(options.tailDraws ?? [])];
  const allReserved = [...requiredHands.flat(), ...reservedDraws];
  expect(new Set(allReserved).size).toBe(allReserved.length);
  const reserved = new Set(allReserved);
  for (const id of reservedDraws) used.add(id);
  const hands = [
    fillHand(requiredHands[0]!, 14, used, reserved),
    fillHand(requiredHands[1]!, 13, used, reserved),
    fillHand(requiredHands[2]!, 13, used, reserved),
    fillHand(requiredHands[3]!, 13, used, reserved),
  ];
  const deal: MahjongTile[] = [];
  const positions = [0, 0, 0, 0];
  while (positions.some((position, index) => position < hands[index]!.length)) {
    for (let playerIndex = 0; playerIndex < 4; playerIndex += 1) {
      const position = positions[playerIndex]!;
      const next = hands[playerIndex]![position];
      if (!next) continue;
      deal.push(next);
      positions[playerIndex] = position + 1;
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
  playerOneIds: readonly TileId[],
  options: Parameters<typeof deterministicWall>[1] = {},
): MatchState {
  const readyHand = { ...createGame(), wall: deterministicWall(playerOneIds, options) };
  let match = startCurrentHand({ ...createMatch(), currentHand: readyHand });
  while (match.currentHand.diHuDeclarations?.status === 'collecting') {
    const playerIndex = match.currentHand.diHuDeclarations.pendingPlayerIndices[0]!;
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex,
      decision: playerIndex === 1 ? 'declare' : 'pass',
    });
  }
  expect(match.currentHand.diHuDeclarations).toMatchObject({
    status: 'closed',
    declarations: [{ playerIndex: 1 }],
  });
  expect(match.currentHand.currentPlayerIndex).toBe(0);
  expect(match.currentHand.turnStage).toBe('waiting-for-discard');
  return match;
}

function respondAndResolve(
  match: MatchState,
  responses: Readonly<Partial<Record<number, 'pass' | 'hu' | 'peng' | 'ming-gang'>>> = {},
): MatchState {
  let next = match;
  for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
    next = applyGameActionToMatch(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responses[responder.playerIndex] ?? 'pass',
    });
  }
  return applyGameActionToMatch(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function advanceDealerDiscardToPlayerOneDraw(match: MatchState, discardId: TileId): MatchState {
  const discarded = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: discardId });
  const resolved = respondAndResolve(discarded);
  expect(resolved.currentHand.currentPlayerIndex).toBe(1);
  expect(resolved.currentHand.turnStage).toBe('waiting-for-draw');
  return resolved;
}

function declaration(state: GameState) {
  const declarations = state.diHuDeclarations;
  if (declarations?.status !== 'closed') throw new Error('Expected closed declarations');
  const value = declarations.declarations.find((candidate) => candidate.playerIndex === 1);
  if (!value) throw new Error('Missing player-one declaration');
  return value;
}

function available(state: GameState, playerIndex: number) {
  return state.reactionWindow?.availableReactions.find(
    (candidate) => candidate.playerIndex === playerIndex,
  );
}

describe('declared Di Hu draw-discard production chains', () => {
  it('accepts only the exact wall-head entity and preserves declaration and snapshot', () => {
    let match = declaredMatch(eastWaitIds, {
      playerZeroIds: ['wind-south-1'],
      headDraws: ['wind-east-2'],
    });
    match = advanceDealerDiscardToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    const drawn = match.currentHand.selfDrawProvenance;
    const snapshot = structuredClone(declaration(match.currentHand).winningTileFaces);
    expect(drawn).toEqual({ playerIndex: 1, tileId: 'wind-east-2', source: 'wall-head' });

    for (const illegalId of ['wan-1-1', 'wind-east-1'] satisfies TileId[]) {
      const before = match;
      const result = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: illegalId });
      expect(result).toBe(before);
      expect(result.currentHand.selfDrawProvenance).toBe(drawn);
      expect(declaration(result.currentHand).winningTileFaces).toEqual(snapshot);
      expect(result.currentHand.pendingScoringEvents).toEqual([]);
    }

    const discarded = applyGameActionToMatch(match, {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    expect(discarded).not.toBe(match);
    expect(discarded.currentHand.players[1]!.hand.map((value) => value.id)).toContain(
      'wind-east-1',
    );
    expect(declaration(discarded.currentHand).winningTileFaces).toEqual(snapshot);
    expect(discarded.currentHand.currentPlayerIndex).toBe(2);
  });

  it('uses only the final ordinary flower replacement entity, including consecutive flowers', () => {
    let match = declaredMatch(eastWaitIds, {
      playerZeroIds: ['wind-south-1'],
      headDraws: ['flower-red-center-1'],
      tailDraws: [
        'flower-red-center-2',
        'flower-red-center-3',
        'flower-red-center-4',
        'wind-east-2',
      ],
    });
    match = advanceDealerDiscardToPlayerOneDraw(match, 'wind-south-1');
    const wallLength = match.currentHand.wall.length;
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    const snapshot = structuredClone(declaration(match.currentHand).winningTileFaces);

    expect(match.currentHand.wall).toHaveLength(wallLength - 5);
    expect(match.currentHand.players[1]!.flowers.map((value) => value.id)).toEqual([
      'flower-red-center-1',
      'flower-red-center-2',
      'flower-red-center-3',
      'flower-red-center-4',
    ]);
    expect(match.currentHand.players[1]!.hand.map((value) => value.id)).not.toContain(
      'flower-red-center-1',
    );
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: true,
    });
    expect(match.currentHand.handProgressFacts.flowerKongCount).toBe(1);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.cumulativeScores).toEqual([980, 1060, 980, 980]);
    for (const illegalId of [
      'flower-red-center-1',
      'flower-red-center-2',
      'wind-east-1',
    ] satisfies TileId[]) {
      expect(applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: illegalId })).toBe(
        match,
      );
    }
    const discarded = applyGameActionToMatch(match, {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    expect(discarded).not.toBe(match);
    expect(declaration(discarded.currentHand).winningTileFaces).toEqual(snapshot);
  });
});

describe('declared Di Hu Peng defenses', () => {
  const pengWaitIds = [
    'wan-1-1',
    'wan-2-1',
    'wan-3-1',
    'tiao-1-1',
    'tiao-2-1',
    'tiao-3-1',
    'tong-1-1',
    'tong-2-1',
    'tong-3-1',
    'wan-9-1',
    'wan-9-2',
    'wind-east-1',
    'wind-east-2',
  ] satisfies TileId[];

  it('blocks availability and direct submit without changing any transaction state', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers');
    const match = declaredMatch(pengWaitIds, { playerZeroIds: ['wan-9-3'] });
    const open = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-9-3' });
    const beforePlayer = structuredClone(open.currentHand.players[1]);
    const beforeDeclaration = structuredClone(declaration(open.currentHand));
    expect(available(open.currentHand, 1)?.responseTypes).not.toContain('peng');

    const rejected = applyGameActionToMatch(open, {
      type: 'SUBMIT_REACTION',
      playerIndex: 1,
      responseType: 'peng',
    });
    expect(rejected).toBe(open);
    expect(rejected.currentHand.players[1]).toEqual(beforePlayer);
    expect(declaration(rejected.currentHand)).toEqual(beforeDeclaration);
    expect(rejected.currentHand.reactionWindow?.responses).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('revalidates and rejects a stale injected Peng response at resolver time', () => {
    const match = declaredMatch(pengWaitIds, { playerZeroIds: ['wan-9-3'] });
    const open = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-9-3' });
    const window = open.currentHand.reactionWindow!;
    const corrupt = {
      ...open.currentHand,
      currentPlayerIndex: 3,
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      reactionWindow: {
        ...window,
        responses: window.responderOrder.map((responder) => ({
          ...responder,
          type: responder.playerIndex === 1 ? 'peng' : 'pass',
        })),
        status: 'awaiting-resolution',
      },
    } as unknown as GameState;
    const before = structuredClone(corrupt.players[1]);
    const result = applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result).toBe(corrupt);
    expect(result.players[1]).toEqual(before);
    expect(declaration(result)).toEqual(declaration(corrupt));
    expect(result.pendingScoringEvents).toEqual([]);
  });
});

describe('declared Di Hu MingGang production chain', () => {
  it('forms, settles, tail-draws, and requires the exact tail entity once', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers');
    let match = declaredMatch(eastWaitWithWan9TripletIds, {
      playerZeroIds: ['wan-9-4'],
      tailDraws: ['wind-east-2'],
    });
    const snapshot = structuredClone(declaration(match.currentHand).winningTileFaces);
    const wallLength = match.currentHand.wall.length;
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-9-4' });
    expect(available(match.currentHand, 1)?.responseTypes).toContain('ming-gang');
    match = respondAndResolve(match, { 1: 'ming-gang' });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(match.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.currentHand.wall).toHaveLength(wallLength - 1);
    expect(match.currentHand.players[1]!.melds).toContainEqual(
      expect.objectContaining({ type: 'ming-gang', claimedTileId: 'wan-9-4' }),
    );
    const meld = match.currentHand.players[1]!.melds[0]!;
    expect(match.currentHand.players[0]!.discardPile.at(-1)?.claimedByMeldId).toBe(meld.id);
    expect(match.currentHand.players[1]!.hand.map((value) => value.id)).not.toEqual(
      expect.arrayContaining(['wan-9-1', 'wan-9-2', 'wan-9-3']),
    );
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'ming-gang-tail',
    });
    expect(declaration(match.currentHand).winningTileFaces).toEqual(snapshot);
    expect(applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(match);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-1' })).toBe(
      match,
    );
    const discarded = applyGameActionToMatch(match, {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    expect(discarded).not.toBe(match);
    expect(declaration(discarded.currentHand).winningTileFaces).toEqual(snapshot);
    hook.mockRestore();
  });

  it('rejects a wait-changing MingGang at availability, submit, and stale resolver layers', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers');
    const match = declaredMatch(changingWan2TripletIds, { playerZeroIds: ['wan-2-4'] });
    const open = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-2-4' });
    expect(declaration(open.currentHand).winningTileFaces).toEqual([wan2, { ...wan2, rank: 5 }]);
    expect(available(open.currentHand, 1)?.responseTypes).not.toContain('ming-gang');
    expect(
      applyGameActionToMatch(open, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(open);

    const window = open.currentHand.reactionWindow!;
    const corrupt = {
      ...open.currentHand,
      currentPlayerIndex: 3,
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      reactionWindow: {
        ...window,
        responses: window.responderOrder.map((responder) => ({
          ...responder,
          type: responder.playerIndex === 1 ? 'ming-gang' : 'pass',
        })),
        status: 'awaiting-resolution',
      },
    } as unknown as GameState;
    expect(applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(corrupt);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('does not expose an otherwise wait-preserving MingGang when the wall is empty', () => {
    const match = declaredMatch(eastWaitWithWan9TripletIds, { playerZeroIds: ['wan-9-4'] });
    const empty = { ...match, currentHand: { ...match.currentHand, wall: [] } };
    const open = applyGameActionToMatch(empty, { type: 'DISCARD_TILE', tileId: 'wan-9-4' });
    expect(available(open.currentHand, 1)?.responseTypes).not.toContain('ming-gang');
  });
});

describe('declared Di Hu AnGang production chain', () => {
  it('forms, settles three payments, tail-draws, and remains idempotent', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');
    let match = declaredMatch(eastWaitWithWan9TripletIds, {
      playerZeroIds: ['wind-south-1'],
      headDraws: ['wan-9-4'],
      tailDraws: ['wind-east-2'],
    });
    match = advanceDealerDiscardToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    const snapshot = structuredClone(declaration(match.currentHand).winningTileFaces);
    expect(match.currentHand.selfDrawProvenance?.tileId).toBe('wan-9-4');
    expect(getAvailableAnGangs(match.currentHand, 1)).toEqual([wan9]);
    const wallLength = match.currentHand.wall.length;
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: wan9,
    });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(match.cumulativeScores).toEqual([990, 1030, 990, 990]);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.currentHand.wall).toHaveLength(wallLength - 1);
    expect(match.currentHand.players[1]!.melds).toContainEqual(
      expect.objectContaining({ type: 'an-gang' }),
    );
    expect(match.currentHand.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wind-east-2',
      source: 'an-gang-tail',
    });
    expect(declaration(match.currentHand).winningTileFaces).toEqual(snapshot);
    expect(
      applyGameActionToMatch(match, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: wan9,
      }),
    ).toBe(match);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-1' })).toBe(
      match,
    );
    expect(applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-2' })).not.toBe(
      match,
    );
    hook.mockRestore();
  });

  it('rejects a wait-changing AnGang and an empty-wall AnGang transactionally', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');
    let match = declaredMatch(changingWan2TripletIds, {
      playerZeroIds: ['wind-south-1'],
      headDraws: ['wan-2-4'],
    });
    match = advanceDealerDiscardToPlayerOneDraw(match, 'wind-south-1');
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(getAvailableAnGangs(match.currentHand, 1)).toEqual([]);
    const action = { type: 'DECLARE_AN_GANG', playerIndex: 1, tileFace: wan2 } as const;
    expect(applyGameActionToMatch(match, action)).toBe(match);
    expect(applyGameActionToMatch(match, action)).toBe(match);

    const preserving = declaredMatch(eastWaitWithWan9TripletIds, {
      playerZeroIds: ['wind-south-1'],
      headDraws: ['wan-9-4'],
    });
    let empty = advanceDealerDiscardToPlayerOneDraw(preserving, 'wind-south-1');
    empty = applyGameActionToMatch(empty, { type: 'DRAW_TILE' });
    empty = { ...empty, currentHand: { ...empty.currentHand, wall: [] } };
    expect(getAvailableAnGangs(empty.currentHand, 1)).toEqual([]);
    expect(
      applyGameActionToMatch(empty, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: wan9,
      }),
    ).toBe(empty);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });
});

describe('declared Di Hu BuGang defenses', () => {
  it('blocks the normal public entry on a real declaration carrying an old Peng fixture', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const match = declaredMatch(eastWaitIds);
    const meld = {
      id: 'meld-old',
      type: 'peng' as const,
      tiles: ordinaryTiles(['wan-7-1', 'wan-7-2', 'wan-7-3']),
      claimedTileId: 'wan-7-3' as const,
      fromPlayerIndex: 0,
    };
    const fourth = ordinary('wan-7-4');
    const fixture: MatchState = {
      ...match,
      currentHand: {
        ...match.currentHand,
        currentPlayerIndex: 1,
        turnStage: 'waiting-for-discard',
        pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
        players: match.currentHand.players.map((player, index) =>
          index === 1
            ? {
                ...player,
                hand: [...player.hand, fourth],
                melds: [meld],
                buGangDrawProvenance: [{ targetMeldId: meld.id, tileId: fourth.id }],
              }
            : player,
        ),
        selfDrawProvenance: { playerIndex: 1, tileId: fourth.id, source: 'wall-head' },
      },
    };
    expect(getAvailableBuGangs(fixture.currentHand, 1)).toEqual([]);
    expect(
      applyGameActionToMatch(fixture, {
        type: 'DECLARE_BU_GANG',
        playerIndex: 1,
        meldId: meld.id,
      }),
    ).toBe(fixture);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });
});

function realPassHuMatch(headDraws: readonly TileId[] = []): MatchState {
  let match = declaredMatch(eastWaitIds, {
    playerZeroIds: ['wind-east-2'],
    headDraws,
  });
  match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
  expect(available(match.currentHand, 1)?.responseTypes).toContain('hu');
  const beforeHand = match.currentHand.players[1]!.hand;
  const beforeWall = match.currentHand.wall;
  match = applyGameActionToMatch(match, {
    type: 'SUBMIT_REACTION',
    playerIndex: 1,
    responseType: 'pass',
  });
  expect(match.currentHand.players[1]!.hand).toEqual(beforeHand);
  expect(match.currentHand.wall).toEqual(beforeWall);
  for (const responder of match.currentHand.reactionWindow?.responderOrder.slice(1) ?? []) {
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: 'pass',
    });
  }
  match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
  expect(match.currentHand.players[1]!.passHu).toBe(true);
  expect(match.currentHand.result).toBeUndefined();
  expect(match.currentHand.pendingScoringEvents).toEqual([]);
  return match;
}

describe('real declared Di Hu PassHu production chains', () => {
  it('creates PassHu through a real Hu-capable Pass and keeps the hand running', () => {
    const match = realPassHuMatch();
    expect(match.currentHand.turnStage).toBe('waiting-for-draw');
    expect(match.currentHand.currentPlayerIndex).toBe(1);
    expect(declaration(match.currentHand).winningTileFaces).toEqual([east]);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('does not block a real self draw, but an illegal discard cannot clear PassHu', () => {
    let match = realPassHuMatch(['wind-east-3']);
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(match.currentHand.players[1]!.passHu).toBe(true);
    expect(getAvailableSelfDrawHu(match.currentHand, 1)).not.toBeNull();
    const provenance = match.currentHand.selfDrawProvenance;
    expect(applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-1-1' })).toBe(match);
    expect(match.currentHand.players[1]!.passHu).toBe(true);
    expect(match.currentHand.selfDrawProvenance).toBe(provenance);
  });

  it('clears PassHu only after the declared player legally discards the exact draw', () => {
    let match = realPassHuMatch(['wind-north-1']);
    match = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    const snapshot = structuredClone(declaration(match.currentHand).winningTileFaces);
    expect(match.currentHand.players[1]!.passHu).toBe(true);
    match = applyGameActionToMatch(match, {
      type: 'DISCARD_TILE',
      tileId: 'wind-north-1',
    });
    expect(match.currentHand.players[1]!.passHu).toBe(false);
    expect(declaration(match.currentHand).winningTileFaces).toEqual(snapshot);
  });

  it('suppresses a later discard Hu and rejects a direct Hu submit before own discard', () => {
    const multiWaitIds = [
      'wan-1-1',
      'wan-2-1',
      'wan-3-1',
      'wan-4-1',
      'wan-5-1',
      'wan-6-1',
      'wan-7-1',
      'wan-8-1',
      'wan-9-1',
      'wan-2-2',
      'wan-2-3',
      'wan-3-2',
      'wan-4-2',
    ] satisfies TileId[];
    let match = declaredMatch(multiWaitIds, {
      playerZeroIds: ['wan-5-2'],
      playerTwoIds: ['wan-5-3', 'wan-5-4', 'wan-2-4'],
    });
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-5-2' });
    expect(available(match.currentHand, 1)?.responseTypes).toContain('hu');
    match = respondAndResolve(match, { 1: 'pass', 2: 'peng' });
    expect(match.currentHand.players[1]!.passHu).toBe(true);
    expect(match.currentHand.currentPlayerIndex).toBe(2);
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-2-4' });
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_REACTION',
      playerIndex: 3,
      responseType: 'pass',
    });
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_REACTION',
      playerIndex: 0,
      responseType: 'pass',
    });
    expect(available(match.currentHand, 1)?.responseTypes).not.toContain('hu');
    expect(
      applyGameActionToMatch(match, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'hu',
      }),
    ).toBe(match);
  });

  it('suppresses Rob-BuGang in a public BuGang window after a real Hu-capable Pass', () => {
    const middleGapWaitIds = [
      'tiao-4-1',
      'tiao-5-1',
      'tiao-6-1',
      'tiao-7-1',
      'tiao-8-1',
      'tiao-9-1',
      'tong-4-1',
      'tong-5-1',
      'tong-6-1',
      'wind-east-1',
      'wind-east-2',
      'wan-1-1',
      'wan-3-1',
    ] satisfies TileId[];
    let match = declaredMatch(middleGapWaitIds, {
      playerZeroIds: ['wan-2-1'],
      playerTwoIds: ['wan-2-2', 'wan-2-3', 'wan-2-4'],
    });
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
    expect(available(match.currentHand, 1)?.responseTypes).toContain('hu');
    match = respondAndResolve(match, { 1: 'pass' });
    expect(match.currentHand.players[1]!.passHu).toBe(true);

    const meld = {
      id: 'meld-old',
      type: 'peng' as const,
      tiles: ordinaryTiles(['wan-2-2', 'wan-2-3', 'wan-2-1']),
      claimedTileId: 'wan-2-1' as const,
      fromPlayerIndex: 0,
    };
    const fourth = ordinary('wan-2-4');
    match = {
      ...match,
      currentHand: {
        ...match.currentHand,
        currentPlayerIndex: 2,
        turnStage: 'waiting-for-discard',
        pendingAction: { playerIndex: 2, seat: 'west', type: 'discard' },
        reactionWindow: undefined,
        players: match.currentHand.players.map((player, index) =>
          index === 2
            ? {
                ...player,
                hand: player.hand.filter(
                  (candidate) => candidate.id !== 'wan-2-2' && candidate.id !== 'wan-2-3',
                ),
                melds: [meld],
                buGangDrawProvenance: [{ targetMeldId: meld.id, tileId: fourth.id }],
              }
            : player,
        ),
        selfDrawProvenance: { playerIndex: 2, tileId: fourth.id, source: 'wall-head' },
      },
    };
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 2,
      meldId: meld.id,
    });
    expect(match.currentHand.reactionWindow?.source).toBe('bu-gang');
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_REACTION',
      playerIndex: 3,
      responseType: 'pass',
    });
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_REACTION',
      playerIndex: 0,
      responseType: 'pass',
    });
    expect(available(match.currentHand, 1)?.responseTypes).not.toContain('hu');
    expect(
      applyGameActionToMatch(match, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'hu',
      }),
    ).toBe(match);
    expect(match.currentHand.players[1]!.passHu).toBe(true);
    expect(declaration(match.currentHand).winningTileFaces).toEqual([wan2]);
  });
});
