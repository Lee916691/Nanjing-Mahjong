import { describe, expect, it, vi } from 'vitest';

import {
  NANJING_OPEN_RULE_SET,
  applyAction,
  applyGameActionToMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  completeCurrentHand,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  prepareNextHand,
  settlePendingScoringEvents,
  startCurrentHand,
  startGame,
  type GameState,
  type MatchState,
  type OrdinaryHandTile,
  type FlowerTile,
  type PendingScoringEvent,
  type Tile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function passInitialDiHuDecisions(initial: GameState): GameState {
  let state = initial;
  while (state.diHuDeclarations?.status === 'collecting') {
    const playerIndex = state.diHuDeclarations.pendingPlayerIndices[0];
    if (playerIndex === undefined) throw new Error('Missing Di Hu decision player');
    state = applyAction(state, { type: 'SUBMIT_DI_HU_DECISION', playerIndex, decision: 'pass' });
  }
  return state;
}

function ordinary(id: TileId): OrdinaryHandTile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value || value.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return value;
}

function flower(id: TileId): FlowerTile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value || value.category !== 'flower') throw new Error(`Missing flower tile ${id}`);
  return value;
}

const standardWait = [
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

const winningTileId = 'wind-east-2' satisfies TileId;

function waitingForDrawState(wall: readonly Tile[] = [ordinary(winningTileId)]): GameState {
  const base = createGame();
  return {
    ...base,
    players: base.players.map((player, index) =>
      index === 0 ? { ...player, hand: standardWait.map(ordinary) } : player,
    ),
    wall: [...wall],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-draw',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'draw' },
  };
}

function initialTianHuState(): GameState {
  const used = new Set<TileId>([...standardWait, winningTileId]);
  const fillers = deck.filter(
    (tile): tile is OrdinaryHandTile => tile.category !== 'flower' && !used.has(tile.id),
  );
  const first53: Tile[] = [];
  let fillerIndex = 0;
  for (let index = 0; index < 53; index += 1) {
    const dealerDraw = index % 4 === 0 ? standardWait[index / 4] : undefined;
    if (dealerDraw) first53.push(ordinary(dealerDraw));
    else if (index === 52) first53.push(ordinary(winningTileId));
    else first53.push(fillers[fillerIndex++]!);
  }
  const selected = new Set(first53.map((tile) => tile.id));
  const ready = createGame();
  return passInitialDiHuDecisions(
    startGame({
      ...ready,
      wall: [...first53, ...deck.filter((tile) => !selected.has(tile.id))],
    }),
  );
}

function initialFlowerTianHuState(): GameState {
  const initialFlower = flower('season-spring-1');
  const used = new Set<TileId>([...standardWait, winningTileId, initialFlower.id]);
  const fillers = deck.filter(
    (tile): tile is OrdinaryHandTile => tile.category !== 'flower' && !used.has(tile.id),
  );
  const first53: Tile[] = [];
  let fillerIndex = 0;
  for (let index = 0; index < 53; index += 1) {
    const dealerDraw = index % 4 === 0 ? standardWait[index / 4] : undefined;
    if (dealerDraw) first53.push(ordinary(dealerDraw));
    else if (index === 52) first53.push(initialFlower);
    else first53.push(fillers[fillerIndex++]!);
  }
  const selected = new Set(first53.map((tile) => tile.id));
  const middle = deck.filter((tile) => !selected.has(tile.id) && tile.id !== winningTileId);
  return passInitialDiHuDecisions(
    startGame({ ...createGame(), wall: [...first53, ...middle, ordinary(winningTileId)] }),
  );
}

function anGangSelfDrawState(): GameState {
  const base = createGame();
  const concealed = [
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
    'wan-9-4',
  ] satisfies TileId[];
  return {
    ...base,
    players: base.players.map((player, index) =>
      index === 0 ? { ...player, hand: concealed.map(ordinary) } : player,
    ),
    wall: [ordinary(winningTileId)],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

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

function submitReactions(
  state: GameState,
  responses: Readonly<Record<number, 'pass' | 'hu' | 'peng' | 'ming-gang'>>,
): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responses[responder.playerIndex] ?? 'pass',
    });
  }
  return next;
}

function discardAndAllPass(state: GameState, tileId: string): GameState {
  const opened = applyAction(state, { type: 'DISCARD_TILE', tileId });
  return applyAction(submitReactions(opened, {}), { type: 'RESOLVE_REACTION_WINDOW' });
}

function directMingGangTailState(): GameState {
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
    wall: [ordinary(winningTileId)],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  const opened = applyAction(beforeDiscard, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
  return applyAction(submitReactions(opened, { 1: 'ming-gang' }), {
    type: 'RESOLVE_REACTION_WINDOW',
  });
}

function directBuGangTailTrace(): {
  readonly afterPeng: GameState;
  readonly drawnFourth: GameState;
  readonly declared: GameState;
  readonly finalized: GameState;
} {
  const base = createGame();
  let state: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-9-1')]
          : index === 1
            ? [...oneMeldWait, 'wan-9-2', 'wan-9-3', 'tiao-9-1'].map((id) => ordinary(id as TileId))
            : [],
    })),
    wall: [
      ordinary('tiao-8-1'),
      ordinary('tong-8-1'),
      ordinary('wan-8-1'),
      ordinary('wan-9-4'),
      ordinary(winningTileId),
    ],
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
  state = applyAction(submitReactions(state, { 1: 'peng' }), {
    type: 'RESOLVE_REACTION_WINDOW',
  });
  const afterPeng = state;
  state = discardAndAllPass(state, 'tiao-9-1');
  for (const tileId of ['tiao-8-1', 'tong-8-1', 'wan-8-1'] as const) {
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = discardAndAllPass(state, tileId);
  }
  state = applyAction(state, { type: 'DRAW_TILE' });
  const drawnFourth = state;
  const targetMeldId = getAvailableBuGangs(state, 1)[0]?.targetMeldId;
  if (!targetMeldId) throw new Error('Missing real BuGang candidate');
  state = applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: targetMeldId });
  const declared = state;
  return {
    afterPeng,
    drawnFourth,
    declared,
    finalized: applyAction(submitReactions(state, {}), { type: 'RESOLVE_REACTION_WINDOW' }),
  };
}

