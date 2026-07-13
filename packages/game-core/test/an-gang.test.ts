import { describe, expect, it, vi } from 'vitest';
import {
  NANJING_OPEN_RULE_SET,
  SEATS,
  applyAction,
  applyGameActionToMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableAnGangs,
  settlePendingScoringEvents,
} from '../src';
import type {
  FlowerTile,
  GameAction,
  GameState,
  MatchState,
  OrdinaryHandTile,
  OrdinaryTileFace,
  PendingScoringEvent,
  PlayerState,
  TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

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

function player(state: GameState, playerIndex = 0): PlayerState {
  const found = state.players[playerIndex];
  if (!found) throw new Error(`Missing player ${playerIndex}`);
  return found;
}

function expectStateNoop(result: GameState, state: GameState): void {
  const currentPlayerIndex = state.currentPlayerIndex;
  expect(result).toBe(state);
  expect(result.players).toBe(state.players);
  expect(player(result, currentPlayerIndex).hand).toBe(player(state, currentPlayerIndex).hand);
  expect(player(result, currentPlayerIndex).flowers).toBe(
    player(state, currentPlayerIndex).flowers,
  );
  expect(player(result, currentPlayerIndex).melds).toBe(player(state, currentPlayerIndex).melds);
  expect(player(result, currentPlayerIndex).discardPile).toBe(
    player(state, currentPlayerIndex).discardPile,
  );
  expect(result.wall).toBe(state.wall);
  expect(result.pendingScoringEvents).toBe(state.pendingScoringEvents);
  expect(result.nextMeldSequence).toBe(state.nextMeldSequence);
  expect(result.lastDiscard).toBe(state.lastDiscard);
  expect(result.reactionWindow).toBe(state.reactionWindow);
  expect(result.currentPlayerIndex).toBe(state.currentPlayerIndex);
  expect(result.turnStage).toBe(state.turnStage);
  expect(result.pendingAction).toBe(state.pendingAction);
}

function face(category: 'number', suit: 'wan' | 'tiao' | 'tong', rank: 1 | 2): OrdinaryTileFace;
function face(category: 'wind', wind: 'east'): OrdinaryTileFace;
function face(
  category: 'number' | 'wind',
  value: 'wan' | 'tiao' | 'tong' | 'east',
  rank?: 1 | 2,
): OrdinaryTileFace {
  return category === 'number'
    ? { category, suit: value as 'wan' | 'tiao' | 'tong', rank: rank as 1 | 2 }
    : { category, wind: value as 'east' };
}

function createAnGangState(
  options: {
    hand?: readonly OrdinaryHandTile[];
    wall?: readonly (OrdinaryHandTile | FlowerTile)[];
    flowers?: readonly FlowerTile[];
    currentPlayerIndex?: number;
    turnStage?: GameState['turnStage'];
    pendingAction?: GameState['pendingAction'];
    reactionWindow?: GameState['reactionWindow'];
    pendingScoringEvents?: readonly PendingScoringEvent[];
  } = {},
): GameState {
  const base = createGame();
  const currentPlayerIndex = options.currentPlayerIndex ?? 0;
  const players = base.players.map((candidate, index) =>
    index === 0
      ? {
          ...candidate,
          hand:
            options.hand ??
            ([1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}` as TileId)) as OrdinaryHandTile[]),
          flowers: options.flowers ?? [],
        }
      : candidate,
  );
  const current = players[currentPlayerIndex];
  if (!current) throw new Error('Missing current player');
  return {
    ...base,
    players,
    wall: [...(options.wall ?? [ordinary('tong-9-1')])],
    currentPlayerIndex,
    phase: 'playing',
    turnStage: options.turnStage ?? 'waiting-for-discard',
    pendingAction:
      options.pendingAction ??
      ({ playerIndex: currentPlayerIndex, seat: current.seat, type: 'discard' } as const),
    ...(options.reactionWindow === undefined ? {} : { reactionWindow: options.reactionWindow }),
    pendingScoringEvents: options.pendingScoringEvents ?? [],
  };
}

function createReactionStart(
  claimantHand: readonly OrdinaryHandTile[],
  wall: readonly (OrdinaryHandTile | FlowerTile)[] = [ordinary('tong-9-1')],
): GameState {
  const base = createGame();
  const discardedTile = ordinary('wan-3-1');
  const players = base.players.map((candidate, index) => {
    if (index === 0) return { ...candidate, hand: [discardedTile, ordinary('tong-1-1')] };
    if (index === 1) return { ...candidate, hand: [...claimantHand] };
    return candidate;
  });

  return {
    ...base,
    players,
    wall: [...wall],
    currentPlayerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    pendingScoringEvents: [],
  };
}

function openReactionWindow(
  claimantHand: readonly OrdinaryHandTile[],
  wall?: readonly (OrdinaryHandTile | FlowerTile)[],
): GameState {
  return applyAction(createReactionStart(claimantHand, wall), {
    type: 'DISCARD_TILE',
    tileId: 'wan-3-1',
  });
}

function resolveClaimThroughPublicActions(
  responseType: 'peng' | 'ming-gang',
  claimantHand: readonly OrdinaryHandTile[],
  wall?: readonly (OrdinaryHandTile | FlowerTile)[],
): GameState {
  let state = openReactionWindow(claimantHand, wall);
  state = applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
  return applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
}

const declareWanOne = {
  type: 'DECLARE_AN_GANG',
  playerIndex: 0,
  tileFace: face('number', 'wan', 1),
} as const;

describe('AnGang availability and rule snapshots', () => {
  it('returns every available face in stable order, including the dealer first-discard stage', () => {
    const hand = [
      ...[4, 2, 1, 3].map((copy) => ordinary(`wind-east-${copy}` as TileId)),
      ...[3, 1, 4, 2].map((copy) => ordinary(`wan-2-${copy}` as TileId)),
      ...[2, 4, 1, 3].map((copy) => ordinary(`wan-1-${copy}` as TileId)),
    ];
    const state = createAnGangState({ hand });

    expect(getAvailableAnGangs(state, 0)).toEqual([
      face('number', 'wan', 1),
      face('number', 'wan', 2),
      face('wind', 'east'),
    ]);
    expect(getAvailableAnGangs(state, 0)).not.toBe(getAvailableAnGangs(state, 0));
    expect(hand.map((tile) => tile.id)).toEqual([
      'wind-east-4',
      'wind-east-2',
      'wind-east-1',
      'wind-east-3',
      'wan-2-3',
      'wan-2-1',
      'wan-2-4',
      'wan-2-2',
      'wan-1-2',
      'wan-1-4',
      'wan-1-1',
      'wan-1-3',
    ]);
  });

  it('returns no option outside a legal active turn or with corrupt duplicate entities', () => {
    const valid = createAnGangState();
    const openWindow = {
      source: 'discard' as const,
      discardedTile: ordinary('tong-1-1'),
      fromPlayerIndex: 1,
      fromSeat: 'south' as const,
      responderOrder: [],
      availableReactions: [],
      responses: [],
      status: 'open' as const,
    };
    const duplicate = ordinary('wan-1-1');
    const cases = [
      createAnGangState({ hand: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3')] }),
      createAnGangState({ wall: [] }),
      createAnGangState({
        turnStage: 'waiting-for-draw',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
      }),
      createAnGangState({ reactionWindow: openWindow }),
      createAnGangState({ hand: [duplicate, duplicate, ordinary('wan-1-2'), ordinary('wan-1-3')] }),
    ];

    expect(getAvailableAnGangs(valid, 1)).toEqual([]);
    for (const state of cases) expect(getAvailableAnGangs(state, 0)).toEqual([]);
  });

  it('creates deterministic current-rule transfers for all three payers at 10 points', () => {
    const context = { playerIndex: 2, playerCount: 4, meldId: 'meld-7' };
    const first = NANJING_OPEN_RULE_SET.getAnGangScoreTransfers(context);
    const second = NANJING_OPEN_RULE_SET.getAnGangScoreTransfers(context);

    expect(first).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 10 },
      { fromPlayerIndex: 1, toPlayerIndex: 2, amount: 10 },
      { fromPlayerIndex: 3, toPlayerIndex: 2, amount: 10 },
    ]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

describe('AnGang execution', () => {
  it('allows and executes AnGang after a real normal draw completes the fourth tile', () => {
    const waitingForDraw = createAnGangState({
      hand: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3')],
      wall: [ordinary('wan-1-4'), ordinary('tong-8-1'), ordinary('tong-9-1')],
      turnStage: 'waiting-for-draw',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
    });
    const drawn = applyAction(waitingForDraw, { type: 'DRAW_TILE' });

    expect(drawn.turnStage).toBe('waiting-for-discard');
    expect(drawn.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(drawn.reactionWindow).toBeUndefined();
    expect(player(drawn).hand.map((tile) => tile.id)).toEqual([
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-1-4',
    ]);
    expect(drawn.wall.map((tile) => tile.id)).toEqual(['tong-8-1', 'tong-9-1']);
    expect(getAvailableAnGangs(drawn, 0)).toEqual([face('number', 'wan', 1)]);

    const result = applyAction(drawn, declareWanOne);
    expect(player(result).melds[0]?.type).toBe('an-gang');
    expect(player(result).hand.map((tile) => tile.id)).toEqual(['tong-9-1']);
    expect(result.wall.map((tile) => tile.id)).toEqual(['tong-8-1']);
  });

  it('creates an an-gang meld, snapshots scoring, and draws one ordinary tile from the tail', () => {
    const retained = ordinary('tiao-5-1');
    const state = createAnGangState({
      hand: [retained, ...[4, 2, 1, 3].map((copy) => ordinary(`wan-1-${copy}` as TileId))],
      wall: [ordinary('tong-8-1'), ordinary('tong-9-1')],
    });
    const result = applyAction(state, declareWanOne);
    const meld = player(result).melds[0];

    expect(result).not.toBe(state);
    expect(player(result).hand.map((tile) => tile.id)).toEqual(['tiao-5-1', 'tong-9-1']);
    expect(meld).toEqual({
      id: 'meld-1',
      type: 'an-gang',
      tiles: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3'), ordinary('wan-1-4')],
    });
    expect(new Set(meld?.tiles.map((tile) => tile.id)).size).toBe(4);
    expect(meld).not.toHaveProperty('claimedTileId');
    expect(meld).not.toHaveProperty('fromPlayerIndex');
    expect(result.wall.map((tile) => tile.id)).toEqual(['tong-8-1']);
    expect(result.nextMeldSequence).toBe(2);
    expect(result.currentPlayerIndex).toBe(0);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(result.reactionWindow).toBeUndefined();
    expect(result.pendingScoringEvents).toEqual([
      {
        type: 'an-gang-created',
        playerIndex: 0,
        meldId: 'meld-1',
        transfers: [
          { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 },
          { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 10 },
          { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 10 },
        ],
        status: 'pending',
      },
    ]);
    expect(result.handProgressFacts.successfulAnGangCount).toBe(1);
    expect(player(result).discardPile).toBe(player(state).discardPile);
    expect(result.lastDiscard).toBe(state.lastDiscard);
  });

  it('keeps historical events first and appends AnGang before ordered tail flower-kong events', () => {
    const historical: PendingScoringEvent = {
      type: 'flower-kong-created',
      playerIndex: 1,
      seat: 'south',
      kind: 'fortune',
      createdDuring: 'runtime-flower-replacement',
      transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 }],
      status: 'pending',
    };
    const state = createAnGangState({
      flowers: [
        flower('flower-red-center-1'),
        flower('flower-red-center-2'),
        flower('flower-red-center-3'),
        flower('flower-plum-1'),
        flower('flower-orchid-1'),
        flower('flower-bamboo-1'),
      ],
      wall: [ordinary('tong-8-1'), flower('flower-chrysanthemum-1'), flower('flower-red-center-4')],
      pendingScoringEvents: [historical],
    });
    const result = applyAction(state, declareWanOne);

    expect(player(result).flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-red-center-2',
      'flower-red-center-3',
      'flower-plum-1',
      'flower-orchid-1',
      'flower-bamboo-1',
      'flower-red-center-4',
      'flower-chrysanthemum-1',
    ]);
    expect(player(result).hand.map((tile) => tile.id)).toEqual(['tong-8-1']);
    expect(result.wall).toEqual([]);
    expect(result.pendingScoringEvents.map((event) => event.type)).toEqual([
      'flower-kong-created',
      'an-gang-created',
      'flower-kong-created',
      'flower-kong-created',
    ]);
    expect(result.pendingScoringEvents[2]).toMatchObject({ kind: 'red-center' });
    expect(result.pendingScoringEvents[3]).toMatchObject({
      kind: 'plum-orchid-bamboo-chrysanthemum',
    });
  });

  it('keeps an earlier tail flower-kong when a later terminal flower event is suppressed', () => {
    const state = createAnGangState({
      flowers: [
        flower('flower-red-center-1'),
        flower('flower-red-center-2'),
        flower('flower-red-center-3'),
        flower('flower-plum-1'),
        flower('flower-orchid-1'),
        flower('flower-bamboo-1'),
      ],
      wall: [flower('flower-chrysanthemum-1'), flower('flower-red-center-4')],
    });
    const result = applyAction(state, declareWanOne);

    expect(result.phase).toBe('ended');
    expect(result.pendingScoringEvents.map((event) => event.type)).toEqual([
      'an-gang-created',
      'flower-kong-created',
    ]);
    expect(result.pendingScoringEvents[1]).toMatchObject({ kind: 'red-center' });
  });

  it('keeps the AnGang but suppresses a flower-kong created by the final terminal flower', () => {
    const state = createAnGangState({
      flowers: [
        flower('flower-red-center-1'),
        flower('flower-red-center-2'),
        flower('flower-red-center-3'),
      ],
      wall: [flower('flower-red-center-4')],
    });
    const result = applyAction(state, declareWanOne);

    expect(player(result).melds[0]?.type).toBe('an-gang');
    expect(player(result).flowers.map((tile) => tile.id)).toContain('flower-red-center-4');
    expect(result.phase).toBe('ended');
    expect(result.turnStage).toBe('hand-ended');
    expect(result.pendingAction.type).toBe('none');
    expect(result.pendingScoringEvents.map((event) => event.type)).toEqual(['an-gang-created']);
  });

  it('keeps waiting for discard when the tail ordinary tile is the last wall tile', () => {
    const result = applyAction(createAnGangState({ wall: [ordinary('tong-9-1')] }), declareWanOne);
    expect(result.wall).toEqual([]);
    expect(result.phase).toBe('playing');
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(player(result).hand.map((tile) => tile.id)).toEqual(['tong-9-1']);
  });

  it('returns the original reference for illegal declarations without changing any field', () => {
    const duplicate = ordinary('wan-1-1');
    const base = createAnGangState();
    const illegal: readonly [GameState, GameAction][] = [
      [createAnGangState({ wall: [] }), declareWanOne],
      [
        createAnGangState({
          hand: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3')],
        }),
        declareWanOne,
      ],
      [
        createAnGangState({
          hand: [duplicate, duplicate, ordinary('wan-1-2'), ordinary('wan-1-3')],
        }),
        declareWanOne,
      ],
      [
        createAnGangState({
          turnStage: 'waiting-for-draw',
          pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
        }),
        declareWanOne,
      ],
      [base, { ...declareWanOne, playerIndex: 1 }],
      [base, { ...declareWanOne, playerIndex: 4 }],
      [base, { ...declareWanOne, tileFace: face('number', 'tiao', 1) }],
      [base, { ...declareWanOne, tileFace: { category: 'flower' } } as unknown as GameAction],
      [base, { type: 'DECLARE_AN_GANG', playerIndex: 0 } as unknown as GameAction],
      [
        {
          ...base,
          players: [{ ...player(base), hand: [null] }, ...base.players.slice(1)],
        } as unknown as GameState,
        declareWanOne,
      ],
    ];

    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');
    for (const [state, action] of illegal) expectStateNoop(applyAction(state, action), state);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('does not borrow matching tiles from a Peng meld or the discard pile', () => {
    const state = createAnGangState({ hand: [ordinary('wan-1-4')] });
    const players = state.players.map((candidate, index) =>
      index === 0
        ? {
            ...candidate,
            melds: [
              {
                id: 'meld-peng',
                type: 'peng' as const,
                tiles: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3')],
                claimedTileId: 'wan-1-3' as const,
                fromPlayerIndex: 1,
              },
            ],
            discardPile: [
              { tile: ordinary('wan-1-1') },
              { tile: ordinary('wan-1-2') },
              { tile: ordinary('wan-1-3') },
              { tile: ordinary('wan-1-4') },
            ],
          }
        : candidate,
    );
    const withPublicTiles = { ...state, players };

    expect(getAvailableAnGangs(withPublicTiles, 0)).toEqual([]);
    expect(applyAction(withPublicTiles, declareWanOne)).toBe(withPublicTiles);
  });

  it('rejects AnGang after a Peng produced by the complete public reaction action chain', () => {
    const claimantHand = [
      ordinary('wan-3-2'),
      ordinary('wan-3-3'),
      ordinary('tiao-1-1'),
      ordinary('tiao-1-2'),
      ordinary('tiao-1-3'),
      ordinary('tiao-1-4'),
    ];
    const afterPeng = resolveClaimThroughPublicActions('peng', claimantHand, [
      ordinary('tong-8-1'),
      ordinary('tong-9-1'),
    ]);
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');

    expect(player(afterPeng, 1).melds[0]).toMatchObject({
      id: 'meld-1',
      type: 'peng',
      claimedTileId: 'wan-3-1',
      fromPlayerIndex: 0,
    });
    expect(player(afterPeng, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(afterPeng.currentPlayerIndex).toBe(1);
    expect(afterPeng.turnStage).toBe('waiting-for-discard');
    expect(afterPeng.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(afterPeng.reactionWindow?.status).toBe('closed');
    expect(afterPeng.reactionWindow?.responses).toContainEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'peng',
    });
    expect(player(afterPeng, 1).hand.map((tile) => tile.id)).toEqual([
      'tiao-1-1',
      'tiao-1-2',
      'tiao-1-3',
      'tiao-1-4',
    ]);
    expect(getAvailableAnGangs(afterPeng, 1)).toEqual([]);

    const action = {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: face('number', 'tiao', 1),
    } as const;
    expectStateNoop(applyAction(afterPeng, action), afterPeng);
    expect(player(afterPeng, 1).melds).toHaveLength(1);
    expect(afterPeng.wall.map((tile) => tile.id)).toEqual(['tong-8-1', 'tong-9-1']);
    expect(afterPeng.pendingScoringEvents).toEqual([]);
    expect(afterPeng.nextMeldSequence).toBe(2);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('allows AnGang after a MingGang produced by the complete public reaction action chain', () => {
    const claimantHand = [
      ordinary('wan-3-2'),
      ordinary('wan-3-3'),
      ordinary('wan-3-4'),
      ordinary('tiao-1-1'),
      ordinary('tiao-1-2'),
      ordinary('tiao-1-3'),
      ordinary('tiao-1-4'),
    ];
    const afterMingGang = resolveClaimThroughPublicActions('ming-gang', claimantHand, [
      ordinary('tong-8-1'),
      ordinary('tong-9-1'),
    ]);

    expect(player(afterMingGang, 1).melds[0]).toMatchObject({
      id: 'meld-1',
      type: 'ming-gang',
      claimedTileId: 'wan-3-1',
      fromPlayerIndex: 0,
    });
    expect(player(afterMingGang, 1).hand.map((tile) => tile.id)).toEqual([
      'tiao-1-1',
      'tiao-1-2',
      'tiao-1-3',
      'tiao-1-4',
      'tong-9-1',
    ]);
    expect(afterMingGang.wall.map((tile) => tile.id)).toEqual(['tong-8-1']);
    expect(afterMingGang.currentPlayerIndex).toBe(1);
    expect(afterMingGang.turnStage).toBe('waiting-for-discard');
    expect(afterMingGang.reactionWindow?.status).toBe('closed');
    expect(afterMingGang.reactionWindow?.responses).toContainEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'ming-gang',
    });
    expect(getAvailableAnGangs(afterMingGang, 1)).toEqual([face('number', 'tiao', 1)]);

    const result = applyAction(afterMingGang, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: face('number', 'tiao', 1),
    });
    expect(player(result, 1).melds.map((meld) => [meld.id, meld.type])).toEqual([
      ['meld-1', 'ming-gang'],
      ['meld-2', 'an-gang'],
    ]);
    expect(result.nextMeldSequence).toBe(3);
    expect(result.wall).toEqual([]);
    expect(player(result, 1).hand.map((tile) => tile.id)).toEqual(['tong-9-1', 'tong-8-1']);
    expect(result.pendingScoringEvents.map((event) => event.type)).toEqual([
      'ming-gang-created',
      'an-gang-created',
    ]);
  });

  it('executes two consecutive real AnGang actions and settles each exactly once through Match', () => {
    const hand = [
      ...[1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}` as TileId)),
      ...[1, 2, 3, 4].map((copy) => ordinary(`tiao-1-${copy}` as TileId)),
    ];
    const initialHand = createAnGangState({
      hand,
      wall: [ordinary('tong-8-1'), ordinary('tong-9-1')],
    });
    const first = applyAction(initialHand, declareWanOne);
    expect(getAvailableAnGangs(first, 0)).toEqual([face('number', 'tiao', 1)]);
    const second = applyAction(first, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: face('number', 'tiao', 1),
    });

    expect(player(second).melds.map((meld) => [meld.id, meld.type])).toEqual([
      ['meld-1', 'an-gang'],
      ['meld-2', 'an-gang'],
    ]);
    expect(second.nextMeldSequence).toBe(3);
    expect(player(first).hand.map((tile) => tile.id)).toEqual([
      'tiao-1-1',
      'tiao-1-2',
      'tiao-1-3',
      'tiao-1-4',
      'tong-9-1',
    ]);
    expect(player(second).hand.map((tile) => tile.id)).toEqual(['tong-9-1', 'tong-8-1']);
    expect(first.wall.map((tile) => tile.id)).toEqual(['tong-8-1']);
    expect(second.wall).toEqual([]);
    expect(second.currentPlayerIndex).toBe(0);
    expect(second.turnStage).toBe('waiting-for-discard');
    expect(
      second.pendingScoringEvents.map((event) => [
        event.type,
        'meldId' in event ? event.meldId : undefined,
      ]),
    ).toEqual([
      ['an-gang-created', 'meld-1'],
      ['an-gang-created', 'meld-2'],
    ]);

    const match = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: initialHand,
    } as MatchState;
    const afterFirstSettlement = applyGameActionToMatch(match, declareWanOne);
    const afterSecondSettlement = applyGameActionToMatch(afterFirstSettlement, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: face('number', 'tiao', 1),
    });
    expect(afterFirstSettlement.cumulativeScores).toEqual([1030, 990, 990, 990]);
    expect(afterSecondSettlement.cumulativeScores).toEqual([1060, 980, 980, 980]);
    expect(afterSecondSettlement.currentHand.pendingScoringEvents).toEqual([]);
    expect(settlePendingScoringEvents(afterSecondSettlement)).toBe(afterSecondSettlement);
  });

  it('rejects AnGang during a reaction window opened by a real discard', () => {
    const open = openReactionWindow([
      ordinary('wan-3-2'),
      ordinary('wan-3-3'),
      ordinary('tiao-1-1'),
      ordinary('tiao-1-2'),
      ordinary('tiao-1-3'),
      ordinary('tiao-1-4'),
    ]);
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');

    expect(open.turnStage).toBe('waiting-for-reaction');
    expect(open.reactionWindow?.status).toBe('open');
    expect(open.currentPlayerIndex).toBe(1);
    expect(getAvailableAnGangs(open, 1)).toEqual([]);
    const action = {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: face('number', 'tiao', 1),
    } as const;
    expectStateNoop(applyAction(open, action), open);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('rejects negative, out-of-range, fractional, NaN, and infinite player indexes', () => {
    const state = createAnGangState();
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');

    for (const playerIndex of [
      -1,
      state.players.length,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(getAvailableAnGangs(state, playerIndex)).toEqual([]);
      const action: GameAction = { ...declareWanOne, playerIndex };
      expectStateNoop(applyAction(state, action), state);
    }
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('rejects flower faces and corrupt flower tiles in the concealed hand', () => {
    const flowers = [
      flower('flower-red-center-1'),
      flower('flower-red-center-2'),
      flower('flower-red-center-3'),
      flower('flower-red-center-4'),
    ];
    const state = createAnGangState({
      hand: [ordinary('wan-1-1'), ordinary('wan-1-2'), ordinary('wan-1-3')],
      flowers,
    });
    const flowerAction = {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'flower', flower: 'red-center' },
    } as unknown as GameAction;
    const corrupt = {
      ...state,
      players: [{ ...player(state), hand: flowers }, ...state.players.slice(1)],
    } as unknown as GameState;
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');

    expect(getAvailableAnGangs(state, 0)).toEqual([]);
    expectStateNoop(applyAction(state, flowerAction), state);
    expect(getAvailableAnGangs(corrupt, 0)).toEqual([]);
    expectStateNoop(applyAction(corrupt, declareWanOne), corrupt);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('calls the RuleSet hook once and stores a defensive transfer snapshot', () => {
    const returned = [
      { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 },
      { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 10 },
      { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 10 },
    ];
    const hook = vi
      .spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers')
      .mockReturnValue(returned);
    const result = applyAction(createAnGangState(), declareWanOne);
    const event = result.pendingScoringEvents[0];

    expect(hook).toHaveBeenCalledTimes(1);
    expect(event?.transfers).toEqual(returned);
    expect(event?.transfers).not.toBe(returned);
    expect(event?.transfers[0]).not.toBe(returned[0]);
    hook.mockRestore();
  });
});

describe('AnGang settlement', () => {
  it('settles a real declaration immediately through Match and does not settle twice', () => {
    const match = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: createAnGangState(),
      cumulativeScores: [0, 0, 0, 0],
    } as MatchState;
    const result = applyGameActionToMatch(match, declareWanOne);

    expect(result.cumulativeScores).toEqual([30, -10, -10, -10]);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
    expect(player(result.currentHand).melds[0]?.type).toBe('an-gang');
    expect(settlePendingScoringEvents(result)).toBe(result);
  });

  it('settles arbitrary valid AnGang transfer snapshots without hard-coded amounts', () => {
    const state = createAnGangState({
      pendingScoringEvents: [
        {
          type: 'an-gang-created',
          playerIndex: 2,
          meldId: 'meld-synthetic',
          status: 'pending',
          transfers: [
            { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 10 },
            { fromPlayerIndex: 1, toPlayerIndex: 2, amount: 20 },
            { fromPlayerIndex: 3, toPlayerIndex: 2, amount: 7 },
          ],
        },
      ],
    });
    const match = { ...createMatch(), currentHand: state } as MatchState;

    expect(settlePendingScoringEvents(match).cumulativeScores).toEqual([990, 980, 1037, 993]);
  });

  it('settles AnGang and earlier tail flower-kongs even when a later terminal flower ends the hand', () => {
    const hand = createAnGangState({
      flowers: [
        flower('flower-red-center-1'),
        flower('flower-red-center-2'),
        flower('flower-red-center-3'),
        flower('flower-plum-1'),
        flower('flower-orchid-1'),
        flower('flower-bamboo-1'),
      ],
      wall: [flower('flower-chrysanthemum-1'), flower('flower-red-center-4')],
    });
    const match = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: hand,
    } as MatchState;
    const result = applyGameActionToMatch(match, declareWanOne);

    expect(result.currentHand.phase).toBe('ended');
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
    expect(result.cumulativeScores).toEqual([1090, 970, 970, 970]);
    expect(result.cumulativeScores.reduce((total, score) => total + score, 0)).toBe(4000);
  });

  it('rejects the whole batch when a later AnGang transfer is corrupt', () => {
    const valid: PendingScoringEvent = {
      type: 'an-gang-created',
      playerIndex: 0,
      meldId: 'meld-valid',
      status: 'pending',
      transfers: [{ fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 }],
    };
    const corrupt = {
      type: 'an-gang-created',
      playerIndex: 0,
      meldId: 'meld-corrupt',
      status: 'pending',
      transfers: [{ fromPlayerIndex: 2, toPlayerIndex: 0, amount: 0 }],
    } as unknown as PendingScoringEvent;
    const match = {
      ...createMatch(),
      currentHand: createAnGangState({ pendingScoringEvents: [valid, corrupt] }),
    } as MatchState;

    expect(() => settlePendingScoringEvents(match)).toThrow('Scoring settlement invariant failed');
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toHaveLength(2);
  });

  it.each([
    ['bad player', { playerIndex: 4 }],
    ['blank meld', { meldId: '   ' }],
    ['empty transfers', { transfers: [] }],
    ['bad status', { status: 'settled' }],
  ])('rejects an invalid AnGang event transactionally: %s', (_name, replacement) => {
    const event = {
      type: 'an-gang-created',
      playerIndex: 0,
      meldId: 'meld-1',
      status: 'pending',
      transfers: [{ fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 }],
      ...replacement,
    } as unknown as PendingScoringEvent;
    const state = createAnGangState({ pendingScoringEvents: [event] });
    const match = { ...createMatch(), currentHand: state } as MatchState;

    expect(() => settlePendingScoringEvents(match)).toThrow('Scoring settlement invariant failed');
    expect(match.cumulativeScores).toEqual(SEATS.map(() => 1000));
    expect(match.currentHand.pendingScoringEvents).toHaveLength(1);
  });
});
