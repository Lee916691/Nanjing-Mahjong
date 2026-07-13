import { describe, expect, it, vi } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  getAvailableBuGangs,
  NANJING_OPEN_RULE_SET,
  type GameState,
  type MatchState,
  type OrdinaryHandTile,
  type Tile,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function ordinary(id: TileId): OrdinaryHandTile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value || value.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return value;
}

function anyTile(id: TileId): Tile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing tile ${id}`);
  return value;
}

const waitingHand = [
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

function createBuGangState(wall: readonly Tile[] = [ordinary('wan-9-1')]): GameState {
  const state = createGame();
  const players = state.players.map((player, index) => {
    if (index === 0) {
      return {
        ...player,
        hand: [
          ordinary('wan-7-4'),
          ordinary('tiao-1-1'),
          ordinary('tiao-2-1'),
          ordinary('tiao-3-1'),
          ordinary('tiao-4-1'),
          ordinary('tiao-5-1'),
          ordinary('tiao-6-1'),
          ordinary('tong-1-1'),
          ordinary('tong-2-1'),
          ordinary('tong-3-1'),
          ordinary('wind-south-1'),
        ],
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
      };
    }
    return { ...player, hand: waitingHand.map(ordinary) };
  });
  return {
    ...state,
    nextMeldSequence: 8,
    players,
    wall: [...wall],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

function respondAndResolve(state: GameState, huIndexes: readonly number[] = []): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: huIndexes.includes(responder.playerIndex) ? 'hu' : 'pass',
    });
  }
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function passWindow(state: GameState): GameState {
  return respondAndResolve(state);
}

function createBuGangStateThroughPublicActions(
  fourthDrawAndTail: readonly Tile[] = [
    ordinary('wan-7-4'),
    ordinary('wan-8-2'),
    ordinary('tiao-8-2'),
    ordinary('tong-8-2'),
    ordinary('wind-north-3'),
    ordinary('wind-north-4'),
  ],
): GameState {
  const base = createGame();
  const playerOneHand = [
    'wan-7-1',
    'wan-7-2',
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
    'wind-south-1',
  ] satisfies TileId[];
  let state: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-7-3'), ...waitingHand.map(ordinary)]
          : index === 1
            ? playerOneHand.map(ordinary)
            : waitingHand.map(ordinary),
    })),
    wall: [ordinary('wan-9-1'), ordinary('tiao-9-2'), ordinary('tong-9-1'), ...fourthDrawAndTail],
    currentPlayerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-7-3' });
  state = applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
  state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-south-1' });
  state = passWindow(state);

  for (const drawnTileId of ['wan-9-1', 'tiao-9-2', 'tong-9-1'] as const) {
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: drawnTileId });
    state = passWindow(state);
  }
  return applyAction(state, { type: 'DRAW_TILE' });
}

function createOldFourthTileAfterRealPengAndUnrelatedDraw(): GameState {
  const base = createGame();
  const filler = waitingHand.slice(0, 10).map(ordinary);
  let state: GameState = {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-7-3'), ...filler]
          : index === 1
            ? [ordinary('wan-7-1'), ordinary('wan-7-2'), ordinary('wan-7-4'), ...filler]
            : filler,
    })),
    wall: [
      ordinary('wan-9-1'),
      ordinary('tiao-9-2'),
      ordinary('tong-9-1'),
      ordinary('wind-north-3'),
      ordinary('wind-north-4'),
    ],
    currentPlayerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-7-3' });
  state = applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
  state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tiao-1-1' });
  state = passWindow(state);
  for (const drawnTileId of ['wan-9-1', 'tiao-9-2', 'tong-9-1'] as const) {
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: drawnTileId });
    state = passWindow(state);
  }
  return applyAction(state, { type: 'DRAW_TILE' });
}

describe('BuGang availability and declaration', () => {
  it('passes isolated BuGang responder snapshots with the declared target tile', () => {
    const state = createBuGangStateThroughPublicActions();
    const availability = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAvailableReactions');

    applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: 'meld-1' });

    expect(availability).toHaveBeenCalledTimes(3);
    for (const call of availability.mock.calls) {
      expect(call).toHaveLength(1);
      expect(call[0]).toMatchObject({
        source: 'bu-gang',
        playerCount: 4,
        declarerPlayerIndex: 1,
        targetTile: { id: 'wan-7-4' },
      });
      expect(call[0]).not.toHaveProperty('players');
      expect(call[0]).not.toHaveProperty('wall');
      expect(call[0]).not.toHaveProperty('reactionWindow');
      expect(call[0]).not.toHaveProperty('pendingAction');
      expect(call[0]).not.toHaveProperty('phase');
      expect(call[0]).not.toHaveProperty('turnStage');
    }
    expect(availability.mock.calls[0]?.[0]).toMatchObject({
      responderPlayerIndex: 2,
      responderSeat: 'west',
      responderConcealedTiles: state.players[2]?.hand,
      responderMelds: state.players[2]?.melds,
      responderFlowers: state.players[2]?.flowers,
      responderPassHu: state.players[2]?.passHu,
    });
    availability.mockRestore();
  });

  it('becomes available after a real Peng, required discard, full turn cycle, and own draw', () => {
    const state = createBuGangStateThroughPublicActions();
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.players[1]?.hand.map((value) => value.id)).toContain('wan-7-4');
    expect(getAvailableBuGangs(state, 1)).toEqual([
      {
        targetMeldId: 'meld-1',
        tileFace: { category: 'number', suit: 'wan', rank: 7 },
      },
    ]);
  });

  it('records provenance when a real normal draw is a flower and its tail replacement is the fourth tile', () => {
    const state = createBuGangStateThroughPublicActions([
      anyTile('flower-red-center-1'),
      ordinary('wan-8-2'),
      ordinary('wan-7-4'),
    ]);

    expect(state.players[1]?.flowers.map((value) => value.id)).toContain('flower-red-center-1');
    expect(state.players[1]?.buGangDrawProvenance).toEqual([
      { targetMeldId: 'meld-1', tileId: 'wan-7-4' },
    ]);
    expect(getAvailableBuGangs(state, 1).map((candidate) => candidate.targetMeldId)).toEqual([
      'meld-1',
    ]);
  });

  it('records provenance when a real AnGang tail draw supplies a Peng fourth tile', () => {
    const base = createBuGangState([ordinary('wan-9-1'), ordinary('wan-7-4')]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              hand: [
                ordinary('wan-2-1'),
                ordinary('wan-2-2'),
                ordinary('wan-2-3'),
                ordinary('wan-2-4'),
                ...player.hand.filter((value) => value.id !== 'wan-7-4'),
              ],
              buGangDrawProvenance: [],
            }
          : player,
      ),
    };
    const resolved = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 2 },
    });

    expect(resolved.players[0]?.melds.at(-1)?.type).toBe('an-gang');
    expect(resolved.players[0]?.buGangDrawProvenance).toEqual([
      { targetMeldId: 'meld-7', tileId: 'wan-7-4' },
    ]);
    expect(getAvailableBuGangs(resolved, 0).map((candidate) => candidate.targetMeldId)).toEqual([
      'meld-7',
    ]);
  });

  it('returns only deterministic own Peng upgrades and never exposes the tile entity', () => {
    expect(getAvailableBuGangs(createBuGangState(), 0)).toEqual([
      {
        targetMeldId: 'meld-7',
        tileFace: { category: 'number', suit: 'wan', rank: 7 },
      },
    ]);
    expect(getAvailableBuGangs(createBuGangState(), 1)).toEqual([]);
  });

  it('rejects a same-face tile held before the real Peng even after a later unrelated self draw', () => {
    const state = createOldFourthTileAfterRealPengAndUnrelatedDraw();
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');

    expect(state.players[1]?.hand.map((value) => value.id)).toContain('wan-7-4');
    expect(state.players[1]?.buGangDrawProvenance).toEqual([]);
    expect(getAvailableBuGangs(state, 1)).toEqual([]);
    expect(applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 1, meldId: 'meld-1' })).toBe(
      state,
    );
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('keeps provenance after discarding another tile and makes it available on a later active turn', () => {
    let state = createBuGangStateThroughPublicActions();
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-1' });
    state = passWindow(state);
    for (const drawnTileId of ['wan-8-2', 'tiao-8-2', 'tong-8-2'] as const) {
      state = applyAction(state, { type: 'DRAW_TILE' });
      state = applyAction(state, { type: 'DISCARD_TILE', tileId: drawnTileId });
      state = passWindow(state);
    }
    state = applyAction(state, { type: 'DRAW_TILE' });

    expect(state.players[1]?.buGangDrawProvenance).toEqual([
      { targetMeldId: 'meld-1', tileId: 'wan-7-4' },
    ]);
    expect(getAvailableBuGangs(state, 1).map((candidate) => candidate.targetMeldId)).toEqual([
      'meld-1',
    ]);
  });

  it('clears provenance when the fourth tile is discarded and on a new hand', () => {
    const state = createBuGangStateThroughPublicActions();
    const discarded = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });

    expect(discarded.players[1]?.buGangDrawProvenance).toEqual([]);
    expect(createGame().players.every((player) => player.buGangDrawProvenance.length === 0)).toBe(
      true,
    );
  });

  it('rejects empty walls, missing fourth tiles, duplicate entity ids, duplicate-face Pengs, and post-Peng turns', () => {
    const state = createBuGangState();
    expect(getAvailableBuGangs({ ...state, wall: [] }, 0)).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          players: state.players.map((player, i) => (i === 0 ? { ...player, hand: [] } : player)),
        },
        0,
      ),
    ).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          players: state.players.map((player, i) =>
            i === 0
              ? {
                  ...player,
                  buGangDrawProvenance: [
                    ...player.buGangDrawProvenance,
                    ...player.buGangDrawProvenance,
                  ],
                }
              : player,
          ),
        },
        0,
      ),
    ).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          players: state.players.map((player, i) =>
            i === 0
              ? {
                  ...player,
                  melds: player.melds.map((meld) => ({ ...meld, fromPlayerIndex: 0 })),
                }
              : player,
          ),
        },
        0,
      ),
    ).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          players: state.players.map((player, i) =>
            i === 0 ? { ...player, hand: [ordinary('wan-7-1')] } : player,
          ),
        },
        0,
      ),
    ).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          players: state.players.map((player, i) =>
            i === 0
              ? { ...player, melds: [...player.melds, { ...player.melds[0]!, id: 'meld-8' }] }
              : player,
          ),
        },
        0,
      ),
    ).toEqual([]);
    expect(
      getAvailableBuGangs(
        {
          ...state,
          reactionWindow: {
            source: 'discard',
            discardedTile: ordinary('tiao-9-2'),
            fromPlayerIndex: 1,
            fromSeat: 'south',
            responderOrder: [],
            availableReactions: [],
            responses: [{ playerIndex: 0, seat: 'east', type: 'peng' }],
            status: 'closed',
          },
        },
        0,
      ),
    ).toEqual([]);
  });

  it('opens a pending intent without moving tiles, upgrading, scoring, or drawing', () => {
    const state = createBuGangState();
    const declared = applyAction(state, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });

    expect(declared.reactionWindow).toMatchObject({
      source: 'bu-gang',
      intent: {
        declarerPlayerIndex: 0,
        declarerSeat: 'east',
        targetMeldId: 'meld-7',
        tile: { id: 'wan-7-4' },
      },
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
    });
    expect(
      declared.reactionWindow?.availableReactions.every((availability) =>
        availability.responseTypes.every((type) => type === 'hu' || type === 'pass'),
      ),
    ).toBe(true);
    expect(declared.players[0]?.hand).toEqual(state.players[0]?.hand);
    expect(declared.players[0]?.melds).toEqual(state.players[0]?.melds);
    expect(declared.pendingScoringEvents).toEqual([]);
    expect(declared.wall).toEqual(state.wall);
    expect(
      applyAction(declared, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-7' }),
    ).toBe(declared);
  });
});

describe('BuGang all-pass finalize', () => {
  it('runs real Peng, rotation, own fourth draw, declaration, three passes, finalize, and Match settlement', () => {
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: createBuGangStateThroughPublicActions(),
    };
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 1,
      meldId: 'meld-1',
    });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: 'pass',
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(match.currentHand.players[1]?.melds[0]?.type).toBe('bu-gang');
    expect(match.currentHand.players[1]?.buGangDrawProvenance).toEqual([]);
    expect(match.currentHand.handProgressFacts.successfulMingOrBuGangCount).toBe(1);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
  });

  it('calls the BuGang scoring hook only once after a successful all-pass finalize', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    let corrupt = applyAction(createBuGangState(), {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });
    for (const responder of corrupt.reactionWindow?.responderOrder ?? []) {
      corrupt = applyAction(corrupt, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    corrupt = { ...corrupt, wall: [] };
    expect(applyAction(corrupt, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(corrupt);
    expect(hook).not.toHaveBeenCalled();

    const state = createBuGangState();
    const declared = applyAction(state, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });
    expect(hook).not.toHaveBeenCalled();

    const resolved = passWindow(declared);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(applyAction(resolved, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(resolved);
    expect(hook).toHaveBeenCalledTimes(1);

    hook.mockRestore();
  });

  it('upgrades the Peng in place, snapshots 20 points from the original claimer, and tail draws', () => {
    const state = createBuGangState([ordinary('tong-9-1')]);
    const declared = applyAction(state, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });
    const resolved = respondAndResolve(declared);
    const meld = resolved.players[0]?.melds[0];

    expect(meld).toMatchObject({
      id: 'meld-7',
      type: 'bu-gang',
      claimedTileId: 'wan-7-3',
      fromPlayerIndex: 2,
    });
    expect(meld?.tiles.map((value) => value.id)).toEqual([
      'wan-7-1',
      'wan-7-2',
      'wan-7-3',
      'wan-7-4',
    ]);
    expect(resolved.nextMeldSequence).toBe(8);
    expect(resolved.players[0]?.hand.map((value) => value.id)).toEqual([
      'tiao-1-1',
      'tiao-2-1',
      'tiao-3-1',
      'tiao-4-1',
      'tiao-5-1',
      'tiao-6-1',
      'tong-1-1',
      'tong-2-1',
      'tong-3-1',
      'wind-south-1',
      'tong-9-1',
    ]);
    expect(resolved.pendingScoringEvents).toEqual([
      {
        type: 'bu-gang-created',
        playerIndex: 0,
        payerPlayerIndex: 2,
        meldId: 'meld-7',
        transfers: [{ fromPlayerIndex: 2, toPlayerIndex: 0, amount: 20 }],
        status: 'pending',
      },
    ]);
    expect(resolved.turnStage).toBe('waiting-for-discard');
    expect(resolved.currentPlayerIndex).toBe(0);
    expect(resolved.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: 'tong-9-1',
      source: 'bu-gang-tail',
    });
  });

  it('settles in the same Match action and supports consecutive candidates after the tail draw', () => {
    const base = createBuGangState([ordinary('tong-9-1'), ordinary('wan-8-4')]);
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              melds: [
                ...player.melds,
                {
                  id: 'meld-8',
                  type: 'peng' as const,
                  tiles: [ordinary('wan-8-1'), ordinary('wan-8-2'), ordinary('wan-8-3')],
                  claimedTileId: 'wan-8-3' as const,
                  fromPlayerIndex: 1,
                },
              ],
            }
          : player,
      ),
    };
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: state,
    };
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(match.cumulativeScores).toEqual([1020, 1000, 980, 1000]);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.currentHand.players[0]?.buGangDrawProvenance).toContainEqual({
      targetMeldId: 'meld-8',
      tileId: 'wan-8-4',
    });
    expect(
      getAvailableBuGangs(match.currentHand, 0).map((candidate) => candidate.targetMeldId),
    ).toEqual(['meld-8']);

    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-8',
    });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(match.currentHand.handProgressFacts.successfulMingOrBuGangCount).toBe(2);
    expect(match.cumulativeScores).toEqual([1040, 980, 980, 1000]);
  });

  it('atomically no-ops if wall, fourth tile, meld, or entity identity becomes corrupt before resolve', () => {
    const declared = applyAction(createBuGangState(), {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });
    let awaiting = declared;
    for (const responder of declared.reactionWindow?.responderOrder ?? []) {
      awaiting = applyAction(awaiting, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    const corruptions: GameState[] = [
      { ...awaiting, wall: [] },
      {
        ...awaiting,
        players: awaiting.players.map((player, i) => (i === 0 ? { ...player, hand: [] } : player)),
      },
      {
        ...awaiting,
        players: awaiting.players.map((player, i) =>
          i === 0 ? { ...player, melds: [{ ...player.melds[0]!, type: 'an-gang' }] } : player,
        ),
      },
      {
        ...awaiting,
        players: awaiting.players.map((player, i) =>
          i === 0 ? { ...player, hand: [ordinary('wan-7-1')] } : player,
        ),
      },
    ];
    corruptions.forEach((state) =>
      expect(applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(state),
    );
  });

  it('keeps the BuGang and earlier events but ends with draw result when terminal flowers exhaust the wall', () => {
    const state = createBuGangState([
      anyTile('flower-red-center-1'),
      anyTile('flower-red-center-2'),
      anyTile('flower-red-center-3'),
      anyTile('flower-red-center-4'),
    ]);
    const resolved = respondAndResolve(
      applyAction(state, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-7' }),
    );
    expect(resolved.players[0]?.melds[0]?.type).toBe('bu-gang');
    expect(resolved.players[0]?.buGangDrawProvenance).toEqual([]);
    expect(resolved.phase).toBe('ended');
    expect(resolved.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual(['bu-gang-created']);
    expect(resolved.handProgressFacts).toMatchObject({
      successfulMingOrBuGangCount: 1,
      flowerKongCount: 0,
    });
  });
});

describe('Rob-BuGang Hu', () => {
  it('does not call the BuGang scoring hook when a real rob-BuGang Hu succeeds', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const declared = applyAction(createBuGangStateThroughPublicActions(), {
      type: 'DECLARE_BU_GANG',
      playerIndex: 1,
      meldId: 'meld-1',
    });
    const resolved = respondAndResolve(declared, [2]);

    expect(resolved.phase).toBe('ended');
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });
  it.each([[[2]], [[2, 3]], [[2, 3, 0]]] as const)(
    'resolves ordered winners %j, keeps the Peng, removes the fourth tile, and does not tail draw',
    (winners) => {
      const state = createBuGangStateThroughPublicActions();
      const declared = applyAction(state, {
        type: 'DECLARE_BU_GANG',
        playerIndex: 1,
        meldId: 'meld-1',
      });
      const resolved = respondAndResolve(declared, winners);

      expect(resolved.phase).toBe('ended');
      expect(resolved.selfDrawProvenance).toBeUndefined();
      expect(resolved.result).toMatchObject({
        type: 'win',
        source: 'rob-bu-gang',
        payerPlayerIndex: 1,
        winners: winners.map((playerIndex) => ({ playerIndex })),
      });
      expect(resolved.players[1]?.melds[0]?.type).toBe('peng');
      expect(resolved.players[1]?.hand.map((value) => value.id)).not.toContain('wan-7-4');
      expect(resolved.players[1]?.buGangDrawProvenance).toEqual([]);
      expect(resolved.handProgressFacts.successfulMingOrBuGangCount).toBe(0);
      expect(resolved.wall).toEqual(state.wall);
      expect(resolved.pendingScoringEvents.every((event) => event.type === 'hu-resolved')).toBe(
        true,
      );
      expect(resolved.pendingScoringEvents.flatMap((event) => event.transfers)).toEqual(
        winners.map((winner) => ({ fromPlayerIndex: 1, toPlayerIndex: winner, amount: 300 })),
      );
    },
  );

  it('does not offer Rob-BuGang Hu to a player in pass-Hu state and rejects Peng/MingGang responses', () => {
    const base = createBuGangState([ordinary('wan-9-1'), ordinary('wind-north-4')]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 3 ? { ...player, hand: [ordinary('wan-4-4')] } : player,
      ),
      currentPlayerIndex: 3,
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 3, seat: 'north', type: 'discard' },
    };
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-4-4' });
    expect(
      state.reactionWindow?.availableReactions.find((value) => value.playerIndex === 1)
        ?.responseTypes,
    ).toContain('hu');
    state = respondAndResolve(state);
    expect(state.players[1]?.passHu).toBe(true);
    state = applyAction(state, { type: 'DRAW_TILE' });
    const declared = applyAction(state, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-7',
    });

    expect(declared.reactionWindow?.availableReactions[0]?.responseTypes).toEqual(['pass']);
    expect(
      applyAction(declared, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' }),
    ).toBe(declared);
    expect(
      applyAction(declared, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'ming-gang' }),
    ).toBe(declared);
  });

  it('settles Rob-BuGang Hu in the same Match action and keeps the dealer', () => {
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: createBuGangStateThroughPublicActions(),
    };
    match = applyGameActionToMatch(match, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 1,
      meldId: 'meld-1',
    });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex === 2 ? 'hu' : 'pass',
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(match.currentHand.phase).toBe('ended');
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.cumulativeScores).toEqual([1000, 700, 1300, 1000]);
    expect(completeCurrentHand(match).dealerIndex).toBe(0);
  });

  it('uses the RuleSet BuGang hook only after all-pass finalization', () => {
    expect(
      NANJING_OPEN_RULE_SET.getBuGangScoreTransfers({
        playerIndex: 1,
        payerPlayerIndex: 3,
        playerCount: 4,
        meldId: 'meld-9',
      }),
    ).toEqual([{ fromPlayerIndex: 3, toPlayerIndex: 1, amount: 20 }]);
  });
});