function customInitialWall(
  dealerTileIds: readonly TileId[],
  overrides: Readonly<Record<number, TileId>>,
  tail: readonly Tile[],
): Tile[] {
  if (dealerTileIds.length !== 14) throw new Error('Dealer must receive 14 initial entities');
  const reserved = new Set<TileId>([
    ...dealerTileIds,
    ...Object.values(overrides),
    ...tail.map((tile) => tile.id),
  ]);
  const fillers = deck.filter(
    (tile): tile is OrdinaryHandTile => tile.category !== 'flower' && !reserved.has(tile.id),
  );
  const first53: Tile[] = [];
  let dealerOffset = 0;
  let fillerOffset = 0;
  for (let index = 0; index < 53; index += 1) {
    const override = overrides[index];
    if (override) first53.push(deck.find((tile) => tile.id === override)!);
    else if (index % 4 === 0) {
      const dealerTileId = dealerTileIds[dealerOffset++];
      const tile = deck.find((candidate) => candidate.id === dealerTileId);
      if (!tile) throw new Error('Missing dealer tile');
      first53.push(tile);
    } else first53.push(fillers[fillerOffset++]!);
  }
  const selected = new Set([...first53, ...tail].map((tile) => tile.id));
  return [...first53, ...deck.filter((tile) => !selected.has(tile.id)), ...tail];
}

function initialDealerAnGangState(): GameState {
  const dealerTiles = [
    ...oneMeldWait,
    'wan-9-1',
    'wan-9-2',
    'wan-9-3',
    'wan-9-4',
  ] satisfies TileId[];
  return passInitialDiHuDecisions(
    startGame({
      ...createGame(),
      wall: customInitialWall(dealerTiles, {}, [ordinary(winningTileId)]),
    }),
  );
}

describe('current-reachable self-draw Hu flow', () => {
  it('keeps the final ordinary wall tile playable and exposes its exact entity', () => {
    const drawn = applyAction(waitingForDrawState(), { type: 'DRAW_TILE' });

    expect(drawn.wall).toEqual([]);
    expect(drawn.phase).toBe('playing');
    expect(drawn.turnStage).toBe('waiting-for-discard');
    expect(drawn.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'wall-head',
    });
    expect(getAvailableSelfDrawHu(drawn, 0)).toMatchObject({
      playerIndex: 0,
      winningTile: { id: winningTileId },
      drawSource: 'wall-head',
    });
  });

  it('allows discarding the final ordinary draw, opens reactions, then ends after all pass', () => {
    let state = applyAction(waitingForDrawState(), { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: winningTileId });
    expect(state.phase).toBe('playing');
    expect(state.reactionWindow?.source).toBe('discard');
    expect(state.selfDrawProvenance).toBeUndefined();
    for (const responder of state.reactionWindow?.responderOrder ?? []) {
      state = applyAction(state, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
    }
    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(state.phase).toBe('ended');
    expect(state.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
  });

  it('settles a real gang event before the final-discard all-pass draw and never resolves twice', () => {
    const afterGang = applyAction(anGangSelfDrawState(), {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: afterGang,
    };
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: winningTileId });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(match.currentHand.phase).toBe('ended');
    expect(match.currentHand.turnStage).toBe('hand-ended');
    expect(match.currentHand.pendingAction.type).toBe('none');
    expect(match.currentHand.reactionWindow?.status).toBe('closed');
    expect(match.currentHand.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.cumulativeScores).toEqual([1030, 990, 990, 990]);
    expect(match.currentHand.turnStage).not.toBe('waiting-for-draw');
    const repeated = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(repeated).toBe(match);
    expect(repeated.cumulativeScores).toEqual([1030, 990, 990, 990]);
    expect(repeated.currentHand.result).toBe(match.currentHand.result);
  });

  it('does not offer or record MingGang after the final ordinary draw empties the wall', () => {
    const base = waitingForDrawState([ordinary('tong-6-1')]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand:
          index === 0
            ? standardWait.map(ordinary)
            : index === 1
              ? ['tong-6-2', 'tong-6-3', 'tong-6-4'].map((id) => ordinary(id as TileId))
              : [],
      })),
    };
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-6-1' });
    const before = state;

    expect(state.wall).toEqual([]);
    expect(state.reactionWindow?.availableReactions[0]?.responseTypes).toEqual(['pass', 'peng']);
    expect(
      applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(state);
    expect(state.reactionWindow?.responses).toEqual([]);
    expect(state.players[1]?.melds).toEqual([]);
    expect(state.pendingScoringEvents).toEqual(before.pendingScoringEvents);
    expect(state.nextMeldSequence).toBe(before.nextMeldSequence);
    const staleAvailability = {
      ...state,
      reactionWindow: {
        ...state.reactionWindow!,
        availableReactions: state.reactionWindow!.availableReactions.map((availability, index) =>
          index === 0
            ? {
                ...availability,
                responseTypes: [...availability.responseTypes, 'ming-gang' as const],
              }
            : availability,
        ),
      },
    };
    expect(
      applyAction(staleAvailability, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(staleAvailability);
  });

  it('recovers a corrupt awaiting MingGang on an empty wall as all-pass draw', () => {
    let state = applyAction(waitingForDrawState([ordinary('tong-6-1')]), { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-6-1' });
    for (const responder of state.reactionWindow?.responderOrder ?? []) {
      state = applyAction(state, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
    }
    const corrupt = {
      ...state,
      reactionWindow: {
        ...state.reactionWindow!,
        responses: state.reactionWindow!.responses.map((response, index) =>
          index === 0 ? { ...response, type: 'ming-gang' as const } : response,
        ),
      },
    };

    const resolved = applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(resolved).not.toBe(corrupt);
    expect(resolved.phase).toBe('ended');
    expect(resolved.reactionWindow?.status).toBe('closed');
    expect(resolved.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(resolved.players.every((player) => player.melds.length === 0)).toBe(true);
    expect(resolved.pendingScoringEvents).toEqual([]);
  });

  it('ignores corrupt empty-wall MingGang while preserving a legal Hu response', () => {
    const base = waitingForDrawState([ordinary(winningTileId)]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand: index === 0 ? [] : index === 1 ? standardWait.map(ordinary) : [],
      })),
    };
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: winningTileId });
    state = submitReactions(state, { 1: 'hu' });
    const corrupt: GameState = {
      ...state,
      reactionWindow: {
        ...state.reactionWindow!,
        responses: state.reactionWindow!.responses.map((response, index) =>
          index === 1 ? { ...response, type: 'ming-gang' as const } : response,
        ),
      },
    };
    const resolved = applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(resolved.result).toMatchObject({ source: 'discard', winners: [{ playerIndex: 1 }] });
    expect(resolved.players.every((player) => player.melds.length === 0)).toBe(true);
  });

  it('ignores corrupt empty-wall MingGang while preserving a legal Peng response', () => {
    const base = waitingForDrawState([ordinary('tong-6-1')]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand:
          index === 0
            ? []
            : index === 1
              ? ['tong-6-2', 'tong-6-3', 'wan-8-1'].map((id) => ordinary(id as TileId))
              : [],
      })),
    };
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-6-1' });
    state = submitReactions(state, { 1: 'peng' });
    const corrupt: GameState = {
      ...state,
      reactionWindow: {
        ...state.reactionWindow!,
        responses: state.reactionWindow!.responses.map((response, index) =>
          index === 1 ? { ...response, type: 'ming-gang' as const } : response,
        ),
      },
    };
    const resolved = applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(resolved.players[1]?.melds[0]?.type).toBe('peng');
    expect(resolved.turnStage).toBe('waiting-for-discard');
    expect(resolved.pendingScoringEvents).toEqual([]);
  });

  it('resolves Hu on the final discard and settles it instead of drawing the hand', () => {
    const base = waitingForDrawState([ordinary(winningTileId)]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand: index === 0 ? [] : index === 1 ? standardWait.map(ordinary) : [],
      })),
    };
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: winningTileId });
    expect(state.wall).toEqual([]);
    expect(state.reactionWindow?.availableReactions[0]?.responseTypes).toContain('hu');
    const awaiting = submitReactions(state, { 1: 'hu' });
    const resolved = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'discard',
      payerPlayerIndex: 0,
      winningTile: { id: winningTileId },
      winners: [{ playerIndex: 1 }],
    });
    expect(resolved.selfDrawProvenance).toBeUndefined();
    expect(resolved.pendingScoringEvents).toHaveLength(1);
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: awaiting },
      { type: 'RESOLVE_REACTION_WINDOW' },
    );
    expect(settled.cumulativeScores).toEqual([896, 1104, 1000, 1000]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settled.currentHand.result).toEqual(resolved.result);
  });

  it('resolves Peng on the final discard, forces its discard, then ends after the next all-pass', () => {
    const base = waitingForDrawState([ordinary('tong-6-1')]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand:
          index === 0
            ? []
            : index === 1
              ? ['tong-6-2', 'tong-6-3', 'wan-8-1'].map((id) => ordinary(id as TileId))
              : [],
      })),
    };
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-6-1' });
    expect(state.reactionWindow?.availableReactions[0]?.responseTypes).toEqual(['pass', 'peng']);
    state = applyAction(submitReactions(state, { 1: 'peng' }), {
      type: 'RESOLVE_REACTION_WINDOW',
    });

    expect(state.currentPlayerIndex).toBe(1);
    expect(state.turnStage).toBe('waiting-for-discard');
    expect(state.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(getAvailableAnGangs(state, 1)).toEqual([]);
    expect(getAvailableBuGangs(state, 1)).toEqual([]);
    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
    expect(
      applyAction(state, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: { category: 'number', suit: 'wan', rank: 8 },
      }),
    ).toBe(state);
    expect(applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: 'meld-1' })).toBe(
      state,
    );
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);

    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-8-1' });
    state = applyAction(submitReactions(state, {}), { type: 'RESOLVE_REACTION_WINDOW' });
    expect(state.phase).toBe('ended');
    expect(state.turnStage).toBe('hand-ended');
    expect(state.pendingAction.type).toBe('none');
    expect(state.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
  });

  it('resolves ordinary self-draw atomically and creates one event with three transfers', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const resolved = applyAction(drawn, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });

    expect(hook).toHaveBeenCalledTimes(1);
    expect(resolved.phase).toBe('ended');
    expect(resolved.selfDrawProvenance).toBeUndefined();
    expect(resolved.result).toMatchObject({
      type: 'win',
      source: 'self-draw',
      drawSource: 'wall-head',
      winningTile: { id: winningTileId },
      winner: { playerIndex: 0 },
    });
    expect(resolved.pendingScoringEvents).toHaveLength(1);
    expect(resolved.pendingScoringEvents[0]).toMatchObject({
      type: 'hu-resolved',
      source: 'self-draw',
      winnerPlayerIndex: 0,
      drawSource: 'wall-head',
      transfers: [
        { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 104 },
        { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 104 },
        { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 104 },
      ],
    });
    expect(resolved.handProgressFacts).toMatchObject({ selfDrawCount: 1, gangKaiCount: 0 });
    expect(resolved.players[0]?.hand.map((tile) => tile.id)).toContain(winningTileId);
    expect(resolved.wall).toEqual(drawn.wall);
    hook.mockRestore();
  });

  it('settles all ordinary self-draw transfers in the same Match action', () => {
    const hand = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: hand,
    };
    const resolved = applyGameActionToMatch(match, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 0,
    });

    expect(resolved.cumulativeScores).toEqual([1312, 896, 896, 896]);
    expect(resolved.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('uses the dealer initial flow final ordinary entity for Tian Hu and fixed transfers', () => {
    const state = initialTianHuState();

    expect(state.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'initial-dealer',
    });
    expect(getAvailableSelfDrawHu(state, 0)?.evaluation.patterns).toEqual(['tian-hu']);
    const resolved = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    expect(resolved.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 1000 },
      { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 1000 },
      { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 1000 },
    ]);
  });

  it('uses the final initial replacement entity for Tian Hu without classifying Hua Kai', () => {
    const state = initialFlowerTianHuState();

    expect(state.players[0]?.flowers.map((tile) => tile.id)).toContain('season-spring-1');
    expect(state.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'initial-dealer',
    });
    expect(getAvailableSelfDrawHu(state, 0)?.evaluation).toMatchObject({
      patterns: ['tian-hu'],
      hardFlowerCount: 0,
      softFlowerCount: 0,
    });
  });

  it('keeps the dealer final ordinary entity through multi-player multi-round initial replacement', () => {
    const dealerTiles = [
      'season-spring-1',
      'flower-red-center-1',
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
    ] satisfies TileId[];
    const finalDealerTile = ordinary('wind-east-2');
    const wall = customInitialWall(dealerTiles, { 1: 'season-summer-1' }, [
      ordinary('wind-south-2'),
      finalDealerTile,
      ordinary('wind-east-1'),
      flower('season-autumn-1'),
    ]);
    const state = startGame({ ...createGame(), wall });

    expect(state.players[0]?.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'season-autumn-1',
    ]);
    expect(state.players[1]?.flowers.map((tile) => tile.id)).toEqual(['season-summer-1']);
    expect(state.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: finalDealerTile.id,
      source: 'initial-dealer',
    });
    expect(state.players[0]?.hand.filter((tile) => tile.id === finalDealerTile.id)).toHaveLength(1);
    expect(
      state.players
        .slice(1)
        .every((player) => player.hand.every((tile) => tile.id !== finalDealerTile.id)),
    ).toBe(true);
    expect(state.selfDrawProvenance?.playerIndex).toBe(0);

    const match = startCurrentHand({
      ...createMatch(),
      currentHand: { ...createGame(), wall },
    });
    expect(match.currentHand.selfDrawProvenance).toEqual(state.selfDrawProvenance);
  });

  it('consumes initial-dealer provenance on legal AnGang and legal discard', () => {
    const state = initialDealerAnGangState();
    expect(state.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: 'wan-9-4',
      source: 'initial-dealer',
    });
    expect(getAvailableAnGangs(state, 0)).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 9,
    });
    const afterGang = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'an-gang-tail',
    });
    expect(afterGang.players[0]?.hand.filter((tile) => tile.id === 'wan-9-4')).toEqual([]);

    const discarded = applyAction(initialDealerAnGangState(), {
      type: 'DISCARD_TILE',
      tileId: 'wan-9-4',
    });
    expect(discarded.selfDrawProvenance).toBeUndefined();
    expect(getAvailableSelfDrawHu(discarded, 0)).toBeNull();
  });

  it('preserves initial-dealer provenance for illegal active declarations', () => {
    const state = initialDealerAnGangState();
    const actions = [
      {
        type: 'DECLARE_AN_GANG' as const,
        playerIndex: 1,
        tileFace: { category: 'number' as const, suit: 'wan' as const, rank: 9 as const },
      },
      {
        type: 'DECLARE_AN_GANG' as const,
        playerIndex: 0,
        tileFace: { category: 'number' as const, suit: 'tong' as const, rank: 9 as const },
      },
      { type: 'DECLARE_BU_GANG' as const, playerIndex: 0, meldId: 'missing' },
      { type: 'DECLARE_SELF_DRAW_HU' as const, playerIndex: 0 },
    ];
    for (const action of actions) {
      const result = applyAction(state, action);
      expect(result).toBe(state);
      expect(result.selfDrawProvenance).toBe(state.selfDrawProvenance);
    }
  });

  it('classifies a flower replacement without a new flower-kong as Hua Kai', () => {
    const state = waitingForDrawState([
      flower('season-spring-1'),
      ordinary('wan-9-4'),
      ordinary(winningTileId),
    ]);
    const drawn = applyAction(state, { type: 'DRAW_TILE' });
    const availability = getAvailableSelfDrawHu(drawn, 0);

    expect(drawn.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    expect(availability?.evaluation.patterns).toContain('hua-kai');
    expect(availability?.evaluation.patterns).not.toContain('gang-kai');
    expect(availability?.evaluation).toMatchObject({ hardFlowerCount: 1, softFlowerCount: 1 });
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: drawn },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 },
    );
    // (10 base + 10 Men Qing + 10 Hua Kai + (1 hard + 1 single-wait soft) * 2) * 2 = 68.
    expect(settled.cumulativeScores).toEqual([1204, 932, 932, 932]);
  });

  it('classifies a replacement chain that creates a flower-kong as Gang Kai', () => {
    const base = waitingForDrawState([
      flower('flower-red-center-4'),
      ordinary('wan-9-4'),
      ordinary(winningTileId),
    ]);
    const state = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              flowers: [1, 2, 3].map((copy) => flower(`flower-red-center-${copy}` as TileId)),
            }
          : player,
      ),
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.selfDrawProvenance).toMatchObject({
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: true,
    });
    expect(drawn.pendingScoringEvents.map((event) => event.type)).toEqual(['flower-kong-created']);
    expect(getAvailableSelfDrawHu(drawn, 0)?.evaluation.patterns).toContain('gang-kai');
    expect(getAvailableSelfDrawHu(drawn, 0)?.evaluation.patterns).not.toContain('hua-kai');
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: drawn },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 },
    );
    // Flower Kong is 20; Hu is (10 + 10 Men Qing + 20 Gang Kai + (4 hard + 1 soft)*2)*2 = 100.
    expect(settled.cumulativeScores).toEqual([1360, 880, 880, 880]);
  });

  it('does not let a historical flower-kong classify a new replacement chain as Gang Kai', () => {
    const base = waitingForDrawState([
      flower('season-spring-1'),
      ordinary('wan-9-4'),
      ordinary(winningTileId),
    ]);
    const state: GameState = {
      ...base,
      pendingScoringEvents: [
        {
          type: 'flower-kong-created',
          playerIndex: 2,
          seat: 'west',
          kind: 'red-center',
          createdDuring: 'initial-deal',
          transfers: [
            { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 20 },
            { fromPlayerIndex: 1, toPlayerIndex: 2, amount: 20 },
            { fromPlayerIndex: 3, toPlayerIndex: 2, amount: 20 },
          ],
          status: 'pending',
        },
      ],
      handProgressFacts: { ...base.handProgressFacts, flowerKongCount: 1 },
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.selfDrawProvenance).toMatchObject({
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    expect(getAvailableSelfDrawHu(drawn, 0)?.evaluation.patterns).toContain('hua-kai');
    expect(getAvailableSelfDrawHu(drawn, 0)?.evaluation.patterns).not.toContain('gang-kai');
  });

  it('keeps a deduped flower-kong out of the current replacement classification', () => {
    const base = waitingForDrawState([
      flower('flower-red-center-4'),
      ordinary('wan-9-4'),
      ordinary(winningTileId),
    ]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              flowers: [1, 2, 3].map((copy) => flower(`flower-red-center-${copy}` as TileId)),
            }
          : player,
      ),
      pendingScoringEvents: [
        {
          type: 'flower-kong-created',
          playerIndex: 0,
          seat: 'east',
          kind: 'red-center',
          createdDuring: 'initial-deal',
          transfers: [
            { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 20 },
            { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 20 },
            { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 20 },
          ],
          status: 'pending',
        },
      ],
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.pendingScoringEvents).toHaveLength(1);
    expect(drawn.selfDrawProvenance).toMatchObject({
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    expect(getAvailableSelfDrawHu(drawn, 0)?.evaluation.patterns).toContain('hua-kai');
  });

  it('orders multiple new replacement flower-kongs before one Gang Kai Hu and settles the batch', () => {
    const base = waitingForDrawState([
      flower('flower-red-center-4'),
      ordinary(winningTileId),
      flower('flower-chrysanthemum-1'),
    ]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              flowers: [
                'flower-red-center-1',
                'flower-red-center-2',
                'flower-red-center-3',
                'flower-plum-1',
                'flower-orchid-1',
                'flower-bamboo-1',
              ].map((id) => flower(id as TileId)),
            }
          : player,
      ),
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.selfDrawProvenance).toMatchObject({
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: true,
    });
    expect(
      drawn.pendingScoringEvents.map((event) =>
        event.type === 'flower-kong-created' ? event.kind : event.type,
      ),
    ).toEqual(['red-center', 'plum-orchid-bamboo-chrysanthemum']);
    const resolved = applyAction(drawn, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual([
      'flower-kong-created',
      'flower-kong-created',
      'hu-resolved',
    ]);
    expect(
      resolved.result?.type === 'win' && resolved.result.source === 'self-draw'
        ? resolved.result.winner.evaluation.patterns.filter((pattern) => pattern === 'gang-kai')
        : [],
    ).toEqual(['gang-kai']);
    const settled = settlePendingScoringEvents({
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: resolved,
    });
    expect(settled.cumulativeScores).toEqual([1468, 844, 844, 844]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('suppresses a terminal flower-kong and leaves no self-draw candidate', () => {
    const base = waitingForDrawState([flower('flower-red-center-4')]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              flowers: [1, 2, 3].map((copy) => flower(`flower-red-center-${copy}` as TileId)),
            }
          : player,
      ),
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.phase).toBe('ended');
    expect(drawn.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(drawn.pendingScoringEvents).toEqual([]);
    expect(drawn.handProgressFacts.flowerKongCount).toBe(0);
    expect(drawn.selfDrawProvenance).toBeUndefined();
    expect(getAvailableSelfDrawHu(drawn, 0)).toBeNull();
  });

  it('classifies a direct AnGang tail ordinary tile as Gang Kai', () => {
    const afterGang = applyAction(anGangSelfDrawState(), {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });

    expect(afterGang.wall).toEqual([]);
    expect(afterGang.phase).toBe('playing');
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'an-gang-tail',
    });
    expect(getAvailableSelfDrawHu(afterGang, 0)?.evaluation.patterns).toContain('gang-kai');
  });

  it('settles direct MingGang-tail self-draw with one gang event and one Hu event', () => {
    const mingGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers');
    const afterGang = directMingGangTailState();
    const availability = getAvailableSelfDrawHu(afterGang, 1);
    const winningTile = afterGang.players[1]?.hand.find((tile) => tile.id === winningTileId);

    expect(mingGangHook).toHaveBeenCalledTimes(1);
    expect(availability?.winningTile).toBe(winningTile);
    expect(availability?.winningTile.id).toBe(winningTileId);
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: winningTileId,
      source: 'ming-gang-tail',
    });
    expect(availability?.evaluation.patterns).toContain('gang-kai');
    expect(availability?.evaluation.patterns).not.toContain('hua-kai');
    expect(afterGang.pendingScoringEvents.map((event) => event.type)).toEqual([
      'ming-gang-created',
    ]);
    const huHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(huHook).toHaveBeenCalledTimes(1);
    if (resolved.result?.type !== 'win') throw new Error('Expected MingGang-tail win result');
    expect(resolved.result.winningTile).toBe(winningTile);
    expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual([
      'ming-gang-created',
      'hu-resolved',
    ]);
    expect(
      resolved.pendingScoringEvents.filter(
        (event) => event.type === 'hu-resolved' && event.source === 'self-draw',
      ),
    ).toHaveLength(1);
    huHook.mockClear();
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: afterGang },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 },
    );
    // Hu is (10 + 10 Men Qing + 30 no-flower + 20 Gang Kai + 2 soft flowers) * 2 = 148.
    expect(settled.cumulativeScores).toEqual([832, 1464, 852, 852]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settled.currentHand.result).toMatchObject({
      source: 'self-draw',
      drawSource: 'ming-gang-tail',
      winner: { playerIndex: 1 },
    });
    expect(settled.currentHand.handProgressFacts).toMatchObject({
      successfulMingOrBuGangCount: 1,
      gangKaiCount: 1,
      selfDrawCount: 1,
    });
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      settled,
    );
    expect(mingGangHook).toHaveBeenCalledTimes(1);
    expect(huHook).toHaveBeenCalledTimes(1);
    mingGangHook.mockRestore();
    huHook.mockRestore();
  });

  it('settles direct BuGang-tail self-draw after real Peng and a full turn rotation', () => {
    const buGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const trace = directBuGangTailTrace();
    const afterGang = trace.finalized;
    const meld = afterGang.players[1]?.melds[0];

    expect(trace.afterPeng.turnStage).toBe('waiting-for-discard');
    expect(trace.drawnFourth.players[1]?.hand.map((tile) => tile.id)).toContain('wan-9-4');
    expect(trace.declared.reactionWindow?.source).toBe('bu-gang');
    expect(trace.finalized.players[1]?.buGangDrawProvenance).toEqual([]);
    expect(buGangHook).toHaveBeenCalledTimes(1);
    expect(meld).toMatchObject({ id: 'meld-1', type: 'bu-gang', fromPlayerIndex: 0 });
    expect(meld?.tiles.map((tile) => tile.id)).toEqual([
      'wan-9-2',
      'wan-9-3',
      'wan-9-1',
      'wan-9-4',
    ]);
    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: winningTileId,
      source: 'bu-gang-tail',
    });
    const availability = getAvailableSelfDrawHu(afterGang, 1);
    expect(availability?.evaluation.patterns).toContain('gang-kai');
    expect(availability?.evaluation.patterns).not.toContain('hua-kai');
    const huHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    expect(resolved.selfDrawProvenance).toBeUndefined();
    expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual([
      'bu-gang-created',
      'hu-resolved',
    ]);
    expect(
      resolved.pendingScoringEvents.filter(
        (event) => event.type === 'hu-resolved' && event.source === 'self-draw',
      ),
    ).toHaveLength(1);
    expect(huHook).toHaveBeenCalledTimes(1);
    huHook.mockClear();
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: afterGang },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 },
    );
    expect(settled.cumulativeScores).toEqual([832, 1464, 852, 852]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settled.currentHand.result).toMatchObject({
      source: 'self-draw',
      drawSource: 'bu-gang-tail',
      winner: { playerIndex: 1 },
    });
    expect(settled.currentHand.handProgressFacts).toMatchObject({
      successfulMingOrBuGangCount: 1,
      gangKaiCount: 1,
      selfDrawCount: 1,
    });
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      settled,
    );
    expect(buGangHook).toHaveBeenCalledTimes(1);
    expect(huHook).toHaveBeenCalledTimes(1);
    buGangHook.mockRestore();
    huHook.mockRestore();
  });

  it('tracks provenance across real Peng, own draw, BuGang declaration, and finalize', () => {
    const trace = directBuGangTailTrace();
    const anGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');
    const buGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const huHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');

    expect(trace.afterPeng.selfDrawProvenance).toBeUndefined();
    expect(getAvailableAnGangs(trace.afterPeng, 1)).toEqual([]);
    expect(getAvailableBuGangs(trace.afterPeng, 1)).toEqual([]);
    expect(getAvailableSelfDrawHu(trace.afterPeng, 1)).toBeNull();
    const beforeHand = trace.afterPeng.players[1]?.hand;
    const beforeMelds = trace.afterPeng.players[1]?.melds;
    const beforeWall = trace.afterPeng.wall;
    const beforeEvents = trace.afterPeng.pendingScoringEvents;
    const beforeSequence = trace.afterPeng.nextMeldSequence;
    expect(
      applyAction(trace.afterPeng, {
        type: 'DECLARE_AN_GANG',
        playerIndex: 1,
        tileFace: { category: 'number', suit: 'wan', rank: 9 },
      }),
    ).toBe(trace.afterPeng);
    expect(
      applyAction(trace.afterPeng, {
        type: 'DECLARE_BU_GANG',
        playerIndex: 1,
        meldId: 'meld-1',
      }),
    ).toBe(trace.afterPeng);
    expect(applyAction(trace.afterPeng, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(
      trace.afterPeng,
    );
    expect(anGangHook).not.toHaveBeenCalled();
    expect(buGangHook).not.toHaveBeenCalled();
    expect(huHook).not.toHaveBeenCalled();
    expect(trace.afterPeng.players[1]?.hand).toBe(beforeHand);
    expect(trace.afterPeng.players[1]?.melds).toBe(beforeMelds);
    expect(trace.afterPeng.wall).toBe(beforeWall);
    expect(trace.afterPeng.pendingScoringEvents).toBe(beforeEvents);
    expect(trace.afterPeng.nextMeldSequence).toBe(beforeSequence);
    expect(trace.drawnFourth.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: 'wan-9-4',
      source: 'wall-head',
    });
    expect(getAvailableBuGangs(trace.drawnFourth, 1)).toEqual([
      {
        targetMeldId: 'meld-1',
        tileFace: { category: 'number', suit: 'wan', rank: 9 },
      },
    ]);
    expect(trace.declared.selfDrawProvenance).toBeUndefined();
    expect(trace.finalized.selfDrawProvenance).toEqual({
      playerIndex: 1,
      tileId: winningTileId,
      source: 'bu-gang-tail',
    });
    expect(trace.finalized.players[1]?.melds[0]?.type).toBe('bu-gang');
    anGangHook.mockRestore();
    buGangHook.mockRestore();
    huHook.mockRestore();
  });

  it('settles direct AnGang-tail self-draw with exact gang and Gang Kai payments', () => {
    const anGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers');
    const afterGang = applyAction(anGangSelfDrawState(), {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });
    expect(anGangHook).toHaveBeenCalledTimes(1);
    expect(afterGang.selfDrawProvenance?.source).toBe('an-gang-tail');
    const availability = getAvailableSelfDrawHu(afterGang, 0);
    expect(availability?.evaluation.patterns).toContain('gang-kai');
    expect(availability?.evaluation.patterns).not.toContain('hua-kai');
    const huHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const resolved = applyAction(afterGang, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual([
      'an-gang-created',
      'hu-resolved',
    ]);
    expect(
      resolved.pendingScoringEvents.filter(
        (event) => event.type === 'hu-resolved' && event.source === 'self-draw',
      ),
    ).toHaveLength(1);
    expect(huHook).toHaveBeenCalledTimes(1);
    huHook.mockClear();
    const settled = applyGameActionToMatch(
      { ...createMatch(), status: 'playing', currentHandStatus: 'playing', currentHand: afterGang },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 },
    );

    // AnGang is 10 from each payer; Hu includes AnGang +2 and single wait +1 soft flowers: 152.
    expect(settled.cumulativeScores).toEqual([1486, 838, 838, 838]);
    expect(settled.currentHand.result).toMatchObject({
      source: 'self-draw',
      drawSource: 'an-gang-tail',
      winner: { playerIndex: 0 },
    });
    expect(settled.currentHand.handProgressFacts).toMatchObject({
      successfulAnGangCount: 1,
      gangKaiCount: 1,
      selfDrawCount: 1,
    });
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(applyGameActionToMatch(settled, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 })).toBe(
      settled,
    );
    expect(anGangHook).toHaveBeenCalledTimes(1);
    expect(huHook).toHaveBeenCalledTimes(1);
    anGangHook.mockRestore();
    huHook.mockRestore();
  });

  it('classifies an AnGang tail flower chain without a new flower-kong as Hua Kai', () => {
    const state = {
      ...anGangSelfDrawState(),
      wall: [ordinary(winningTileId), flower('season-spring-1')],
    };
    const afterGang = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 9 },
    });

    expect(afterGang.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    });
    expect(getAvailableSelfDrawHu(afterGang, 0)?.evaluation.patterns).toContain('hua-kai');
    expect(getAvailableSelfDrawHu(afterGang, 0)?.evaluation.patterns).not.toContain('gang-kai');
  });

  it('does not let pass-Hu block self-draw and clears provenance on a legal discard', () => {
    const base = waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]);
    const state = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0 ? { ...player, passHu: true } : player,
      ),
    };
    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(getAvailableSelfDrawHu(drawn, 0)).not.toBeNull();
    expect(drawn.players[0]?.passHu).toBe(true);
    const discarded = applyAction(drawn, { type: 'DISCARD_TILE', tileId: winningTileId });
    expect(discarded.selfDrawProvenance).toBeUndefined();
    expect(discarded.players[0]?.passHu).toBe(false);
  });

  it('rejects corrupt provenance without changing state or invoking scoring', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const corruptions = [
      { ...drawn, selfDrawProvenance: { ...drawn.selfDrawProvenance!, source: 'future' } },
      { ...drawn, selfDrawProvenance: { ...drawn.selfDrawProvenance!, playerIndex: 1 } },
      { ...drawn, selfDrawProvenance: { ...drawn.selfDrawProvenance!, tileId: 'wan-9-3' } },
      {
        ...drawn,
        selfDrawProvenance: {
          ...drawn.selfDrawProvenance!,
          formedFlowerKongDuringReplacement: false,
        },
      },
    ] as unknown as GameState[];
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    for (const state of corruptions) {
      expect(getAvailableSelfDrawHu(state, 0)).toBeNull();
      expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 })).toBe(state);
    }
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('returns null without mutation for null, primitive, and corrupt self-draw query inputs', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const corruptions: readonly unknown[] = [
      null,
      undefined,
      1,
      'state',
      true,
      { ...drawn, players: null },
      { ...drawn, players: 1 },
      { ...drawn, players: [] },
      { ...drawn, players: drawn.players.map((player, index) => (index === 0 ? null : player)) },
      { ...drawn, currentPlayerIndex: 1.5 },
      { ...drawn, currentPlayerIndex: Number.NaN },
      { ...drawn, currentPlayerIndex: Number.POSITIVE_INFINITY },
      { ...drawn, currentPlayerIndex: 4 },
      { ...drawn, phase: 'future' },
      { ...drawn, phase: null },
      { ...drawn, turnStage: 'future' },
      { ...drawn, turnStage: 1 },
      { ...drawn, pendingAction: null },
      { ...drawn, pendingAction: 'discard' },
      { ...drawn, pendingAction: { ...drawn.pendingAction, type: 'future' } },
      { ...drawn, reactionWindow: 1 },
      { ...drawn, reactionWindow: { status: 'future', source: 'discard' } },
      { ...drawn, reactionWindow: { status: 'closed', source: 'future' } },
      { ...drawn, selfDrawProvenance: 1 },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, hand: null } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, hand: 1 } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, melds: null } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, melds: 1 } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, melds: [null, 1] } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, flowers: null } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, flowers: 1 } : player,
        ),
      },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, flowers: [null, ordinary('wan-1-4')] } : player,
        ),
      },
      { ...drawn, selfDrawProvenance: { ...drawn.selfDrawProvenance!, tileId: 'missing' } },
      {
        ...drawn,
        players: drawn.players.map((player, index) =>
          index === 0 ? { ...player, hand: [...player.hand, ordinary(winningTileId)] } : player,
        ),
      },
      { ...drawn, selfDrawProvenance: { ...drawn.selfDrawProvenance!, playerIndex: 1 } },
    ];

    for (const value of corruptions) {
      const before = structuredClone(value);
      expect(() => getAvailableSelfDrawHu(value as unknown as GameState, 0)).not.toThrow();
      expect(getAvailableSelfDrawHu(value as unknown as GameState, 0)).toBeNull();
      expect(value).toEqual(before);
    }
    for (const playerIndex of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => getAvailableSelfDrawHu(drawn, playerIndex)).not.toThrow();
      expect(getAvailableSelfDrawHu(drawn, playerIndex)).toBeNull();
    }
    expect(
      getAvailableSelfDrawHu({ ...drawn, reactionWindow: null } as unknown as GameState, 0),
    ).not.toBeNull();
  });

  it('no-ops corrupt self-draw execution before scoring or ending the hand', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const corruptions: readonly { readonly state: GameState; readonly playerIndex: number }[] = [
      { state: drawn, playerIndex: 1.5 },
      { state: drawn, playerIndex: Number.NaN },
      { state: drawn, playerIndex: Number.POSITIVE_INFINITY },
      { state: { ...drawn, currentPlayerIndex: 1.5 }, playerIndex: 0 },
      { state: { ...drawn, phase: 'future' } as unknown as GameState, playerIndex: 0 },
      { state: { ...drawn, turnStage: 1 } as unknown as GameState, playerIndex: 0 },
      { state: { ...drawn, pendingAction: null } as unknown as GameState, playerIndex: 0 },
      { state: { ...drawn, reactionWindow: 1 } as unknown as GameState, playerIndex: 0 },
      {
        state: {
          ...drawn,
          players: drawn.players.map((player, index) =>
            index === 0 ? { ...player, hand: null } : player,
          ),
        } as unknown as GameState,
        playerIndex: 0,
      },
      { state: { ...drawn, selfDrawProvenance: 1 } as unknown as GameState, playerIndex: 0 },
    ];
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');

    for (const { state, playerIndex } of corruptions) {
      const facts = state.handProgressFacts;
      const provenance = state.selfDrawProvenance;
      const result = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex });
      expect(result).toBe(state);
      expect(result.phase).toBe(state.phase);
      expect(result.result).toBeUndefined();
      expect(result.pendingScoringEvents).toEqual(drawn.pendingScoringEvents);
      expect(result.selfDrawProvenance).toBe(provenance);
      expect(result.handProgressFacts).toBe(facts);
    }
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('replaces a stale self-draw candidate with the entity obtained by a real ordinary draw', () => {
    const state: GameState = {
      ...waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]),
      selfDrawProvenance: { playerIndex: 0, tileId: 'wan-1-1', source: 'wall-head' },
    };

    const drawn = applyAction(state, { type: 'DRAW_TILE' });

    expect(drawn.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: winningTileId,
      source: 'wall-head',
    });
    expect(drawn.selfDrawProvenance?.tileId).not.toBe('wan-1-1');
  });

  it('preserves provenance and the entire state for invalid discards', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const wrongStage = { ...drawn, turnStage: 'waiting-for-draw' as const };
    const nonCurrentPlayer = {
      ...drawn,
      currentPlayerIndex: 1,
    };
    const invalidStates = [
      applyAction(drawn, { type: 'DISCARD_TILE', tileId: 'missing' }),
      applyAction(drawn, { type: 'DISCARD_TILE', tileId: 'wan-9-4' }),
      applyAction(wrongStage, { type: 'DISCARD_TILE', tileId: winningTileId }),
      applyAction(nonCurrentPlayer, { type: 'DISCARD_TILE', tileId: winningTileId }),
    ];

    expect(invalidStates[0]).toBe(drawn);
    expect(invalidStates[1]).toBe(drawn);
    expect(invalidStates[0]?.selfDrawProvenance).toBe(drawn.selfDrawProvenance);
    expect(invalidStates[1]?.players).toBe(drawn.players);
    expect(invalidStates[1]?.wall).toBe(drawn.wall);
    expect(invalidStates[1]?.pendingAction).toBe(drawn.pendingAction);
    expect(invalidStates[2]).toBe(wrongStage);
    expect(invalidStates[3]).toBe(nonCurrentPlayer);
    expect(invalidStates[2]?.selfDrawProvenance).toBe(drawn.selfDrawProvenance);
  });

  it('drops a corrupt ended-hand provenance when preparing the next hand', () => {
    const resolved = applyAction(
      applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
        type: 'DRAW_TILE',
      }),
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 },
    );
    const stale: GameState = {
      ...resolved,
      selfDrawProvenance: { playerIndex: 0, tileId: winningTileId, source: 'wall-head' },
    };
    const completed = completeCurrentHand({
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: stale,
    });
    const prepared = prepareNextHand(completed);

    expect(prepared.currentHand.selfDrawProvenance).toBeUndefined();
    expect(prepared.currentHand.players[prepared.dealerIndex]?.hand).toEqual([]);
  });

  it('rejects a self-draw result with single-payer fields during completion', () => {
    const resolved = applyAction(
      applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
        type: 'DRAW_TILE',
      }),
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 },
    );
    const match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: {
        ...resolved,
        result: { ...resolved.result!, payerPlayerIndex: 1 } as GameState['result'],
      },
    };
    expect(() => completeCurrentHand(match)).toThrow(/valid result/);
  });

  it('settles a synthetic self-draw event only from its transfer snapshot', () => {
    const evaluation = getAvailableSelfDrawHu(
      applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
        type: 'DRAW_TILE',
      }),
      0,
    )!.evaluation;
    const event: PendingScoringEvent = {
      type: 'hu-resolved',
      source: 'self-draw',
      winnerPlayerIndex: 0,
      winningTile: ordinary(winningTileId),
      drawSource: 'wall-head',
      evaluation,
      transfers: [
        { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 },
        { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 20 },
      ],
      status: 'pending',
    };
    const match = {
      ...createMatch(),
      currentHand: { ...createGame(), pendingScoringEvents: [event] },
    };
    expect(settlePendingScoringEvents(match).cumulativeScores).toEqual([1030, 990, 980, 1000]);
  });

  it('rejects corrupt self-draw events transactionally', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const evaluation = getAvailableSelfDrawHu(drawn, 0)!.evaluation;
    const valid = {
      type: 'hu-resolved',
      source: 'self-draw',
      winnerPlayerIndex: 0,
      winningTile: ordinary(winningTileId),
      drawSource: 'wall-head',
      evaluation,
      transfers: [{ fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 }],
      status: 'pending',
    } as const;
    const corruptions = [
      { ...valid, payerPlayerIndex: 1 },
      { ...valid, drawSource: 'future' },
      { ...valid, winnerPlayerIndex: 4 },
      { ...valid, status: 'settled' },
      { ...valid, transfers: [] },
      {
        ...valid,
        drawSource: 'flower-replacement',
      },
    ];
    for (const corrupt of corruptions) {
      const match = {
        ...createMatch(),
        currentHand: {
          ...createGame(),
          pendingScoringEvents: [valid, corrupt] as unknown as PendingScoringEvent[],
        },
      };
      expect(() => settlePendingScoringEvents(match)).toThrow(/settlement invariant/i);
      expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    }
  });

  it('keeps the dealer for dealer self-draw and advances after ordinary non-dealer self-draw', () => {
    const dealerHand = applyAction(
      waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]),
      { type: 'DRAW_TILE' },
    );
    const dealerResolved = applyAction(dealerHand, {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 0,
    });
    const dealerMatch = completeCurrentHand({
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: dealerResolved,
    });
    expect(dealerMatch.dealerIndex).toBe(0);
    expect(dealerMatch.completedHands[0]?.reason).toBe('dealer-win');

    const base = waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]);
    const nonDealerStart: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand: index === 1 ? standardWait.map(ordinary) : [],
      })),
      currentPlayerIndex: 1,
      pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
    };
    const nonDealerResolved = applyAction(applyAction(nonDealerStart, { type: 'DRAW_TILE' }), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const nonDealerMatch = completeCurrentHand({
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: nonDealerResolved,
    });
    expect(nonDealerMatch.dealerIndex).toBe(1);
    expect(nonDealerMatch.completedHands[0]?.reason).toBe('normal-dealer-advance');
  });

  it('uses selfDrawCount to continue the 16th effective dealer turn', () => {
    const base = waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        hand: index === 1 ? standardWait.map(ordinary) : [],
      })),
      currentPlayerIndex: 1,
      pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
    };
    const resolved = applyAction(applyAction(state, { type: 'DRAW_TILE' }), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const completed = completeCurrentHand({
      ...createMatch(),
      status: 'playing',
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
      currentHandStatus: 'playing',
      currentHand: resolved,
    });

    expect(resolved.handProgressFacts.selfDrawCount).toBe(1);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('final-turn-continuation');
  });

  it('preserves the exact state on an invalid or repeated declaration', () => {
    const drawn = applyAction(waitingForDrawState([ordinary(winningTileId), ordinary('wan-9-4')]), {
      type: 'DRAW_TILE',
    });
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    expect(applyAction(drawn, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(drawn);
    expect(hook).not.toHaveBeenCalled();

    const resolved = applyAction(drawn, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    expect(applyAction(resolved, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 })).toBe(resolved);
    expect(hook).toHaveBeenCalledTimes(1);
    hook.mockRestore();
  });
});
