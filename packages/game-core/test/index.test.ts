import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RULE_SET_ID,
  FLOWER_TILE_KINDS,
  NUMBER_TILE_SUITS,
  SEATS,
  advanceTurn,
  applyAction,
  applyGameActionToMatch,
  WIND_TILE_KINDS,
  NANJING_OPEN_RULE_SET,
  createInitialPlayers,
  createInitialGame,
  createInitialHandForMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  createNanjingMahjongTileWall,
  createTileWall,
  completeCurrentHand,
  drawTileFromWallHead,
  drawTileFromWallTail,
  gameEngine,
  getRuleSet,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  listRuleSets,
  prepareNextHand,
  replaceFlowersForSinglePlayer,
  resolveDrawnTileWithFlowerReplacement,
  requiresFlowerReveal,
  settlePendingScoringEvents,
  startCurrentHand,
  startGame,
  startMatch,
} from '../src';
import type {
  DiscardRecord,
  FlowerTile,
  GameCreationOptions,
  GameAction,
  GameState,
  MahjongTile,
  MatchState,
  Meld,
  MeldType,
  OrdinaryHandTile,
  PlayerState,
  PendingScoringEvent,
  ReactionAvailability,
  ReactionWindow,
  ReactionWindowStatus,
  ResolveReactionWindowAction,
  RuleSetOptions,
  StartGameOptions,
  TileId,
} from '../src';

const transfer = (fromPlayerIndex: number, toPlayerIndex: number, amount = 20) => ({
  fromPlayerIndex,
  toPlayerIndex,
  amount,
});
const flowerTransfers = (playerIndex: number, amount = 20) =>
  SEATS.map((_, payerIndex) => payerIndex)
    .filter((payerIndex) => payerIndex !== playerIndex)
    .map((payerIndex) => transfer(payerIndex, playerIndex, amount));

function passInitialDiHuDecisions(initial: GameState): GameState {
  let state = initial;
  while (state.diHuDeclarations?.status === 'collecting') {
    const playerIndex = state.diHuDeclarations.pendingPlayerIndices[0];
    if (playerIndex === undefined) throw new Error('Missing Di Hu decision player');
    state = applyAction(state, { type: 'SUBMIT_DI_HU_DECISION', playerIndex, decision: 'pass' });
  }
  return state;
}

function passMatchInitialDiHuDecisions(initial: MatchState): MatchState {
  let match = initial;
  while (match.currentHand.diHuDeclarations?.status === 'collecting') {
    const playerIndex = match.currentHand.diHuDeclarations.pendingPlayerIndices[0];
    if (playerIndex === undefined) throw new Error('Missing Di Hu decision player');
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex,
      decision: 'pass',
    });
  }
  return match;
}

describe('Meld player state model', () => {
  it('exports the reaction resolution status and action types', () => {
    const reactionWindowStatus: ReactionWindowStatus = 'awaiting-resolution';
    const resolveAction: ResolveReactionWindowAction = { type: 'RESOLVE_REACTION_WINDOW' };

    expect(reactionWindowStatus).toBe('awaiting-resolution');
    expect(resolveAction).toEqual({ type: 'RESOLVE_REACTION_WINDOW' });
  });

  it('initializes melds and preserves concrete meld tiles through a draw', () => {
    const deck = createNanjingMahjongDeck();
    const meldTypes: readonly MeldType[] = ['peng', 'ming-gang', 'an-gang', 'bu-gang'];
    const meld: Meld = {
      id: 'meld-1',
      type: 'peng',
      tiles: [
        ordinaryTileById(deck, 'wan-1-1'),
        ordinaryTileById(deck, 'wan-1-2'),
        ordinaryTileById(deck, 'wan-1-3'),
      ],
      claimedTileId: 'wan-1-3',
      fromPlayerIndex: 3,
    };
    const state = createPlayingGameWithWall([ordinaryTileById(deck, 'tiao-2-1')]);
    state.players[0] = { ...state.players[0]!, melds: [meld] };
    const nextState = applyAction(state, { type: 'DRAW_TILE' });

    expect(createInitialPlayers().every((player) => player.melds.length === 0)).toBe(true);
    expect(createGame().players.every((player) => player.melds.length === 0)).toBe(true);
    expect(startGame(createGame()).players.every((player) => player.melds.length === 0)).toBe(true);
    expect(meldTypes).toEqual(['peng', 'ming-gang', 'an-gang', 'bu-gang']);
    expect(meld.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'wan-1-2', 'wan-1-3']);
    expect(nextState.players[0]?.melds).toEqual([meld]);
    expect(nextState.players[0]?.flowers).toEqual([]);
    expect(nextState.pendingScoringEvents).toEqual(state.pendingScoringEvents);
  });

  it('starts newly prepared match hands with empty melds without changing scores', () => {
    const started = startCurrentHand(createMatch());
    const completed = completeCurrentHand(withEndedDraw(started));
    const prepared = prepareNextHand(completed);
    const restarted = startCurrentHand(prepared);

    expect(prepared.currentHand.players.every((player) => player.melds.length === 0)).toBe(true);
    expect(prepared.currentHand.nextMeldSequence).toBe(1);
    expect(restarted.currentHand.players.every((player) => player.melds.length === 0)).toBe(true);
    expect(restarted.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('preserves discard claim history and meld sequence through unrelated updates', () => {
    const deck = createNanjingMahjongDeck();
    const claimedRecord: DiscardRecord = {
      tile: ordinaryTileById(deck, 'wan-1-1'),
      claimedByMeldId: 'meld-6',
    };
    const state: GameState = {
      ...createPlayingGameWithWall([ordinaryTileById(deck, 'tiao-2-1')]),
      nextMeldSequence: 7,
    };
    state.players[0] = { ...state.players[0]!, discardPile: [claimedRecord] };

    const nextState = applyAction(state, { type: 'DRAW_TILE' });

    expect(nextState.nextMeldSequence).toBe(7);
    expect(nextState.players[0]?.discardPile).toEqual([claimedRecord]);
  });
});

describe('MingGang reaction execution', () => {
  it('atomically creates the meld, claims the discard, draws from the tail, and appends scoring', () => {
    const deck = createNanjingMahjongDeck();
    const oldEvent = {
      type: 'flower-kong-created' as const,
      playerIndex: 0,
      seat: 'east' as const,
      kind: 'red-center' as const,
      createdDuring: 'initial-deal' as const,
      transfers: flowerTransfers(0),
      status: 'pending' as const,
    };
    const awaiting = createAwaitingMingGangResolutionState({
      matchingTileIds: ['wan-3-4', 'tiao-6-1', 'wan-3-2', 'wan-3-3'],
      wall: [ordinaryTileById(deck, 'tong-8-1'), ordinaryTileById(deck, 'tiao-5-1')],
      nextMeldSequence: 7,
      pendingScoringEvents: [oldEvent],
    });
    const oldRecord = playerAt(awaiting, 0).discardPile[0];
    const result = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result).not.toBe(awaiting);
    expect(tileIds(playerAt(result, 1).hand)).toEqual(['tiao-6-1', 'tiao-5-1']);
    expect(playerAt(result, 1).melds).toEqual([
      {
        id: 'meld-7',
        type: 'ming-gang',
        tiles: [
          expect.objectContaining({ id: 'wan-3-2' }),
          expect.objectContaining({ id: 'wan-3-3' }),
          expect.objectContaining({ id: 'wan-3-4' }),
          expect.objectContaining({ id: 'wan-3-1' }),
        ],
        claimedTileId: 'wan-3-1',
        fromPlayerIndex: 0,
      },
    ]);
    expect(playerAt(result, 0).discardPile).toHaveLength(1);
    expect(playerAt(result, 0).discardPile[0]).toEqual({
      tile: oldRecord?.tile,
      claimedByMeldId: 'meld-7',
    });
    expect(tileIds(result.wall)).toEqual(['tong-8-1']);
    expect(result.lastDiscard).toBeUndefined();
    expect(result.reactionWindow).toEqual({ ...awaiting.reactionWindow, status: 'closed' });
    expect(result.currentPlayerIndex).toBe(1);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(result.nextMeldSequence).toBe(8);
    expect(result.pendingScoringEvents).toEqual([
      oldEvent,
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 1,
        payerPlayerIndex: 0,
        meldId: 'meld-7',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ]);
    expect(result.handProgressFacts.successfulMingOrBuGangCount).toBe(1);
    expect('cumulativeScores' in result).toBe(false);
    expect(applyAction(result, { type: 'DRAW_TILE' })).toBe(result);
  });

  it('replaces consecutive tail flowers and appends a newly formed runtime flower kong', () => {
    const deck = createNanjingMahjongDeck();
    const oldEvent = {
      type: 'flower-kong-created' as const,
      playerIndex: 0,
      seat: 'east' as const,
      kind: 'fortune' as const,
      createdDuring: 'initial-deal' as const,
      transfers: flowerTransfers(0),
      status: 'pending' as const,
    };
    const awaiting = createAwaitingMingGangResolutionState({
      wall: [
        ordinaryTileById(deck, 'tong-8-1'),
        ordinaryTileById(deck, 'tiao-5-1'),
        flowerTileById(deck, 'season-winter-1'),
        flowerTileById(deck, 'flower-red-center-4'),
      ],
      flowers: ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
        flowerTileById(deck, id as TileId),
      ),
      pendingScoringEvents: [oldEvent],
    });
    const result = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(tileIds(result.wall)).toEqual(['tong-8-1']);
    expect(tileIds(playerAt(result, 1).flowers)).toEqual([
      'flower-red-center-1',
      'flower-red-center-2',
      'flower-red-center-3',
      'flower-red-center-4',
      'season-winter-1',
    ]);
    expect(tileIds(playerAt(result, 1).hand)).toEqual(['tiao-5-1']);
    expect(result.pendingScoringEvents.map((event) => event.type)).toEqual([
      'flower-kong-created',
      'ming-gang-created',
      'flower-kong-created',
    ]);
    expect(result.pendingScoringEvents[2]).toEqual({
      type: 'flower-kong-created',
      playerIndex: 1,
      seat: 'south',
      kind: 'red-center',
      createdDuring: 'runtime-flower-replacement',
      transfers: [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
      ],
      status: 'pending',
    });
    expect(result.handProgressFacts).toMatchObject({
      successfulMingOrBuGangCount: 1,
      flowerKongCount: 1,
    });
  });

  it('keeps a successful gang when the only tail tile is a flower, but suppresses its final flower-kong event', () => {
    const deck = createNanjingMahjongDeck();
    const awaiting = createAwaitingMingGangResolutionState({
      wall: [flowerTileById(deck, 'flower-red-center-4')],
      flowers: ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
        flowerTileById(deck, id as TileId),
      ),
    });
    const result = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result).not.toBe(awaiting);
    expect(result.phase).toBe('ended');
    expect(result.turnStage).toBe('hand-ended');
    expect(result.pendingAction).toEqual({ playerIndex: null, seat: null, type: 'none' });
    expect(result.currentPlayerIndex).toBe(1);
    expect(result.wall).toEqual([]);
    expect(tileIds(playerAt(result, 1).flowers)).toContain('flower-red-center-4');
    expect(playerAt(result, 1).melds[0]?.type).toBe('ming-gang');
    expect(playerAt(result, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(result.pendingScoringEvents).toEqual([
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 1,
        payerPlayerIndex: 0,
        meldId: 'meld-1',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ]);
    expect(result.handProgressFacts.flowerKongCount).toBe(0);
    expect(result.nextMeldSequence).toBe(2);
    expect(result.lastDiscard).toBeUndefined();
    expect(result.reactionWindow?.status).toBe('closed');
  });

  it.each([
    [
      'insufficient matching tiles',
      (state: GameState) => ({
        ...state,
        players: state.players.map((player, index) =>
          index === 1 ? { ...player, hand: player.hand.slice(0, 2) } : player,
        ),
      }),
    ],
    [
      'availability excludes ming-gang',
      (state: GameState) => ({
        ...state,
        reactionWindow: {
          ...state.reactionWindow!,
          availableReactions: state.reactionWindow!.availableReactions.map((availability) =>
            availability.playerIndex === 1
              ? { ...availability, responseTypes: ['pass', 'peng'] as const }
              : availability,
          ),
        },
      }),
    ],
    [
      'claimed discard',
      (state: GameState) => ({
        ...state,
        players: state.players.map((player, index) =>
          index === 0
            ? {
                ...player,
                discardPile: player.discardPile.map((record) => ({
                  ...record,
                  claimedByMeldId: 'meld-old',
                })),
              }
            : player,
        ),
      }),
    ],
    [
      'mismatched latest discard',
      (state: GameState) => {
        const deck = createNanjingMahjongDeck();
        return {
          ...state,
          players: state.players.map((player, index) =>
            index === 0
              ? {
                  ...player,
                  discardPile: [
                    ...player.discardPile,
                    { tile: ordinaryTileById(deck, 'tiao-1-1') },
                  ],
                }
              : player,
          ),
        };
      },
    ],
    [
      'missing last discard',
      (state: GameState) => {
        const next = { ...state };
        delete next.lastDiscard;
        return next;
      },
    ],
    ['zero sequence', (state: GameState) => ({ ...state, nextMeldSequence: 0 })],
    ['negative sequence', (state: GameState) => ({ ...state, nextMeldSequence: -1 })],
    ['fractional sequence', (state: GameState) => ({ ...state, nextMeldSequence: 1.5 })],
    [
      'two ming-gang responses',
      (state: GameState) => ({
        ...state,
        reactionWindow: {
          ...state.reactionWindow!,
          responses: state.reactionWindow!.responses.map((response, index) =>
            index === 1 ? { ...response, type: 'ming-gang' as const } : response,
          ),
        },
      }),
    ],
    [
      'peng and ming-gang responses',
      (state: GameState) => ({
        ...state,
        reactionWindow: {
          ...state.reactionWindow!,
          responses: state.reactionWindow!.responses.map((response, index) =>
            index === 1 ? { ...response, type: 'peng' as const } : response,
          ),
        },
      }),
    ],
    [
      'hu response',
      (state: GameState) => ({
        ...state,
        reactionWindow: {
          ...state.reactionWindow!,
          responses: state.reactionWindow!.responses.map((response, index) =>
            index === 1 ? { ...response, type: 'hu' as const } : response,
          ),
        },
      }),
    ],
  ] as const)('returns the original state without partial updates for %s', (_name, alter) => {
    expectMingGangResolutionNoop(alter(createAwaitingMingGangResolutionState()));
  });

  it('records the same runtime flower-kong event during a normal draw replacement', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-4'),
      ordinaryTileById(deck, 'tiao-5-1'),
    ]);
    state.players[0] = {
      ...state.players[0]!,
      flowers: ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
        flowerTileById(deck, id as TileId),
      ),
    };
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(tileIds(playerAt(result, 0).hand)).toEqual(['tiao-5-1']);
    expect(result.pendingScoringEvents).toEqual([
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'runtime-flower-replacement',
        transfers: flowerTransfers(0),
        status: 'pending',
      },
    ]);
  });

  it.each([
    [
      'duplicate selected hand tile IDs',
      (state: GameState) => {
        const player = playerAt(state, 1);
        const duplicatedTile = player.hand[0];

        if (!duplicatedTile) {
          throw new Error('Missing tile for duplicate ID test');
        }

        return {
          ...state,
          players: state.players.map((candidate, index) =>
            index === 1
              ? { ...candidate, hand: [duplicatedTile, duplicatedTile, ...player.hand.slice(1, 2)] }
              : candidate,
          ),
        };
      },
    ],
    [
      'selected hand tile ID matches the discard ID',
      (state: GameState) => {
        const player = playerAt(state, 1);
        const discardedTile =
          state.reactionWindow?.source === 'discard'
            ? state.reactionWindow.discardedTile
            : undefined;

        if (!discardedTile || !isOrdinaryHandTile(discardedTile)) {
          throw new Error('Missing ordinary discarded tile for ID conflict test');
        }

        return {
          ...state,
          players: state.players.map((candidate, index) =>
            index === 1
              ? { ...candidate, hand: [discardedTile, ...player.hand.slice(0, 2)] }
              : candidate,
          ),
        };
      },
    ],
  ] as const)('rejects corrupt MingGang state with %s', (_name, corrupt) => {
    const state = corrupt(createAwaitingMingGangResolutionState());
    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result).toBe(state);
    expect(result.players).toBe(state.players);
    expect(result.players.map((player) => player.hand)).toEqual(
      state.players.map((player) => player.hand),
    );
    expect(result.players.map((player) => player.flowers)).toEqual(
      state.players.map((player) => player.flowers),
    );
    expect(result.players.map((player) => player.melds)).toEqual(
      state.players.map((player) => player.melds),
    );
    expect(result.players.map((player) => player.discardPile)).toEqual(
      state.players.map((player) => player.discardPile),
    );
    expect(result.wall).toBe(state.wall);
    expect(result.pendingScoringEvents).toBe(state.pendingScoringEvents);
    expect(result.nextMeldSequence).toBe(state.nextMeldSequence);
    expect(result.lastDiscard).toBe(state.lastDiscard);
    expect(result.reactionWindow).toBe(state.reactionWindow);
    expect(result.reactionWindow?.status).toBe('awaiting-resolution');
    expect(result.currentPlayerIndex).toBe(state.currentPlayerIndex);
    expect(result.turnStage).toBe(state.turnStage);
    expect(result.pendingAction).toBe(state.pendingAction);
  });

  it('preserves pending events and public player state when a normal tile is drawn', () => {
    const deck = createNanjingMahjongDeck();
    const pendingScoringEvents: GameState['pendingScoringEvents'] = [
      {
        type: 'flower-kong-created',
        playerIndex: 1,
        seat: 'south',
        kind: 'fortune',
        createdDuring: 'initial-deal',
        transfers: flowerTransfers(1),
        status: 'pending',
      },
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 2,
        payerPlayerIndex: 0,
        meldId: 'meld-old',
        transfers: [transfer(0, 2)],
        status: 'pending',
      },
    ];
    const state: GameState = {
      ...createPlayingGameWithWall([
        ordinaryTileById(deck, 'wan-1-1'),
        ordinaryTileById(deck, 'tiao-2-1'),
      ]),
      pendingScoringEvents,
    };
    const originalPlayer = playerAt(state, 0);
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(tileIds(playerAt(result, 0).hand)).toEqual(['wan-1-1']);
    expect(tileIds(result.wall)).toEqual(['tiao-2-1']);
    expect(result.currentPlayerIndex).toBe(0);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(playerAt(result, 0).flowers).toEqual(originalPlayer.flowers);
    expect(playerAt(result, 0).melds).toEqual(originalPlayer.melds);
    expect(playerAt(result, 0).discardPile).toEqual(originalPlayer.discardPile);
    expect(result.reactionWindow).toBeUndefined();
    expect(result.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect(result.pendingScoringEvents.every((event) => event.status === 'pending')).toBe(true);
    expect('cumulativeScores' in result).toBe(false);
  });

  it.each(['initial-deal', 'runtime-flower-replacement'] as const)(
    'does not duplicate a flower kong already recorded during %s',
    (createdDuring) => {
      const deck = createNanjingMahjongDeck();
      const existingEvent = {
        type: 'flower-kong-created' as const,
        playerIndex: 0,
        seat: 'east' as const,
        kind: 'red-center' as const,
        createdDuring,
        transfers: flowerTransfers(0),
        status: 'pending' as const,
      };
      const state: GameState = {
        ...createPlayingGameWithWall([
          flowerTileById(deck, 'flower-red-center-4'),
          ordinaryTileById(deck, 'tong-8-1'),
          ordinaryTileById(deck, 'tiao-5-1'),
        ]),
        pendingScoringEvents: [existingEvent],
      };
      state.players[0] = {
        ...state.players[0]!,
        flowers: ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
          flowerTileById(deck, id as TileId),
        ),
      };
      const result = applyAction(state, { type: 'DRAW_TILE' });

      expect(result.pendingScoringEvents).toEqual([existingEvent]);
      expect(result.pendingScoringEvents[0]).toBe(existingEvent);
    },
  );

  it('preserves tail replacement order and appends runtime flower kongs in formation order', () => {
    const deck = createNanjingMahjongDeck();
    const history = {
      type: 'ming-gang-created' as const,
      receiverPlayerIndex: 2,
      payerPlayerIndex: 3,
      meldId: 'meld-old',
      transfers: [transfer(3, 2)],
      status: 'pending' as const,
    };
    const state: GameState = {
      ...createPlayingGameWithWall([
        flowerTileById(deck, 'season-spring-1'),
        ordinaryTileById(deck, 'tong-8-1'),
        ordinaryTileById(deck, 'tiao-5-1'),
        flowerTileById(deck, 'flower-chrysanthemum-1'),
        flowerTileById(deck, 'flower-red-center-4'),
      ]),
      pendingScoringEvents: [history],
    };
    state.players[0] = {
      ...state.players[0]!,
      flowers: [
        ...['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
          flowerTileById(deck, id as TileId),
        ),
        ...['flower-plum-1', 'flower-orchid-1', 'flower-bamboo-1'].map((id) =>
          flowerTileById(deck, id as TileId),
        ),
      ],
    };
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(tileIds(playerAt(result, 0).flowers).slice(-3)).toEqual([
      'season-spring-1',
      'flower-red-center-4',
      'flower-chrysanthemum-1',
    ]);
    expect(tileIds(playerAt(result, 0).hand)).toEqual(['tiao-5-1']);
    expect(tileIds(result.wall)).toEqual(['tong-8-1']);
    expect(result.currentPlayerIndex).toBe(0);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(result.reactionWindow).toBeUndefined();
    expect(result.pendingScoringEvents).toEqual([
      history,
      expect.objectContaining({ kind: 'red-center', status: 'pending' }),
      expect.objectContaining({ kind: 'plum-orchid-bamboo-chrysanthemum', status: 'pending' }),
    ]);
  });

  it('suppresses a flower kong formed by the final flower of an exhausted normal draw chain', () => {
    const deck = createNanjingMahjongDeck();
    const history = {
      type: 'flower-kong-created' as const,
      playerIndex: 2,
      seat: 'west' as const,
      kind: 'fortune' as const,
      createdDuring: 'initial-deal' as const,
      transfers: flowerTransfers(2),
      status: 'pending' as const,
    };
    const state: GameState = {
      ...createPlayingGameWithWall([
        flowerTileById(deck, 'season-spring-1'),
        flowerTileById(deck, 'flower-red-center-4'),
      ]),
      pendingScoringEvents: [history],
    };
    state.players[0] = {
      ...state.players[0]!,
      flowers: ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
        flowerTileById(deck, id as TileId),
      ),
    };
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(result.phase).toBe('ended');
    expect(result.turnStage).toBe('hand-ended');
    expect(result.wall).toEqual([]);
    expect(tileIds(playerAt(result, 0).flowers).slice(-2)).toEqual([
      'season-spring-1',
      'flower-red-center-4',
    ]);
    expect(result.pendingScoringEvents).toEqual([history]);
    expect(playerAt(result, 0).melds).toEqual(playerAt(state, 0).melds);
    expect(playerAt(result, 0).discardPile).toEqual(playerAt(state, 0).discardPile);
    expect('cumulativeScores' in result).toBe(false);
  });

  it('keeps an earlier runtime flower kong while suppressing the final exhausted flower', () => {
    const deck = createNanjingMahjongDeck();
    const history = {
      type: 'ming-gang-created' as const,
      receiverPlayerIndex: 2,
      payerPlayerIndex: 1,
      meldId: 'meld-old',
      transfers: [transfer(1, 2)],
      status: 'pending' as const,
    };
    const state: GameState = {
      ...createPlayingGameWithWall([
        flowerTileById(deck, 'season-spring-1'),
        flowerTileById(deck, 'flower-chrysanthemum-1'),
        flowerTileById(deck, 'flower-red-center-4'),
      ]),
      pendingScoringEvents: [history],
    };
    state.players[0] = {
      ...state.players[0]!,
      flowers: [
        ...['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].map((id) =>
          flowerTileById(deck, id as TileId),
        ),
        ...['flower-plum-1', 'flower-orchid-1', 'flower-bamboo-1'].map((id) =>
          flowerTileById(deck, id as TileId),
        ),
      ],
    };
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(result.phase).toBe('ended');
    expect(result.wall).toEqual([]);
    expect(tileIds(playerAt(result, 0).flowers).slice(-3)).toEqual([
      'season-spring-1',
      'flower-red-center-4',
      'flower-chrysanthemum-1',
    ]);
    expect(result.pendingScoringEvents).toEqual([
      history,
      expect.objectContaining({
        type: 'flower-kong-created',
        playerIndex: 0,
        kind: 'red-center',
        createdDuring: 'runtime-flower-replacement',
        status: 'pending',
      }),
    ]);
  });

  it('preserves pending events when a normal draw starts with an empty wall', () => {
    const pendingScoringEvents: GameState['pendingScoringEvents'] = [
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 1,
        payerPlayerIndex: 0,
        meldId: 'meld-old',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ];
    const state: GameState = {
      ...createPlayingGameWithWall([]),
      pendingScoringEvents,
    };
    const result = applyAction(state, { type: 'DRAW_TILE' });

    expect(result.phase).toBe('ended');
    expect(result.turnStage).toBe('hand-ended');
    expect(result.pendingAction).toEqual({ playerIndex: null, seat: null, type: 'none' });
    expect(result.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect(playerAt(result, 0).flowers).toEqual(playerAt(state, 0).flowers);
    expect(playerAt(result, 0).melds).toEqual(playerAt(state, 0).melds);
    expect(playerAt(result, 0).discardPile).toEqual(playerAt(state, 0).discardPile);
    expect('cumulativeScores' in result).toBe(false);
  });
});
function tileById(tiles: readonly MahjongTile[], id: TileId): MahjongTile {
  const tile = tiles.find((candidate) => candidate.id === id);

  if (!tile) {
    throw new Error(`Missing tile ${id}`);
  }

  return tile;
}

function ordinaryTileById(tiles: readonly MahjongTile[], id: TileId): OrdinaryHandTile {
  const tile = tileById(tiles, id);

  if (!isOrdinaryHandTile(tile)) {
    throw new Error(`Expected ordinary hand tile ${id}`);
  }

  return tile;
}

function withEndedDraw(match: MatchState): MatchState {
  return {
    ...match,
    currentHand: {
      ...match.currentHand,
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      result: { type: 'draw', reason: 'wall-exhausted' },
    },
  };
}

function withEndedWin(
  match: MatchState,
  winnerPlayerIndex: number,
  payerPlayerIndex: number,
): MatchState {
  const winningTile = ordinaryTileById(createNanjingMahjongDeck(), 'wind-east-1');
  return {
    ...match,
    currentHand: {
      ...match.currentHand,
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      result: {
        type: 'win',
        source: 'discard',
        winningTile,
        payerPlayerIndex,
        winners: [
          {
            playerIndex: winnerPlayerIndex,
            evaluation: {
              structure: {
                type: 'standard',
                existingMeldCount: 4,
                pair: { category: 'wind', wind: 'east' },
                concealedMelds: [],
              },
              patterns: ['men-qing'],
              hardFlowerCount: 0,
              softFlowerCount: 0,
            },
          },
        ],
      },
    },
  };
}

function flowerTileById(tiles: readonly MahjongTile[], id: TileId): FlowerTile {
  const tile = tileById(tiles, id);

  if (!isFlowerTile(tile)) {
    throw new Error(`Expected flower tile ${id}`);
  }

  return tile;
}

function playerAt(state: GameState, playerIndex: number): PlayerState {
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Missing player ${playerIndex}`);
  }

  return player;
}

function tileIds(tiles: readonly MahjongTile[]): TileId[] {
  return tiles.map((tile) => tile.id);
}

function createPlayingGameWithWall(wall: readonly MahjongTile[]): GameState {
  const players = createInitialPlayers();

  return {
    nextMeldSequence: 1,
    ruleSetId: DEFAULT_RULE_SET_ID,
    players,
    wall: [...wall],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-draw',
    pendingAction: {
      playerIndex: 0,
      seat: players[0]?.seat ?? 'east',
      type: 'draw',
    },
    pendingScoringEvents: [],
    handProgressFacts: createGame().handProgressFacts,
    specialDiscardTracking: createGame().specialDiscardTracking,
    gangPackage: { status: 'none' },
    threeMouthState: createGame().threeMouthState,
  };
}

function createWaitingForReactionState(): GameState {
  const deck = createNanjingMahjongDeck();
  let state = createPlayingGameWithWall([
    ordinaryTileById(deck, 'wan-2-1'),
    ordinaryTileById(deck, 'wan-2-2'),
  ]);

  state = advanceTurn(state);

  return applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
}

function createAwaitingPengResolutionState(
  options: {
    matchingTileIds?: readonly TileId[];
    nextMeldSequence?: number;
  } = {},
): GameState {
  const deck = createNanjingMahjongDeck();
  const discardedTile = ordinaryTileById(deck, 'wan-3-1');
  const players = createInitialPlayers();
  players[0] = { ...players[0]!, hand: [discardedTile] };
  players[1] = {
    ...players[1]!,
    hand: (options.matchingTileIds ?? ['wan-3-2', 'wan-3-3']).map((id) =>
      ordinaryTileById(deck, id),
    ),
  };
  let state: GameState = {
    ...createPlayingGameWithWall([]),
    players,
    nextMeldSequence: options.nextMeldSequence ?? 1,
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });
  state = applyAction(state, {
    type: 'SUBMIT_REACTION',
    playerIndex: 1,
    responseType: 'peng',
  });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  return applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
}

function createAwaitingMingGangResolutionState(
  options: {
    matchingTileIds?: readonly TileId[];
    wall?: readonly MahjongTile[];
    nextMeldSequence?: number;
    flowers?: readonly FlowerTile[];
    pendingScoringEvents?: GameState['pendingScoringEvents'];
  } = {},
): GameState {
  const deck = createNanjingMahjongDeck();
  const discardedTile = ordinaryTileById(deck, 'wan-3-1');
  const players = createInitialPlayers();
  players[0] = { ...players[0]!, hand: [discardedTile] };
  players[1] = {
    ...players[1]!,
    hand: (options.matchingTileIds ?? ['wan-3-4', 'wan-3-2', 'wan-3-3']).map((id) =>
      ordinaryTileById(deck, id),
    ),
    flowers: options.flowers ?? [],
  };
  let state: GameState = {
    ...createPlayingGameWithWall(options.wall ?? [ordinaryTileById(deck, 'tiao-5-1')]),
    players,
    nextMeldSequence: options.nextMeldSequence ?? 1,
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    pendingScoringEvents: options.pendingScoringEvents ?? [],
  };
  state = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });
  state = applyAction(state, {
    type: 'SUBMIT_REACTION',
    playerIndex: 1,
    responseType: 'ming-gang',
  });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  return applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
}

function expectMingGangResolutionNoop(state: GameState): void {
  const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

  expect(result).toBe(state);
  expect(result.players).toBe(state.players);
  expect(result.wall).toBe(state.wall);
  expect(result.pendingScoringEvents).toBe(state.pendingScoringEvents);
  expect(result.nextMeldSequence).toBe(state.nextMeldSequence);
  expect(result.lastDiscard).toBe(state.lastDiscard);
  expect(result.reactionWindow).toBe(state.reactionWindow);
}

function expectPengResolutionNoop(state: GameState): void {
  const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

  expect(result).toBe(state);
  expect(result.players.map((player) => player.hand)).toEqual(
    state.players.map((player) => player.hand),
  );
  expect(result.players.map((player) => player.melds)).toEqual(
    state.players.map((player) => player.melds),
  );
  expect(result.players.map((player) => player.discardPile)).toEqual(
    state.players.map((player) => player.discardPile),
  );
  expect(
    result.players.map((player) => player.discardPile.map((record) => record.claimedByMeldId)),
  ).toEqual(
    state.players.map((player) => player.discardPile.map((record) => record.claimedByMeldId)),
  );
  expect(result.nextMeldSequence).toBe(state.nextMeldSequence);
  expect(result.lastDiscard).toBe(state.lastDiscard);
  expect(result.reactionWindow?.status).toBe('awaiting-resolution');
  expect(result.currentPlayerIndex).toBe(state.currentPlayerIndex);
  expect(result.turnStage).toBe(state.turnStage);
  expect(result.pendingAction).toBe(state.pendingAction);
}
describe('Nanjing Mahjong RuleSet registry', () => {
  it('registers nanjing-open as the default RuleSet shell', () => {
    const state = createGame();
    const action: GameAction = { type: 'DRAW_TILE' };
    const ruleSet = getRuleSet(DEFAULT_RULE_SET_ID);

    expect(DEFAULT_RULE_SET_ID).toBe('nanjing-open');
    expect(ruleSet).toBe(NANJING_OPEN_RULE_SET);
    expect(ruleSet.id).toBe('nanjing-open');
    expect(ruleSet.displayName).toBe('\u5357\u4eac\u9ebb\u5c06\u657e\u5f00\u5934');
    expect(ruleSet.totalEffectiveDealerTurns).toBe(16);
    expect(ruleSet.validateAction(state, action)).toBe(true);
    expect(ruleSet.applyAction(state, action)).toBe(state);
    expect(typeof ruleSet.getAvailableReactions).toBe('function');
    expect(listRuleSets()).toEqual([NANJING_OPEN_RULE_SET]);
  });

  it('creates deterministic current-rule MingGang and flower-kong transfer snapshots', () => {
    const ruleSet = getRuleSet('nanjing-open');
    expect(
      ruleSet.getMingGangScoreTransfers({
        receiverPlayerIndex: 1,
        payerPlayerIndex: 3,
        playerCount: 4,
        meldId: 'meld-1',
      }),
    ).toEqual([transfer(3, 1)]);
    const context = {
      playerIndex: 2,
      playerCount: 4,
      kind: 'red-center' as const,
      createdDuring: 'initial-deal' as const,
    };
    expect(ruleSet.getFlowerKongScoreTransfers(context)).toEqual([
      transfer(0, 2),
      transfer(1, 2),
      transfer(3, 2),
    ]);
    expect(ruleSet.getFlowerKongScoreTransfers(context)).toEqual(
      ruleSet.getFlowerKongScoreTransfers(context),
    );
  });
});

describe('Pending scoring event settlement', () => {
  const withEvents = (
    events: readonly PendingScoringEvent[],
    scores: readonly number[] = [1000, 1000, 1000, 1000],
  ): MatchState => ({
    ...createMatch(),
    cumulativeScores: scores,
    currentHand: { ...createMatch().currentHand, pendingScoringEvents: events },
  });
  const mingEvent = (transfers: readonly ReturnType<typeof transfer>[]): PendingScoringEvent => ({
    type: 'ming-gang-created',
    receiverPlayerIndex: 1,
    payerPlayerIndex: 0,
    meldId: 'meld-1',
    transfers,
    status: 'pending',
  });
  const flowerEvent = (transfers: readonly ReturnType<typeof transfer>[]): PendingScoringEvent => ({
    type: 'flower-kong-created',
    playerIndex: 1,
    seat: 'south',
    kind: 'red-center',
    createdDuring: 'runtime-flower-replacement',
    transfers,
    status: 'pending',
  });

  it('returns the original match for an empty queue', () => {
    const match = createMatch();
    expect(settlePendingScoringEvents(match)).toBe(match);
  });

  it('settles ming-gang once and allows negative scores', () => {
    const match = withEvents(
      [
        {
          type: 'ming-gang-created',
          receiverPlayerIndex: 1,
          payerPlayerIndex: 3,
          meldId: 'meld-1',
          transfers: [transfer(3, 1)],
          status: 'pending',
        },
      ],
      [1000, 1000, 1000, 10],
    );
    const settled = settlePendingScoringEvents(match);

    expect(settled.cumulativeScores).toEqual([1000, 1020, 1000, -10]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(settlePendingScoringEvents(settled)).toBe(settled);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 10]);
  });

  it('executes 10-point and mixed transfer snapshots without applying a Mahjong formula', () => {
    expect(
      settlePendingScoringEvents(withEvents([mingEvent([transfer(0, 1, 10)])])).cumulativeScores,
    ).toEqual([990, 1010, 1000, 1000]);
    expect(
      settlePendingScoringEvents(withEvents([flowerEvent(flowerTransfers(1, 10))]))
        .cumulativeScores,
    ).toEqual([990, 1030, 990, 990]);
    expect(
      settlePendingScoringEvents(
        withEvents([flowerEvent([transfer(0, 1, 10), transfer(2, 1, 15), transfer(3, 1, 20)])]),
      ).cumulativeScores,
    ).toEqual([990, 1045, 985, 980]);
  });

  it('settles mixed 10 and 20 point event snapshots in queue order', () => {
    const settled = settlePendingScoringEvents(
      withEvents([
        mingEvent([transfer(0, 1, 10)]),
        flowerEvent([transfer(0, 1), transfer(2, 1), transfer(3, 1)]),
      ]),
    );
    expect(settled.cumulativeScores).toEqual([970, 1070, 980, 980]);
  });

  it.each([
    'red-center',
    'fortune',
    'white-board',
    'plum-orchid-bamboo-chrysanthemum',
    'spring-summer-autumn-winter',
  ] as const)('settles flower-kong kind %s', (kind) => {
    const settled = settlePendingScoringEvents(
      withEvents([
        {
          type: 'flower-kong-created',
          playerIndex: 2,
          seat: 'west',
          kind,
          createdDuring: 'runtime-flower-replacement',
          transfers: flowerTransfers(2),
          status: 'pending',
        },
      ]),
    );
    expect(settled.cumulativeScores).toEqual([980, 980, 1060, 980]);
  });

  it.each(['initial-deal', 'initial-flower-replacement', 'runtime-flower-replacement'] as const)(
    'settles flower-kong creation stage %s',
    (createdDuring) => {
      const settled = settlePendingScoringEvents(
        withEvents([
          {
            type: 'flower-kong-created',
            playerIndex: 0,
            seat: 'east',
            kind: 'fortune',
            createdDuring,
            transfers: flowerTransfers(0),
            status: 'pending',
          },
        ]),
      );
      expect(settled.cumulativeScores).toEqual([1060, 980, 980, 980]);
    },
  );

  it('settles a mixed batch atomically while preserving ended state', () => {
    const match = withEvents([
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 1,
        payerPlayerIndex: 0,
        meldId: 'meld-2',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
      {
        type: 'flower-kong-created',
        playerIndex: 1,
        seat: 'south',
        kind: 'white-board',
        createdDuring: 'runtime-flower-replacement',
        transfers: flowerTransfers(1),
        status: 'pending',
      },
    ]);
    const ended = {
      ...match,
      currentHand: {
        ...match.currentHand,
        phase: 'ended' as const,
        turnStage: 'hand-ended' as const,
      },
    };
    const settled = settlePendingScoringEvents(ended);
    expect(settled.cumulativeScores).toEqual([960, 1080, 980, 980]);
    expect(settled.currentHand.phase).toBe('ended');
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
  });

  it.each([
    [
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 4,
        payerPlayerIndex: 0,
        meldId: 'meld-1',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ],
    [
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 0,
        payerPlayerIndex: 0,
        meldId: 'meld-1',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ],
    [
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'south',
        kind: 'fortune',
        createdDuring: 'initial-deal',
        transfers: flowerTransfers(0),
        status: 'pending',
      },
    ],
    [{ type: 'unknown', status: 'pending' }],
  ])('rejects corrupt events transactionally', (rawEvents) => {
    const events = rawEvents as unknown as readonly PendingScoringEvent[];
    const match = withEvents(events);
    expect(() => settlePendingScoringEvents(match)).toThrow(/scoring settlement invariant failed/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toBe(events);
  });

  it.each([null, 7, { ...mingEvent([transfer(0, 1)]), status: 'settled' }])(
    'rejects malformed event metadata without mutation',
    (rawEvent) => {
      const events = [rawEvent] as unknown as readonly PendingScoringEvent[];
      const match = withEvents(events);
      expect(() => settlePendingScoringEvents(match)).toThrow(
        /scoring settlement invariant failed/i,
      );
      expect(match.currentHand.pendingScoringEvents).toBe(events);
      expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    },
  );

  it.each([
    { players: createMatch().currentHand.players.slice(0, 3) },
    { cumulativeScores: [1000, 1000, 1000] },
    { cumulativeScores: [Number.NaN, 1000, 1000, 1000] },
    { cumulativeScores: [Number.POSITIVE_INFINITY, 1000, 1000, 1000] },
  ])('rejects corrupt Match scoring invariants', (corruption) => {
    const base = withEvents([mingEvent([transfer(0, 1)])]);
    const match =
      'players' in corruption
        ? { ...base, currentHand: { ...base.currentHand, players: corruption.players! } }
        : { ...base, cumulativeScores: corruption.cumulativeScores };
    expect(() => settlePendingScoringEvents(match)).toThrow(/scoring settlement invariant failed/i);
    expect(base.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it.each([
    ['not-array', 'bad'],
    ['empty', []],
    ['null', [null]],
    ['primitive', [1]],
    ['from-negative', [transfer(-1, 1)]],
    ['from-out-of-range', [transfer(4, 1)]],
    ['from-fraction', [transfer(0.5, 1)]],
    ['to-negative', [transfer(0, -1)]],
    ['to-out-of-range', [transfer(0, 4)]],
    ['to-fraction', [transfer(0, 1.5)]],
    ['self-transfer', [transfer(1, 1)]],
    ['zero', [transfer(0, 1, 0)]],
    ['negative', [transfer(0, 1, -1)]],
    ['fraction', [transfer(0, 1, 1.5)]],
    ['nan', [transfer(0, 1, Number.NaN)]],
    ['infinity', [transfer(0, 1, Number.POSITIVE_INFINITY)]],
    ['string-amount', [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: '20' }]],
  ])('rejects corrupt transfer %s transactionally', (_name, rawTransfers) => {
    const event = {
      ...mingEvent([transfer(0, 1)]),
      transfers: rawTransfers,
    } as unknown as PendingScoringEvent;
    const events = [event];
    const match = withEvents(events);
    expect(() => settlePendingScoringEvents(match)).toThrow(/scoring settlement invariant failed/i);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toBe(events);
  });

  it.each([
    [mingEvent([transfer(0, 1)]), { type: 'unknown', status: 'pending' }],
    [{ type: 'unknown', status: 'pending' }, mingEvent([transfer(0, 1)])],
    [mingEvent([transfer(0, 1), transfer(0, 0)]), flowerEvent(flowerTransfers(1))],
  ])(
    'rejects an invalid event or transfer without partially settling the batch',
    (...rawEvents) => {
      const events = rawEvents as unknown as readonly PendingScoringEvent[];
      const match = withEvents(events);
      expect(() => settlePendingScoringEvents(match)).toThrow(
        /scoring settlement invariant failed/i,
      );
      expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
      expect(match.currentHand.pendingScoringEvents).toBe(events);
    },
  );

  it('settles pre-existing events even when a game action is a no-op', () => {
    const match = withEvents([
      {
        type: 'ming-gang-created',
        receiverPlayerIndex: 1,
        payerPlayerIndex: 0,
        meldId: 'meld-1',
        transfers: [transfer(0, 1)],
        status: 'pending',
      },
    ]);
    const result = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(result.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('leaves the original Match unchanged when action settlement or completion fails', () => {
    const corrupt = {
      ...mingEvent([transfer(0, 1)]),
      transfers: [],
    } as unknown as PendingScoringEvent;
    const noOpMatch = withEvents([corrupt]);
    expect(() => applyGameActionToMatch(noOpMatch, { type: 'DRAW_TILE' })).toThrow(
      /scoring settlement invariant failed/i,
    );
    const playing = {
      ...noOpMatch,
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
    };
    expect(() => completeCurrentHand(withEndedDraw(playing))).toThrow(
      /scoring settlement invariant failed/i,
    );
    expect(noOpMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(noOpMatch.currentHand.pendingScoringEvents).toEqual([corrupt]);

    const deck = createNanjingMahjongDeck();
    const advancing = {
      ...noOpMatch,
      currentHand: {
        ...createPlayingGameWithWall([ordinaryTileById(deck, 'wan-1-1')]),
        pendingScoringEvents: [corrupt],
      },
    };
    expect(() => applyGameActionToMatch(advancing, { type: 'DRAW_TILE' })).toThrow(
      /scoring settlement invariant failed/i,
    );
    expect(advancing.currentHand.wall).toHaveLength(1);
  });

  it('preserves the match reference for a no-op with no events', () => {
    const match = createMatch();
    expect(applyGameActionToMatch(match, { type: 'DRAW_TILE' })).toBe(match);
  });

  it('applies an ordinary action without changing scores', () => {
    const match = passMatchInitialDiHuDecisions(startMatch(createMatch()));
    const tileId = playerAt(match.currentHand, match.dealerIndex).hand[0]?.id;
    if (!tileId) throw new Error('Expected dealer tile');
    const result = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId });
    expect(result.currentHand).not.toBe(match.currentHand);
    expect(result.cumulativeScores).toBe(match.cumulativeScores);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('settles before completing and rejects discarding an unsettled completed hand', () => {
    const playing = {
      ...withEvents([
        {
          type: 'ming-gang-created',
          receiverPlayerIndex: 1,
          payerPlayerIndex: 0,
          meldId: 'meld-1',
          transfers: [transfer(0, 1)],
          status: 'pending',
        },
      ]),
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
    };
    const completed = completeCurrentHand(withEndedDraw(playing));
    expect(completed.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
    expect(completed.completedHands[0]?.pendingScoringEventCount).toBe(0);

    const corruptCompleted = {
      ...completed,
      currentHand: {
        ...completed.currentHand,
        pendingScoringEvents: playing.currentHand.pendingScoringEvents,
      },
    };
    expect(() => prepareNextHand(corruptCompleted)).toThrow(/pending scoring events/i);
  });

  it('settles a real runtime draw flower-kong in the same Match action', () => {
    const deck = createNanjingMahjongDeck();
    const hand = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-4'),
      ordinaryTileById(deck, 'tiao-5-1'),
    ]);
    hand.players[0] = {
      ...hand.players[0]!,
      flowers: [1, 2, 3].map((copy) => flowerTileById(deck, `flower-red-center-${copy}` as TileId)),
    };
    const match = {
      ...createMatch(),
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
      currentHand: hand,
    };
    const result = applyGameActionToMatch(match, { type: 'DRAW_TILE' });
    expect(result.cumulativeScores).toEqual([1060, 980, 980, 980]);
    expect(tileIds(playerAt(result.currentHand, 0).flowers).slice(-1)).toEqual([
      'flower-red-center-4',
    ]);
    expect(tileIds(playerAt(result.currentHand, 0).hand)).toEqual(['tiao-5-1']);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('settles a real MingGang and its tail flower-kong in the same Match action', () => {
    const deck = createNanjingMahjongDeck();
    const hand = createAwaitingMingGangResolutionState({
      wall: [ordinaryTileById(deck, 'tiao-5-1'), flowerTileById(deck, 'flower-red-center-4')],
      flowers: [1, 2, 3].map((copy) => flowerTileById(deck, `flower-red-center-${copy}` as TileId)),
    });
    const match = {
      ...createMatch(),
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
      currentHand: hand,
    };
    const result = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.cumulativeScores).toEqual([920, 1080, 1000, 1000]);
    expect(playerAt(result.currentHand, 1).melds[0]?.type).toBe('ming-gang');
    expect(playerAt(result.currentHand, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(tileIds(playerAt(result.currentHand, 1).hand)).toEqual(['tiao-5-1']);
    expect(result.currentHand.reactionWindow?.status).toBe('closed');
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('settles a real MingGang transfer while preserving its reducer result', () => {
    const deck = createNanjingMahjongDeck();
    const hand = createAwaitingMingGangResolutionState({
      wall: [ordinaryTileById(deck, 'tiao-5-1')],
    });
    const match = {
      ...createMatch(),
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
      currentHand: hand,
    };
    const result = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
    expect(playerAt(result.currentHand, 1).melds[0]?.type).toBe('ming-gang');
    expect(playerAt(result.currentHand, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(result.currentHand.lastDiscard).toBeUndefined();
    expect(result.currentHand.reactionWindow?.status).toBe('closed');
    expect(result.currentHand.currentPlayerIndex).toBe(1);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('settles earlier snapshots and MingGang when its final tail flower ends the hand', () => {
    const deck = createNanjingMahjongDeck();
    const earlier = flowerEvent(flowerTransfers(1));
    const hand = createAwaitingMingGangResolutionState({
      wall: [flowerTileById(deck, 'flower-red-center-4')],
      flowers: [1, 2, 3].map((copy) => flowerTileById(deck, `flower-red-center-${copy}` as TileId)),
      pendingScoringEvents: [earlier],
    });
    const match = {
      ...createMatch(),
      status: 'playing' as const,
      currentHandStatus: 'playing' as const,
      currentHand: hand,
    };
    const result = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.currentHand.phase).toBe('ended');
    expect(result.cumulativeScores).toEqual([960, 1080, 980, 980]);
    expect(result.currentHand.pendingScoringEvents).toEqual([]);
  });
});

describe('Nanjing Mahjong match state', () => {
  it('creates a default nanjing-open match shell with 16 dealer turns and initial scores', () => {
    const match: MatchState = createMatch();

    expect(match.ruleSetId).toBe('nanjing-open');
    expect(match.status).toBe('waiting');
    expect(match.totalEffectiveDealerTurns).toBe(16);
    expect(match.effectiveDealerTurn).toBe(1);
    expect(match.dealerIndex).toBe(0);
    expect(match.currentHandIndex).toBe(0);
    expect(match.currentHandStatus).toBe('not-started');
    expect(match.currentHand.ruleSetId).toBe('nanjing-open');
    expect(match.currentHand.phase).toBe('ready');
    expect(match.currentHand.dealerIndex).toBe(match.dealerIndex);
    expect(match.currentHand.currentPlayerIndex).toBe(match.dealerIndex);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.completedHands).toEqual([]);
    expect(match.isFinalDealerTurn).toBe(false);
  });

  it('creates the first ready hand for a match without starting legacy game flow', () => {
    const match = createMatch({ dealerSeat: 'north' });
    const hand = createInitialHandForMatch(match);

    expect(hand.ruleSetId).toBe('nanjing-open');
    expect(hand.phase).toBe('ready');
    expect(hand.dealerIndex).toBe(3);
    expect(hand.currentPlayerIndex).toBe(3);
    expect(hand.players.map((player) => player.hand.length)).toEqual([0, 0, 0, 0]);
  });

  it('starts a match by creating the current hand and dealing from the existing game state', () => {
    const match = createMatch();
    const startedMatch = startMatch(match);

    expect(startedMatch).not.toBe(match);
    expect(startedMatch.status).toBe('playing');
    expect(startedMatch.currentHandStatus).toBe('playing');
    expect(startedMatch.currentHand.ruleSetId).toBe('nanjing-open');
    expect(startedMatch.currentHand.phase).toBe('playing');
    expect(startedMatch.currentHand.dealerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.currentPlayerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      14, 13, 13, 13,
    ]);
    expect(
      startedMatch.currentHand.players.every((player) => player.hand.every(isOrdinaryHandTile)),
    ).toBe(true);
    expect(startedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('supports dealerSeat and dealerIndex when creating or starting matches', () => {
    const southDealerMatch = createMatch({ dealerSeat: 'south' });
    const westDealerMatch = startMatch(createMatch(), { dealerIndex: 2 });

    expect(southDealerMatch.dealerIndex).toBe(1);
    expect(southDealerMatch.currentHand.dealerIndex).toBe(1);
    expect(westDealerMatch.dealerIndex).toBe(2);
    expect(westDealerMatch.currentHand.dealerIndex).toBe(2);
    expect(westDealerMatch.currentHand.currentPlayerIndex).toBe(2);
    expect(westDealerMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      13, 13, 14, 13,
    ]);
  });

  it('keeps initial flower kong scoring events pending without changing match scores', () => {
    const deck = createNanjingMahjongDeck();
    const redCenters = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-red-center-2'),
      flowerTileById(deck, 'flower-red-center-3'),
      flowerTileById(deck, 'flower-red-center-4'),
    ];
    const ordinaryTiles = deck.filter(isOrdinaryHandTile);
    const rawOrdinaryTiles = [...ordinaryTiles.slice(0, 49)];
    const replacementTiles = ordinaryTiles.slice(49, 53);
    const leftoverTile = ordinaryTiles[53];
    const fallbackOrdinaryTile = ordinaryTiles[0];
    const [
      firstReplacementTile,
      secondReplacementTile,
      thirdReplacementTile,
      fourthReplacementTile,
    ] = replacementTiles;
    const rawTiles: MahjongTile[] = [];
    const redCenterPositions = new Set([0, 4, 8, 12]);

    if (
      !leftoverTile ||
      !fallbackOrdinaryTile ||
      !firstReplacementTile ||
      !secondReplacementTile ||
      !thirdReplacementTile ||
      !fourthReplacementTile
    ) {
      throw new Error('Missing ordinary tiles for match flower kong test');
    }

    for (let index = 0; index < 53; index += 1) {
      rawTiles.push(
        redCenterPositions.has(index)
          ? (redCenters.shift() ?? rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile)
          : (rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile),
      );
    }

    const readyHand = {
      ...createGame(),
      wall: [
        ...rawTiles,
        leftoverTile,
        fourthReplacementTile,
        thirdReplacementTile,
        secondReplacementTile,
        firstReplacementTile,
      ],
    };
    const match = {
      ...createMatch(),
      currentHand: readyHand,
    };
    const startedMatch = startMatch(match);

    expect(startedMatch.cumulativeScores).toEqual([1060, 980, 980, 980]);
    expect(startedMatch.currentHand.pendingScoringEvents).toEqual([]);
    expect('score' in playerAt(startedMatch.currentHand, 0)).toBe(false);

    const completedMatch = completeCurrentHand(withEndedDraw(startedMatch));

    expect(completedMatch.currentHand.pendingScoringEvents).toEqual([]);
    expect(completedMatch.cumulativeScores).toEqual([1060, 980, 980, 980]);
  });

  it('completes a hand with dealer advance without settling scores', () => {
    const startedMatch = startMatch(createMatch());
    const completedMatch = completeCurrentHand(withEndedWin(startedMatch, 1, 0));

    expect(completedMatch.completedHands).toEqual([
      {
        handIndex: 0,
        dealerIndex: 0,
        effectiveDealerTurn: 1,
        result: completedMatch.currentHand.result,
        dealerTransition: 'advance',
        reason: 'normal-dealer-advance',
        completedBy: 1,
        pendingScoringEventCount: 0,
      },
    ]);
    expect(completedMatch.dealerIndex).toBe(1);
    expect(completedMatch.effectiveDealerTurn).toBe(2);
    expect(completedMatch.currentHandStatus).toBe('completed');
    expect(completedMatch.status).toBe('playing');
    expect(completedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(completedMatch.currentHand.dealerIndex).toBe(completedMatch.dealerIndex);
    expect(completedMatch.currentHand.players.map((player) => player.isDealer)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('completes a hand with dealer stay without advancing effective dealer turn', () => {
    const startedMatch = startMatch(createMatch({ dealerIndex: 2 }));
    const completedMatch = completeCurrentHand(withEndedWin(startedMatch, 2, 1));

    expect(completedMatch.completedHands).toEqual([
      {
        handIndex: 0,
        dealerIndex: 2,
        effectiveDealerTurn: 1,
        result: completedMatch.currentHand.result,
        dealerTransition: 'stay',
        reason: 'dealer-win',
        completedBy: 2,
        pendingScoringEventCount: 0,
      },
    ]);
    expect(completedMatch.dealerIndex).toBe(2);
    expect(completedMatch.effectiveDealerTurn).toBe(1);
    expect(completedMatch.currentHandStatus).toBe('completed');
    expect(completedMatch.status).toBe('playing');
    expect(completedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('ends after a normal dealer advance on the 16th effective dealer turn with no continuation fact', () => {
    const finalAdvanceMatch = {
      ...startMatch(createMatch()),
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
    };
    const advanced = completeCurrentHand(withEndedWin(finalAdvanceMatch, 1, 0));

    expect(advanced.status).toBe('completed');
    expect(advanced.effectiveDealerTurn).toBe(16);
    expect(advanced.dealerIndex).toBe(1);
    expect(advanced.currentHandStatus).toBe('completed');
  });

  it.each([
    ['a self draw', { selfDrawCount: 1 }],
    ['a follow-discard penalty', { followDiscardPenaltyCount: 1 }],
    ['a four-identical-discards penalty', { fourIdenticalDiscardsPenaltyCount: 1 }],
    ['four winds gathered', { fourWindsGatheredCount: 1 }],
    ['a successful AnGang', { successfulAnGangCount: 1 }],
    ['two successful direct MingGang or BuGang declarations', { successfulMingOrBuGangCount: 2 }],
    ['an established flower-kong', { flowerKongCount: 1 }],
  ])('continues the 16th dealer turn after %s', (_name, fact) => {
    const match = startMatch(createMatch());
    const final = {
      ...match,
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
      currentHand: {
        ...match.currentHand,
        handProgressFacts: { ...match.currentHand.handProgressFacts, ...fact },
      },
    };

    const completed = completeCurrentHand(withEndedWin(final, 1, 0));

    expect(completed.status).toBe('playing');
    expect(completed.effectiveDealerTurn).toBe(16);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.currentHandIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('final-turn-continuation');
  });

  it.each([
    ['a gang-kai win', { gangKaiCount: 1 }],
    ['a package settlement', { packageSettlementCount: 1 }],
  ])('keeps the dealer for the existing no-advance condition: %s', (_name, fact) => {
    const match = startMatch(createMatch());
    const completed = completeCurrentHand(
      withEndedWin(
        {
          ...match,
          currentHand: {
            ...match.currentHand,
            handProgressFacts: { ...match.currentHand.handProgressFacts, ...fact },
          },
        },
        1,
        0,
      ),
    );

    expect(completed.status).toBe('playing');
    expect(completed.effectiveDealerTurn).toBe(1);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');
  });

  it('rejects corrupt hand progress facts without advancing the match', () => {
    const match = withEndedWin(startMatch(createMatch()), 1, 0);
    const corrupt = {
      ...match,
      currentHand: {
        ...match.currentHand,
        handProgressFacts: {
          ...match.currentHand.handProgressFacts,
          successfulAnGangCount: Number.NaN,
        },
      },
    };
    const before = structuredClone(corrupt);

    expect(() => completeCurrentHand(corrupt)).toThrow(/valid result/);
    expect(corrupt).toEqual(before);
  });

  it('does not continue the 16th dealer turn after only one direct MingGang or BuGang', () => {
    const match = startMatch(createMatch());
    const final = {
      ...match,
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
      currentHand: {
        ...match.currentHand,
        handProgressFacts: {
          ...match.currentHand.handProgressFacts,
          successfulMingOrBuGangCount: 1,
        },
      },
    };

    expect(completeCurrentHand(withEndedWin(final, 1, 0)).status).toBe('completed');
  });

  it('continues the 16th dealer turn when a winner has a rule-defined big hand', () => {
    const match = withEndedWin(
      { ...startMatch(createMatch()), effectiveDealerTurn: 16, isFinalDealerTurn: true },
      1,
      0,
    );
    const winner =
      match.currentHand.result?.type === 'win' && match.currentHand.result.source !== 'self-draw'
        ? match.currentHand.result.winners[0]
        : null;
    if (
      !winner ||
      match.currentHand.result?.type !== 'win' ||
      match.currentHand.result.source === 'self-draw'
    )
      throw new Error('Missing single-payer win result');
    const bigHand = {
      ...match,
      currentHand: {
        ...match.currentHand,
        result: {
          ...match.currentHand.result,
          winners: [
            {
              ...winner,
              evaluation: {
                ...winner.evaluation,
                patterns: ['men-qing', 'pure-one-suit'] as const,
              },
            },
          ],
        },
      },
    };

    expect(completeCurrentHand(bigHand).completedHands[0]?.reason).toBe('final-turn-continuation');
  });

  it('does not apply 16th-turn continuation facts on the 15th effective dealer turn', () => {
    const match = startMatch(createMatch());
    const fifteenth = {
      ...match,
      effectiveDealerTurn: 15,
      isFinalDealerTurn: false,
      currentHand: {
        ...match.currentHand,
        handProgressFacts: { ...match.currentHand.handProgressFacts, successfulAnGangCount: 1 },
      },
    };
    const completed = completeCurrentHand(withEndedWin(fifteenth, 1, 0));

    expect(completed.effectiveDealerTurn).toBe(16);
    expect(completed.dealerIndex).toBe(1);
    expect(completed.currentHandIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('normal-dealer-advance');
  });

  it('keeps a rob-BuGang result on the 16th turn and resets facts in the prepared hand', () => {
    const match = withEndedWin(
      { ...startMatch(createMatch()), effectiveDealerTurn: 16, isFinalDealerTurn: true },
      1,
      0,
    );
    if (match.currentHand.result?.type !== 'win' || match.currentHand.result.source === 'self-draw')
      throw new Error('Missing single-payer win result');
    const completed = completeCurrentHand({
      ...match,
      currentHand: {
        ...match.currentHand,
        result: { ...match.currentHand.result, source: 'rob-bu-gang' },
      },
    });

    expect(completed.status).toBe('playing');
    expect(completed.effectiveDealerTurn).toBe(16);
    expect(completed.dealerIndex).toBe(0);
    expect(completed.completedHands[0]?.reason).toBe('special-no-dealer-advance');

    const prepared = prepareNextHand(completed);
    expect(prepared.currentHandIndex).toBe(1);
    expect(prepared.currentHand.handProgressFacts).toEqual(createGame().handProgressFacts);
  });

  it('prepares the next ready hand after a completed hand', () => {
    const completedMatch = completeCurrentHand(
      withEndedWin(startMatch(createMatch({ dealerIndex: 3 })), 0, 3),
    );
    const nextHandMatch = prepareNextHand(completedMatch);

    expect(nextHandMatch.status).toBe('playing');
    expect(nextHandMatch.currentHandStatus).toBe('not-started');
    expect(nextHandMatch.currentHandIndex).toBe(1);
    expect(nextHandMatch.dealerIndex).toBe(0);
    expect(nextHandMatch.currentHand.phase).toBe('ready');
    expect(nextHandMatch.currentHand.dealerIndex).toBe(nextHandMatch.dealerIndex);
    expect(nextHandMatch.currentHand.currentPlayerIndex).toBe(nextHandMatch.dealerIndex);
    expect(nextHandMatch.currentHand.players.map((player) => player.isDealer)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(nextHandMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      nextHandMatch.currentHand.players.every((player) => player.discardPile.length === 0),
    ).toBe(true);
    expect(nextHandMatch.currentHand.nextMeldSequence).toBe(1);
  });

  it('starts the prepared current hand without changing cumulative scores', () => {
    const completedMatch = completeCurrentHand(withEndedWin(startMatch(createMatch()), 0, 1));
    const readyMatch = prepareNextHand(completedMatch);
    const startedMatch = startCurrentHand(readyMatch);

    expect(startedMatch.status).toBe('playing');
    expect(startedMatch.currentHandStatus).toBe('playing');
    expect(startedMatch.currentHand.phase).toBe('playing');
    expect(startedMatch.currentHand.dealerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      14, 13, 13, 13,
    ]);
    expect(
      startedMatch.currentHand.players.every((player) => player.hand.every(isOrdinaryHandTile)),
    ).toBe(true);
    expect(startedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });
});
describe('Nanjing Mahjong player state', () => {
  it('defines the four seats in canonical action order', () => {
    expect(SEATS).toEqual(['east', 'south', 'west', 'north']);
  });

  it('creates four empty players with stable ids, seats, and east as dealer', () => {
    const players = createInitialPlayers();

    expect(players).toHaveLength(4);
    expect(players.map((player) => player.id)).toEqual([0, 1, 2, 3]);
    expect(players.map((player) => player.seat)).toEqual(['east', 'south', 'west', 'north']);
    expect(players.map((player) => player.isDealer)).toEqual([true, false, false, false]);

    for (const player of players) {
      expect(player.hand).toEqual([]);
      expect(player.flowers).toEqual([]);
      expect(player.discardPile).toEqual([]);
    }
  });

  it('returns fresh player, hand, and flower arrays each time', () => {
    const firstPlayers = createInitialPlayers();
    const secondPlayers = createInitialPlayers();

    expect(firstPlayers).not.toBe(secondPlayers);
    expect(firstPlayers).toEqual(secondPlayers);

    for (let index = 0; index < firstPlayers.length; index += 1) {
      expect(firstPlayers[index]).not.toBe(secondPlayers[index]);
      expect(firstPlayers[index]?.hand).not.toBe(secondPlayers[index]?.hand);
      expect(firstPlayers[index]?.flowers).not.toBe(secondPlayers[index]?.flowers);
      expect(firstPlayers[index]?.discardPile).not.toBe(secondPlayers[index]?.discardPile);
    }
  });
});

describe('Nanjing Mahjong game state and turn advancement', () => {
  it('creates a fresh ready game with initial players, a full wall, and east dealer', () => {
    const firstGame = createInitialGame();
    const secondGame = createInitialGame();

    expect(firstGame).not.toBe(secondGame);
    expect(firstGame.players).not.toBe(secondGame.players);
    expect(firstGame.wall).not.toBe(secondGame.wall);
    expect(firstGame.players).toEqual(createInitialPlayers());
    expect(firstGame.ruleSetId).toBe('nanjing-open');
    expect(firstGame.wall.map((tile) => tile.id)).toEqual(
      createNanjingMahjongDeck().map((tile) => tile.id),
    );
    expect(firstGame.currentPlayerIndex).toBe(0);
    expect(firstGame.dealerIndex).toBe(0);
    expect(firstGame.phase).toBe('ready');
    expect(firstGame.turnStage).toBe('waiting-for-draw');
    expect(firstGame.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'draw',
    });
    expect(firstGame.pendingScoringEvents).toEqual([]);
    expect(firstGame.nextMeldSequence).toBe(1);
    expect(firstGame.players.every((player) => player.discardPile.length === 0)).toBe(true);
  });

  it('starts a ready game by dealing complete ordinary opening hands', () => {
    const readyGame = createInitialGame();
    const initialDeal = startGame(readyGame);
    expect(initialDeal.turnStage).toBe('waiting-for-di-hu-decision');
    expect(initialDeal.diHuDeclarations?.status).toBe('collecting');
    const playingGame = passInitialDiHuDecisions(initialDeal);

    expect(playingGame).not.toBe(readyGame);
    expect(playingGame.phase).toBe('playing');
    expect(playingGame.ruleSetId).toBe('nanjing-open');
    expect(playingGame.players.map((player) => player.hand)).not.toEqual(
      readyGame.players.map((player) => player.hand),
    );
    expect(playingGame.players.map((player) => player.hand.length)).toEqual([14, 13, 13, 13]);
    expect(playingGame.players.every((player) => player.hand.every(isOrdinaryHandTile))).toBe(true);
    expect(playingGame.players.every((player) => player.flowers.length === 0)).toBe(true);
    expect(playingGame.players.every((player) => player.discardPile.length === 0)).toBe(true);
    expect(playingGame.wall).toHaveLength(91);
    expect(playingGame.currentPlayerIndex).toBe(0);
    expect(playingGame.dealerIndex).toBe(0);
    expect(playingGame.turnStage).toBe('waiting-for-discard');
    expect(playingGame.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(playingGame.pendingScoringEvents).toEqual([]);
    expect(playingGame.nextMeldSequence).toBe(1);
    expect(readyGame.phase).toBe('ready');
    expect(readyGame.players.every((player) => player.hand.length === 0)).toBe(true);
  });

  it('lets the dealer discard first after startGame and opens a reaction window', () => {
    const playingGame = passInitialDiHuDecisions(startGame(createGame()));
    const dealerTile = playerAt(playingGame, playingGame.dealerIndex).hand[0];

    if (!dealerTile) {
      throw new Error('Expected dealer to have a tile to discard');
    }

    const nextState = applyAction(playingGame, {
      type: 'DISCARD_TILE',
      tileId: dealerTile.id,
    });

    expect(playingGame.turnStage).toBe('waiting-for-discard');
    expect(playingGame.pendingAction.type).toBe('discard');
    const discardRecord = playerAt(nextState, 0).discardPile[0];
    expect(discardRecord?.tile).toBe(dealerTile);
    expect(discardRecord?.tile.id).toBe(dealerTile.id);
    expect(discardRecord?.claimedByMeldId).toBeUndefined();
    expect(nextState.currentPlayerIndex).toBe(1);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'reaction',
    });
    expect(nextState.lastDiscard).toEqual({
      tile: dealerTile,
      tileId: dealerTile.id,
      fromPlayerIndex: 0,
      fromSeat: 'east',
    });
    expect(nextState.reactionWindow).toMatchObject({
      discardedTile: dealerTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      responses: [],
      status: 'open',
    });
  });

  it('appends a discard record after existing claimed history', () => {
    const deck = createNanjingMahjongDeck();
    const playingGame = passInitialDiHuDecisions(startGame(createGame()));
    const dealer = playerAt(playingGame, playingGame.dealerIndex);
    const discardedTile = dealer.hand[0];
    const oldRecord: DiscardRecord = {
      tile: ordinaryTileById(deck, 'wind-north-4'),
      claimedByMeldId: 'meld-6',
    };

    if (!discardedTile) {
      throw new Error('Expected dealer to have a tile to discard');
    }

    playingGame.players[playingGame.dealerIndex] = {
      ...dealer,
      discardPile: [oldRecord],
    };

    const nextState = applyAction(playingGame, {
      type: 'DISCARD_TILE',
      tileId: discardedTile.id,
    });
    const discardPile = playerAt(nextState, playingGame.dealerIndex).discardPile;

    expect(discardPile).toHaveLength(2);
    expect(discardPile[0]).toBe(oldRecord);
    expect(discardPile.map((record) => record.tile)).toEqual([oldRecord.tile, discardedTile]);
    expect(discardPile.map((record) => record.tile.id)).toEqual([
      oldRecord.tile.id,
      discardedTile.id,
    ]);
    expect(discardPile[0]?.claimedByMeldId).toBe('meld-6');
    expect(discardPile[1]?.claimedByMeldId).toBeUndefined();
  });

  it('moves flowers from the initial deal into the flower area and replaces from the tail', () => {
    const deck = createNanjingMahjongDeck();
    const dealtFlower = flowerTileById(deck, 'flower-red-center-1');
    const replacementTile = ordinaryTileById(deck, 'wind-north-1');
    const leftoverTile = ordinaryTileById(deck, 'wind-north-2');
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => tile.id !== replacementTile.id && tile.id !== leftoverTile.id)
      .slice(0, 52);
    const readyGame = {
      ...createGame(),
      wall: [dealtFlower, ...rawOrdinaryTiles, leftoverTile, replacementTile],
    };
    const playingGame = startGame(readyGame);
    const dealer = playerAt(playingGame, 0);

    expect(tileIds(dealer.flowers)).toEqual(['flower-red-center-1']);
    expect(dealer.hand).toHaveLength(14);
    expect(dealer.hand.every(isOrdinaryHandTile)).toBe(true);
    expect(tileIds(dealer.hand)).toContain('wind-north-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-north-2']);
    expect(playingGame.phase).toBe('playing');
  });

  it('runs initial flower replacement in dealer, next, opposite, upper order', () => {
    const deck = createNanjingMahjongDeck();
    const firstFourRawTiles = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'flower-white-board-1'),
      flowerTileById(deck, 'season-spring-1'),
    ];
    const eastReplacementTile = ordinaryTileById(deck, 'wind-east-1');
    const southReplacementTile = ordinaryTileById(deck, 'wind-south-1');
    const westReplacementTile = ordinaryTileById(deck, 'wind-west-1');
    const northReplacementTile = ordinaryTileById(deck, 'wind-north-1');
    const replacementTiles = [
      eastReplacementTile,
      southReplacementTile,
      westReplacementTile,
      northReplacementTile,
    ];
    const leftoverTile = ordinaryTileById(deck, 'wind-east-2');
    const excludedIds = new Set<TileId>([
      ...replacementTiles.map((tile) => tile.id),
      leftoverTile.id,
    ]);
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => !excludedIds.has(tile.id))
      .slice(0, 49);
    const readyGame = {
      ...createGame(),
      wall: [
        ...firstFourRawTiles,
        ...rawOrdinaryTiles,
        leftoverTile,
        northReplacementTile,
        westReplacementTile,
        southReplacementTile,
        eastReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame);

    expect(tileIds(playerAt(playingGame, 0).hand)).toContain('wind-east-1');
    expect(tileIds(playerAt(playingGame, 1).hand)).toContain('wind-south-1');
    expect(tileIds(playerAt(playingGame, 2).hand)).toContain('wind-west-1');
    expect(tileIds(playerAt(playingGame, 3).hand)).toContain('wind-north-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-east-2']);
  });

  it('runs initial flower replacement from a south dealer in logical seat order', () => {
    const deck = createNanjingMahjongDeck();
    const firstFourRawTiles = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'flower-white-board-1'),
      flowerTileById(deck, 'season-spring-1'),
    ];
    const southReplacementTile = ordinaryTileById(deck, 'wind-south-1');
    const westReplacementTile = ordinaryTileById(deck, 'wind-west-1');
    const northReplacementTile = ordinaryTileById(deck, 'wind-north-1');
    const eastReplacementTile = ordinaryTileById(deck, 'wind-east-1');
    const replacementTiles = [
      southReplacementTile,
      westReplacementTile,
      northReplacementTile,
      eastReplacementTile,
    ];
    const leftoverTile = ordinaryTileById(deck, 'wind-east-2');
    const excludedIds = new Set<TileId>([
      ...replacementTiles.map((tile) => tile.id),
      leftoverTile.id,
    ]);
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => !excludedIds.has(tile.id))
      .slice(0, 49);
    const readyGame = {
      ...createGame(),
      wall: [
        ...firstFourRawTiles,
        ...rawOrdinaryTiles,
        leftoverTile,
        eastReplacementTile,
        northReplacementTile,
        westReplacementTile,
        southReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame, { dealerSeat: 'south' });

    expect(playingGame.dealerIndex).toBe(1);
    expect(playingGame.currentPlayerIndex).toBe(1);
    expect(tileIds(playerAt(playingGame, 1).hand)).toContain('wind-south-1');
    expect(tileIds(playerAt(playingGame, 2).hand)).toContain('wind-west-1');
    expect(tileIds(playerAt(playingGame, 3).hand)).toContain('wind-north-1');
    expect(tileIds(playerAt(playingGame, 0).hand)).toContain('wind-east-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-east-2']);
  });
  it('keeps east as the default dealer for legacy startGame calls', () => {
    const playingGame = startGame(createGame());

    expect(playingGame.dealerIndex).toBe(0);
    expect(playingGame.currentPlayerIndex).toBe(0);
    expect(playingGame.players.map((player) => player.isDealer)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('supports explicit dealerSeat and dealerIndex options', () => {
    const westDealerGame = startGame(createGame(), { dealerSeat: 'west' });
    const northDealerGame = startGame(createGame(), { dealerIndex: 3 });

    expect(westDealerGame.dealerIndex).toBe(2);
    expect(westDealerGame.currentPlayerIndex).toBe(2);
    expect(westDealerGame.players.map((player) => player.hand.length)).toEqual([13, 13, 14, 13]);
    expect(westDealerGame.players.map((player) => player.isDealer)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(northDealerGame.dealerIndex).toBe(3);
    expect(northDealerGame.currentPlayerIndex).toBe(3);
    expect(northDealerGame.players.map((player) => player.hand.length)).toEqual([13, 13, 13, 14]);
  });

  it('accepts matching dealerSeat and dealerIndex options', () => {
    const playingGame = startGame(createGame(), { dealerSeat: 'west', dealerIndex: 2 });

    expect(playingGame.dealerIndex).toBe(2);
    expect(playingGame.currentPlayerIndex).toBe(2);
    expect(playingGame.players.map((player) => player.isDealer)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('rejects conflicting dealerSeat and dealerIndex options', () => {
    expect(() => startGame(createGame(), { dealerSeat: 'west', dealerIndex: 1 })).toThrow(
      'dealerIndex and dealerSeat must refer to the same player',
    );
  });
  it('records initial flower kong events as pending scoring without changing scores', () => {
    const deck = createNanjingMahjongDeck();
    const redCenters = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-red-center-2'),
      flowerTileById(deck, 'flower-red-center-3'),
      flowerTileById(deck, 'flower-red-center-4'),
    ];
    const ordinaryTiles = deck.filter(isOrdinaryHandTile);
    const rawOrdinaryTiles = [...ordinaryTiles.slice(0, 49)];
    const replacementTiles = ordinaryTiles.slice(49, 53);
    const leftoverTile = ordinaryTiles[53];
    const fallbackOrdinaryTile = ordinaryTiles[0];
    const [
      firstReplacementTile,
      secondReplacementTile,
      thirdReplacementTile,
      fourthReplacementTile,
    ] = replacementTiles;
    const rawTiles: MahjongTile[] = [];
    const redCenterPositions = new Set([0, 4, 8, 12]);

    if (
      !leftoverTile ||
      !fallbackOrdinaryTile ||
      !firstReplacementTile ||
      !secondReplacementTile ||
      !thirdReplacementTile ||
      !fourthReplacementTile
    ) {
      throw new Error('Missing ordinary tiles for flower kong test');
    }

    for (let index = 0; index < 53; index += 1) {
      rawTiles.push(
        redCenterPositions.has(index)
          ? (redCenters.shift() ?? rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile)
          : (rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile),
      );
    }

    const readyGame = {
      ...createGame(),
      wall: [
        ...rawTiles,
        leftoverTile,
        fourthReplacementTile,
        thirdReplacementTile,
        secondReplacementTile,
        firstReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame);

    expect(playingGame.pendingScoringEvents).toEqual([
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'initial-deal',
        transfers: flowerTransfers(0),
        status: 'pending',
      },
    ]);
    expect(tileIds(playerAt(playingGame, 0).flowers)).toEqual([
      'flower-red-center-1',
      'flower-red-center-2',
      'flower-red-center-3',
      'flower-red-center-4',
    ]);
    expect('score' in playerAt(playingGame, 0)).toBe(false);
  });

  it('exposes the engine as the public game state control layer', () => {
    const createOptions: GameCreationOptions = {};
    const startOptions: StartGameOptions = {};
    const legacyOptions: RuleSetOptions = createOptions;
    const createdGame = gameEngine.createGame(legacyOptions);

    expect(createdGame).toEqual(createGame());
    expect(gameEngine.startGame(createdGame, startOptions).phase).toBe('playing');
  });

  it('applies DRAW_TILE through the same engine turn advancement path', () => {
    const state = startGame(createGame());
    const action: GameAction = { type: 'DRAW_TILE' };

    expect(applyAction(state, action)).toEqual(advanceTurn(state));
    expect(gameEngine.applyAction(state, action)).toEqual(advanceTurn(state));
  });

  it('keeps PENG, GANG, and HU as structural placeholders during a reaction window', () => {
    const playingGame = startGame(createGame());
    const dealerTile = playerAt(playingGame, playingGame.dealerIndex).hand[0];

    if (!dealerTile) {
      throw new Error('Expected dealer to have a tile to discard');
    }

    const state = applyAction(playingGame, { type: 'DISCARD_TILE', tileId: dealerTile.id });
    const actions: GameAction[] = [{ type: 'PENG' }, { type: 'GANG' }, { type: 'HU' }];

    for (const action of actions) {
      const nextState = applyAction(state, action);

      expect(nextState).toEqual(state);
      expect(nextState).not.toBe(state);
      expect(nextState.players).not.toBe(state.players);
      expect(nextState.wall).not.toBe(state.wall);
    }
  });

  it('removes a discarded tile, records lastDiscard, and opens a reaction window', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-1-1');
    const keptTile = ordinaryTileById(deck, 'wind-east-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];

    if (!eastPlayer) {
      throw new Error('Missing east player');
    }

    players[0] = {
      ...eastPlayer,
      hand: [discardedTile, keptTile],
    };
    const pendingScoringEvents = [
      {
        type: 'flower-kong-created' as const,
        playerIndex: 0,
        seat: 'east' as const,
        kind: 'red-center' as const,
        createdDuring: 'initial-deal' as const,
        transfers: flowerTransfers(0),
        status: 'pending' as const,
      },
    ];
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [ordinaryTileById(deck, 'wan-9-1')],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: {
        playerIndex: 0,
        seat: 'east',
        type: 'discard',
      },
      pendingScoringEvents,
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };
    const action: GameAction = { type: 'DISCARD_TILE', tileId: discardedTile.id };
    const nextState = applyAction(state, action);

    expect(tileIds(playerAt(nextState, 0).hand)).toEqual(['wind-east-1']);
    expect(tileIds(playerAt(nextState, 0).discardPile.map((record) => record.tile))).toEqual([
      'wan-1-1',
    ]);
    expect(nextState.lastDiscard).toEqual({
      tile: discardedTile,
      tileId: discardedTile.id,
      fromPlayerIndex: 0,
      fromSeat: 'east',
    });
    expect(nextState.reactionWindow).toEqual({
      source: 'discard',
      discardedTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      availableReactions: [
        { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
        { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
        { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
      ],
      responses: [],
      status: 'open',
    });
    expect(nextState.currentPlayerIndex).toBe(1);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'reaction',
    });
    expect(nextState.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect(nextState).not.toBe(state);
    expect(nextState.players).not.toBe(state.players);
    expect(nextState.wall).not.toBe(state.wall);
    expect(tileIds(playerAt(state, 0).hand)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(playerAt(state, 0).discardPile).toEqual([]);
  });

  it('adds availableReactions in responder order with pass and peng for two matching ordinary tiles', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-3-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for reaction availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [ordinaryTileById(deck, 'wan-3-2'), ordinaryTileById(deck, 'wan-3-3')],
    };
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [ordinaryTileById(deck, 'wan-9-1')],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions).toEqual([
      { playerIndex: 1, seat: 'south', responseTypes: ['pass', 'peng'] },
      { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
      { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
    ] satisfies ReactionAvailability[]);
    expect(
      nextState.reactionWindow?.availableReactions.map((availability) => availability.playerIndex),
    ).toEqual(nextState.reactionWindow?.responderOrder.map((responder) => responder.playerIndex));
    expect(
      nextState.reactionWindow?.availableReactions.every((availability) =>
        availability.responseTypes.includes('pass'),
      ),
    ).toBe(true);
    expect(
      nextState.reactionWindow?.availableReactions.some((availability) =>
        availability.responseTypes.includes('hu'),
      ),
    ).toBe(false);
    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).not.toContain(
      'ming-gang',
    );
  });

  it.each([
    { wall: [] as OrdinaryHandTile[], canDrawFromWallTail: false },
    { wall: [ordinaryTileById(createNanjingMahjongDeck(), 'wan-9-1')], canDrawFromWallTail: true },
  ])(
    'passes isolated discard responder snapshots with wall-tail availability $canDrawFromWallTail',
    ({ wall, canDrawFromWallTail }) => {
      const deck = createNanjingMahjongDeck();
      const discardedTile = ordinaryTileById(deck, 'wan-3-1');
      const players = createInitialPlayers();
      players[0] = { ...players[0]!, hand: [discardedTile] };
      players[1] = {
        ...players[1]!,
        hand: [ordinaryTileById(deck, 'wan-3-2'), ordinaryTileById(deck, 'wan-3-3')],
        passHu: true,
      };
      const state: GameState = {
        ...createGame(),
        players,
        wall,
        phase: 'playing',
        turnStage: 'waiting-for-discard',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      };
      const availability = vi.spyOn(NANJING_OPEN_RULE_SET, 'getAvailableReactions');

      applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

      expect(availability).toHaveBeenCalledTimes(3);
      for (const call of availability.mock.calls) {
        expect(call).toHaveLength(1);
        expect(call[0]).not.toHaveProperty('players');
        expect(call[0]).not.toHaveProperty('wall');
        expect(call[0]).not.toHaveProperty('reactionWindow');
        expect(call[0]).not.toHaveProperty('pendingAction');
        expect(call[0]).not.toHaveProperty('phase');
        expect(call[0]).not.toHaveProperty('turnStage');
      }
      expect(availability.mock.calls[0]?.[0]).toMatchObject({
        source: 'discard',
        playerCount: 4,
        responderPlayerIndex: 1,
        responderSeat: 'south',
        responderConcealedTiles: players[1]?.hand,
        responderMelds: players[1]?.melds,
        responderFlowers: players[1]?.flowers,
        responderPassHu: true,
        fromPlayerIndex: 0,
        discardedTile,
        canDrawFromWallTail,
      });
      state.players[2] = { ...state.players[2]!, hand: [ordinaryTileById(deck, 'tong-9-1')] };
      expect(availability.mock.calls[0]?.[0]).not.toHaveProperty('players');
      availability.mockRestore();
    },
  );

  it('offers peng and ming-gang for three matching ordinary tiles without executing either', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'tong-6-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for ming-gang availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [
        ordinaryTileById(deck, 'tong-6-2'),
        ordinaryTileById(deck, 'tong-6-3'),
        ordinaryTileById(deck, 'tong-6-4'),
      ],
    };
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [ordinaryTileById(deck, 'wan-9-1')],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
      'pass',
      'peng',
      'ming-gang',
    ]);
    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).not.toContain('hu');
    expect(playerAt(nextState, 1).hand).toEqual(playerAt(state, 1).hand);
    expect(playerAt(nextState, 1).discardPile).toEqual([]);
    expect('cumulativeScores' in nextState).toBe(false);
  });

  it('treats wind tiles as ordinary tiles for reaction availability', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wind-east-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for wind availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [
        ordinaryTileById(deck, 'wind-east-2'),
        ordinaryTileById(deck, 'wind-east-3'),
        ordinaryTileById(deck, 'wind-east-4'),
      ],
    };
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [ordinaryTileById(deck, 'wan-9-1')],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
      'pass',
      'peng',
      'ming-gang',
    ]);
  });

  it.each([
    'flower-red-center-1',
    'flower-fortune-1',
    'flower-white-board-1',
    'season-spring-1',
  ] as const)('does not expose peng or ming-gang for flower discard %s', (tileId) => {
    const deck = createNanjingMahjongDeck();
    const players = createInitialPlayers();
    const discardedTile = flowerTileById(deck, tileId);
    const reactionWindow: ReactionWindow = {
      source: 'discard',
      discardedTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      availableReactions: [],
      responses: [],
      status: 'open',
    };
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 1,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-reaction',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'reaction' },
      reactionWindow,
      pendingScoringEvents: [],
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };

    expect(
      reactionWindow.responderOrder.map(({ playerIndex, seat }) => {
        const responder = state.players[playerIndex]!;
        return NANJING_OPEN_RULE_SET.getAvailableReactions({
          source: 'discard',
          playerCount: state.players.length,
          responderPlayerIndex: playerIndex,
          responderSeat: seat,
          responderConcealedTiles: responder.hand,
          responderMelds: responder.melds,
          responderFlowers: responder.flowers,
          responderPassHu: responder.passHu,
          allMelds: state.players.flatMap((player) => player.melds),
          fromPlayerIndex: 0,
          discardedTile,
          canDrawFromWallTail: false,
        });
      }),
    ).toEqual([
      { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
      { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
      { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
    ]);
  });

  it('keeps the same player waiting to discard after an ordinary head draw', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
      ordinaryTileById(deck, 'wan-1-3'),
      ordinaryTileById(deck, 'wan-1-4'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const nextState = advanceTurn(state);

    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.players.map((player) => player.seat)).toEqual([
      'east',
      'south',
      'west',
      'north',
    ]);
    expect(nextState.players.map((player) => tileIds(player.hand))).toEqual([
      ['wan-1-1'],
      [],
      [],
      [],
    ]);
    expect(nextState.players.every((player) => player.flowers.length === 0)).toBe(true);
    expect(tileIds(nextState.wall)).toEqual(['wan-1-2', 'wan-1-3', 'wan-1-4', 'wan-2-1']);
    expect(nextState.phase).toBe('playing');
  });

  it('orders responders from a south discard as west, north, east', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-2-1');
    const players = createInitialPlayers(1);
    const southPlayer = players[1];

    if (!southPlayer) {
      throw new Error('Missing south player');
    }

    players[1] = {
      ...southPlayer,
      hand: [discardedTile],
    };
    const state: GameState = {
      nextMeldSequence: 1,
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 1,
      dealerIndex: 1,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: {
        playerIndex: 1,
        seat: 'south',
        type: 'discard',
      },
      pendingScoringEvents: [],
      handProgressFacts: createGame().handProgressFacts,
      specialDiscardTracking: createGame().specialDiscardTracking,
      gangPackage: { status: 'none' },
      threeMouthState: createGame().threeMouthState,
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.responderOrder).toEqual([
      { playerIndex: 2, seat: 'west' },
      { playerIndex: 3, seat: 'north' },
      { playerIndex: 0, seat: 'east' },
    ]);
    expect(nextState.currentPlayerIndex).toBe(2);
    expect(nextState.pendingAction).toEqual({
      playerIndex: 2,
      seat: 'west',
      type: 'reaction',
    });
  });

  it('records a current responder PASS_REACTION and advances to the next responder', () => {
    const state = createWaitingForReactionState();
    const afterPass = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });

    expect(afterPass.reactionWindow?.responses).toEqual([
      { playerIndex: 1, seat: 'south', type: 'pass' },
    ]);
    expect(afterPass.currentPlayerIndex).toBe(2);
    expect(afterPass.pendingAction).toEqual({
      playerIndex: 2,
      seat: 'west',
      type: 'reaction',
    });
  });

  it('treats SUBMIT_REACTION pass the same as PASS_REACTION', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'pass' }),
    ).toEqual(applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 }));
  });

  it('ignores a non-current responder and a retried pass from the previous responder', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 2, responseType: 'pass' }),
    ).toBe(state);

    const afterPass = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });

    expect(applyAction(afterPass, { type: 'PASS_REACTION', playerIndex: 1 })).toBe(afterPass);
  });

  it.each([
    { playerIndex: -1, actionType: 'SUBMIT_REACTION' as const },
    { playerIndex: 4, actionType: 'PASS_REACTION' as const },
    { playerIndex: 1.5, actionType: 'SUBMIT_REACTION' as const },
  ])(
    'ignores runtime-invalid $actionType playerIndex $playerIndex',
    ({ playerIndex, actionType }) => {
      const state = createWaitingForReactionState();
      const responseCount = state.reactionWindow?.responses.length;
      const pendingAction = state.pendingAction;
      const currentPlayerIndex = state.currentPlayerIndex;
      const action: GameAction =
        actionType === 'PASS_REACTION'
          ? { type: actionType, playerIndex }
          : { type: actionType, playerIndex, responseType: 'pass' };

      const result = applyAction(state, action);

      expect(result).toBe(state);
      expect(result.reactionWindow?.responses).toHaveLength(responseCount ?? 0);
      expect(result.pendingAction).toBe(pendingAction);
      expect(result.currentPlayerIndex).toBe(currentPlayerIndex);
    },
  );
  it('accepts peng but rejects ming-gang with two matching tiles', () => {
    const deck = createNanjingMahjongDeck();
    const players = createInitialPlayers();
    const discardedTile = ordinaryTileById(deck, 'wan-3-1');
    players[0] = {
      ...playerAt({ ...createWaitingForReactionState(), players }, 0),
      hand: [discardedTile],
    };
    players[1] = {
      ...playerAt({ ...createWaitingForReactionState(), players }, 1),
      hand: [ordinaryTileById(deck, 'wan-3-2'), ordinaryTileById(deck, 'wan-3-3')],
    };
    const base: GameState = {
      ...createPlayingGameWithWall([]),
      players,
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    };
    const state = applyAction(base, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(
      applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(state);
    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' })
        .reactionWindow?.responses,
    ).toEqual([{ playerIndex: 1, seat: 'south', type: 'peng' }]);
  });

  it.each(['peng', 'ming-gang'] as const)(
    'accepts %s with three matching tiles before resolution',
    (responseType) => {
      const deck = createNanjingMahjongDeck();
      const players = createInitialPlayers();
      const discardedTile = ordinaryTileById(deck, 'tong-6-1');
      const eastPlayer = players[0];
      const southPlayer = players[1];

      if (!eastPlayer || !southPlayer) {
        throw new Error('Missing claim test players');
      }

      players[0] = { ...eastPlayer, hand: [discardedTile] };
      players[1] = {
        ...southPlayer,
        hand: [
          ordinaryTileById(deck, 'tong-6-2'),
          ordinaryTileById(deck, 'tong-6-3'),
          ordinaryTileById(deck, 'tong-6-4'),
        ],
      };
      const pendingScoringEvents: GameState['pendingScoringEvents'] = [
        {
          type: 'flower-kong-created',
          playerIndex: 0,
          seat: 'east',
          kind: 'red-center',
          createdDuring: 'initial-deal',
          transfers: flowerTransfers(0),
          status: 'pending',
        },
      ];
      const base: GameState = {
        ...createPlayingGameWithWall([ordinaryTileById(deck, 'wan-9-1')]),
        players,
        turnStage: 'waiting-for-discard',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
        pendingScoringEvents,
      };
      const state = applyAction(base, { type: 'DISCARD_TILE', tileId: discardedTile.id });
      const handsBefore = state.players.map((player) => tileIds(player.hand));

      const nextState = applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType,
      });

      expect(nextState.reactionWindow?.responses).toEqual([
        { playerIndex: 1, seat: 'south', type: responseType },
      ]);
      expect(nextState.reactionWindow?.status).toBe('open');
      expect(nextState.currentPlayerIndex).toBe(2);
      expect(nextState.pendingAction).toEqual({
        playerIndex: 2,
        seat: 'west',
        type: 'reaction',
      });
      expect(nextState.players.map((player) => tileIds(player.hand))).toEqual(handsBefore);
      expect(nextState.players.every((player) => player.melds.length === 0)).toBe(true);
      expect(nextState.pendingScoringEvents).toEqual(pendingScoringEvents);
      expect('cumulativeScores' in nextState).toBe(false);
      expect(
        applyAction(nextState, {
          type: 'SUBMIT_REACTION',
          playerIndex: 1,
          responseType: 'pass',
        }),
      ).toBe(nextState);

      const afterSecondResponse = applyAction(nextState, {
        type: 'PASS_REACTION',
        playerIndex: 2,
      });
      const afterThirdResponse = applyAction(afterSecondResponse, {
        type: 'PASS_REACTION',
        playerIndex: 3,
      });

      expect(afterThirdResponse.reactionWindow?.status).toBe('awaiting-resolution');
      expect(afterThirdResponse.pendingAction.type).toBe('none');
      expect(afterThirdResponse.players.map((player) => player.melds)).toEqual(
        state.players.map((player) => player.melds),
      );
      const resolved = applyAction(afterThirdResponse, { type: 'RESOLVE_REACTION_WINDOW' });

      expect(resolved).not.toBe(afterThirdResponse);
      expect(playerAt(resolved, 1).melds[0]?.type).toBe(responseType);
    },
  );

  it.each([
    'flower-red-center-1',
    'flower-fortune-1',
    'flower-white-board-1',
    'season-spring-1',
  ] as const)('rejects peng and ming-gang for flower discard %s', (tileId) => {
    const deck = createNanjingMahjongDeck();
    const base = createWaitingForReactionState();
    const baseWindow = base.reactionWindow;
    if (!baseWindow || baseWindow.source !== 'discard') {
      throw new Error('Expected discard reaction window');
    }
    const state: GameState = {
      ...base,
      reactionWindow: {
        ...baseWindow,
        discardedTile: flowerTileById(deck, tileId),
        availableReactions: [
          { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
          { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
          { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
        ],
      },
    };

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' }),
    ).toBe(state);
    expect(
      applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(state);
  });

  it('rejects hu because it is absent from availableReactions', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'hu' }),
    ).toBe(state);
  });

  it('ignores submissions with no window, a closed window, or a non-reaction state', () => {
    const noWindow = createPlayingGameWithWall([]);
    const open = createWaitingForReactionState();
    const closed: GameState = {
      ...open,
      reactionWindow: { ...open.reactionWindow!, status: 'closed' },
    };
    const notReaction: GameState = {
      ...open,
      turnStage: 'waiting-for-draw',
    };
    const action = {
      type: 'SUBMIT_REACTION' as const,
      playerIndex: 1,
      responseType: 'pass' as const,
    };

    expect(applyAction(noWindow, action)).toBe(noWindow);
    expect(applyAction(closed, action)).toBe(closed);
    expect(applyAction(notReaction, action)).toBe(notReaction);
  });
  it('ignores DISCARD_TILE while waiting for a reaction response', () => {
    const state = createWaitingForReactionState();
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-2' });

    expect(nextState).toEqual(state);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction.type).toBe('reaction');
  });
  it('awaits resolution after three passes, then resolves to the discarder next player draw', () => {
    const deck = createNanjingMahjongDeck();
    let state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-2-1'),
      ordinaryTileById(deck, 'wan-2-2'),
    ]);

    state = advanceTurn(state);
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
    const drawDuringReaction = advanceTurn(state);
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });

    const awaitingResolution = state;

    expect(applyAction(drawDuringReaction, { type: 'DRAW_TILE' })).toEqual(drawDuringReaction);
    expect(state.reactionWindow?.responses).toEqual([
      { playerIndex: 1, seat: 'south', type: 'pass' },
      { playerIndex: 2, seat: 'west', type: 'pass' },
      { playerIndex: 3, seat: 'north', type: 'pass' },
    ]);
    expect(state.reactionWindow?.status).toBe('awaiting-resolution');
    expect(state.currentPlayerIndex).toBe(3);
    expect(state.turnStage).toBe('waiting-for-reaction');
    expect(state.pendingAction).toEqual({ playerIndex: null, seat: null, type: 'none' });
    expect(applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 })).toBe(state);
    expect(applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' })).not.toBe(state);

    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(state.reactionWindow?.status).toBe('closed');
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.turnStage).toBe('waiting-for-draw');
    expect(state.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'draw',
    });
    expect(state.reactionWindow?.responses).toEqual(awaitingResolution.reactionWindow?.responses);
    expect(state.lastDiscard).toEqual(awaitingResolution.lastDiscard);
    expect(applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(state);
    expect(state.players.map((player) => tileIds(player.hand))).toEqual([[], [], [], []]);
    expect(tileIds(playerAt(state, 0).discardPile.map((record) => record.tile))).toEqual([
      'wan-2-1',
    ]);
  });

  it('atomically executes the only peng and preserves discard history and scoring state', () => {
    const pendingScoringEvents: GameState['pendingScoringEvents'] = [
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'initial-deal',
        transfers: flowerTransfers(0),
        status: 'pending',
      },
    ];
    const awaiting = {
      ...createAwaitingPengResolutionState({ nextMeldSequence: 7 }),
      pendingScoringEvents,
    };
    const oldDiscard = playerAt(awaiting, 0).discardPile[0];
    const result = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result).not.toBe(awaiting);
    expect(tileIds(playerAt(result, 1).hand)).toEqual([]);
    expect(playerAt(result, 1).melds).toEqual([
      {
        id: 'meld-7',
        type: 'peng',
        tiles: [
          expect.objectContaining({ id: 'wan-3-2' }),
          expect.objectContaining({ id: 'wan-3-3' }),
          expect.objectContaining({ id: 'wan-3-1' }),
        ],
        claimedTileId: 'wan-3-1',
        fromPlayerIndex: 0,
      },
    ]);
    expect(playerAt(result, 0).discardPile).toHaveLength(1);
    expect(playerAt(result, 0).discardPile[0]).toEqual({
      tile: oldDiscard?.tile,
      claimedByMeldId: 'meld-7',
    });
    expect(result.lastDiscard).toBeUndefined();
    expect(result.reactionWindow).toEqual({
      ...awaiting.reactionWindow,
      status: 'closed',
    });
    expect(result.currentPlayerIndex).toBe(1);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(result.nextMeldSequence).toBe(8);
    expect(result.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect(applyAction(result, { type: 'DRAW_TILE' })).toBe(result);
    expect(applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(result);
  });

  it('executes meld-1 and lets the peng player discard into a new reaction window', () => {
    const pendingScoringEvents: GameState['pendingScoringEvents'] = [
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'initial-deal',
        transfers: flowerTransfers(0),
        status: 'pending',
      },
    ];
    const awaiting: GameState = {
      ...createAwaitingPengResolutionState({
        matchingTileIds: ['wan-3-2', 'wan-3-3', 'tiao-5-1'],
      }),
      pendingScoringEvents,
    };

    expect(awaiting.nextMeldSequence).toBe(1);

    const resolved = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });
    const meld = playerAt(resolved, 1).melds[0];

    expect(resolved.nextMeldSequence).toBe(2);
    expect(meld).toEqual({
      id: 'meld-1',
      type: 'peng',
      tiles: [
        expect.objectContaining({ id: 'wan-3-2' }),
        expect.objectContaining({ id: 'wan-3-3' }),
        expect.objectContaining({ id: 'wan-3-1' }),
      ],
      claimedTileId: 'wan-3-1',
      fromPlayerIndex: 0,
    });
    expect(playerAt(resolved, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(resolved.currentPlayerIndex).toBe(1);
    expect(resolved.turnStage).toBe('waiting-for-discard');
    expect(resolved.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(applyAction(resolved, { type: 'DRAW_TILE' })).toBe(resolved);

    const discardedTile = playerAt(resolved, 1).hand[0];

    if (!discardedTile) {
      throw new Error('Missing post-peng discard tile');
    }

    const afterDiscard = applyAction(resolved, {
      type: 'DISCARD_TILE',
      tileId: discardedTile.id,
    });

    expect(afterDiscard).not.toBe(resolved);
    expect(tileIds(playerAt(afterDiscard, 1).hand)).not.toContain(discardedTile.id);
    expect(playerAt(afterDiscard, 1).discardPile).toHaveLength(
      playerAt(resolved, 1).discardPile.length + 1,
    );
    expect(playerAt(afterDiscard, 1).discardPile.at(-1)).toEqual({ tile: discardedTile });
    expect(playerAt(afterDiscard, 1).discardPile.at(-1)?.claimedByMeldId).toBeUndefined();
    expect(afterDiscard.lastDiscard).toEqual({
      tile: discardedTile,
      tileId: discardedTile.id,
      fromPlayerIndex: 1,
      fromSeat: 'south',
    });
    expect(afterDiscard.reactionWindow).toMatchObject({
      status: 'open',
      discardedTile,
      fromPlayerIndex: 1,
      fromSeat: 'south',
      responses: [],
      responderOrder: [
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
        { playerIndex: 0, seat: 'east' },
      ],
    });
    expect(afterDiscard.turnStage).toBe('waiting-for-reaction');
    expect(afterDiscard.pendingAction).toEqual({
      playerIndex: 2,
      seat: 'west',
      type: 'reaction',
    });
    expect(playerAt(afterDiscard, 1).melds[0]).toEqual(meld);
    expect(playerAt(afterDiscard, 0).discardPile[0]?.claimedByMeldId).toBe('meld-1');
    expect(afterDiscard.nextMeldSequence).toBe(2);
    expect(afterDiscard.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect('cumulativeScores' in afterDiscard).toBe(false);
  });

  it('selects the two lowest tile IDs for peng while preserving remaining hand order', () => {
    const awaiting = createAwaitingPengResolutionState({
      matchingTileIds: ['wan-3-4', 'tiao-5-1', 'wan-3-2', 'wan-3-3'],
    });
    const result = applyAction(awaiting, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(tileIds(playerAt(result, 1).melds[0]?.tiles ?? [])).toEqual([
      'wan-3-2',
      'wan-3-3',
      'wan-3-1',
    ]);
    expect(tileIds(playerAt(result, 1).hand)).toEqual(['wan-3-4', 'tiao-5-1']);
    expect(playerAt(result, 1).hand[1]).toBe(playerAt(awaiting, 1).hand[1]);
  });

  it('claims only the latest discard record and leaves earlier history unchanged', () => {
    const deck = createNanjingMahjongDeck();
    const awaiting = createAwaitingPengResolutionState();
    const earlier = { tile: ordinaryTileById(deck, 'tiao-1-1') };
    const discarder = playerAt(awaiting, 0);
    const state: GameState = {
      ...awaiting,
      players: awaiting.players.map((player, index) =>
        index === 0 ? { ...discarder, discardPile: [earlier, ...discarder.discardPile] } : player,
      ),
    };
    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(playerAt(result, 0).discardPile[0]).toBe(earlier);
    expect(playerAt(result, 0).discardPile[1]?.claimedByMeldId).toBe('meld-1');
  });

  it.each([
    [
      'insufficient matching tiles',
      (state: GameState) => ({
        ...state,
        players: state.players.map((player, index) =>
          index === 1 ? { ...player, hand: player.hand.slice(0, 1) } : player,
        ),
      }),
    ],
    [
      'claimed latest discard',
      (state: GameState) => ({
        ...state,
        players: state.players.map((player, index) =>
          index === 0
            ? {
                ...player,
                discardPile: player.discardPile.map((record) => ({
                  ...record,
                  claimedByMeldId: 'meld-old',
                })),
              }
            : player,
        ),
      }),
    ],
    [
      'missing lastDiscard',
      (state: GameState) => {
        const withoutLastDiscard = { ...state };
        delete withoutLastDiscard.lastDiscard;
        return withoutLastDiscard;
      },
    ],
    [
      'mismatched lastDiscard source',
      (state: GameState) => ({
        ...state,
        lastDiscard: { ...state.lastDiscard!, fromPlayerIndex: 2 },
      }),
    ],
    ['non-positive sequence', (state: GameState) => ({ ...state, nextMeldSequence: 0 })],
    ['negative sequence', (state: GameState) => ({ ...state, nextMeldSequence: -1 })],
    ['non-integer sequence', (state: GameState) => ({ ...state, nextMeldSequence: 1.5 })],
    [
      'mismatched lastDiscard tile',
      (state: GameState) => {
        const deck = createNanjingMahjongDeck();

        if (!state.lastDiscard) {
          throw new Error('Missing lastDiscard for mismatch test');
        }

        return {
          ...state,
          lastDiscard: {
            ...state.lastDiscard,
            tile: ordinaryTileById(deck, 'tiao-1-1'),
          },
        };
      },
    ],
    [
      'latest discard record does not match target',
      (state: GameState) => {
        const deck = createNanjingMahjongDeck();
        const discarder = playerAt(state, 0);

        return {
          ...state,
          players: state.players.map((player, index) =>
            index === 0
              ? {
                  ...discarder,
                  discardPile: [
                    ...discarder.discardPile,
                    { tile: ordinaryTileById(deck, 'tiao-1-1') },
                  ],
                }
              : player,
          ),
        };
      },
    ],
    [
      'availability does not contain peng',
      (state: GameState) => {
        const window = state.reactionWindow;

        if (!window) {
          throw new Error('Missing reaction window for availability test');
        }

        return {
          ...state,
          reactionWindow: {
            ...window,
            availableReactions: window.availableReactions.map((availability) =>
              availability.playerIndex === 1
                ? { ...availability, responseTypes: ['pass'] as const }
                : availability,
            ),
          },
        };
      },
    ],
    [
      'two peng responses',
      (state: GameState) => {
        const window = state.reactionWindow;

        if (!window) {
          throw new Error('Missing reaction window for two peng test');
        }

        return {
          ...state,
          reactionWindow: {
            ...window,
            responses: window.responses.map((response, index) =>
              index === 1 ? { ...response, type: 'peng' as const } : response,
            ),
          },
        };
      },
    ],
    [
      'response contains hu',
      (state: GameState) => {
        const window = state.reactionWindow;

        if (!window) {
          throw new Error('Missing reaction window for hu test');
        }

        return {
          ...state,
          reactionWindow: {
            ...window,
            responses: window.responses.map((response, index) =>
              index === 0 ? { ...response, type: 'hu' as const } : response,
            ),
          },
        };
      },
    ],
    [
      'three non-pass responses',
      (state: GameState) => {
        const window = state.reactionWindow;
        const responseTypes = ['peng', 'ming-gang', 'peng'] as const;

        if (!window) {
          throw new Error('Missing reaction window for three non-pass test');
        }

        return {
          ...state,
          reactionWindow: {
            ...window,
            responses: window.responses.map((response, index) => ({
              ...response,
              type: responseTypes[index] ?? 'peng',
            })),
          },
        };
      },
    ],
    [
      'multiple non-pass responses',
      (state: GameState) => {
        const deck = createNanjingMahjongDeck();
        return {
          ...state,
          wall: [ordinaryTileById(deck, 'wan-9-1')],
          reactionWindow: {
            ...state.reactionWindow!,
            responses: state.reactionWindow!.responses.map((response, index) =>
              index === 1 ? { ...response, type: 'ming-gang' as const } : response,
            ),
          },
        };
      },
    ],
    [
      'unsupported ming-gang',
      (state: GameState) => {
        const deck = createNanjingMahjongDeck();
        return {
          ...state,
          wall: [ordinaryTileById(deck, 'wan-9-1')],
          reactionWindow: {
            ...state.reactionWindow!,
            responses: state.reactionWindow!.responses.map((response) =>
              response.type === 'peng' ? { ...response, type: 'ming-gang' as const } : response,
            ),
          },
        };
      },
    ],
  ] as const)('returns the original state for invalid peng resolution: %s', (_name, alter) => {
    const state = alter(createAwaitingPengResolutionState());

    expectPengResolutionNoop(state);
  });

  it('ignores early resolution and draw or discard while awaiting reaction resolution', () => {
    const open = createWaitingForReactionState();

    expect(applyAction(open, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(open);

    let awaiting = applyAction(open, { type: 'PASS_REACTION', playerIndex: 1 });
    awaiting = applyAction(awaiting, { type: 'PASS_REACTION', playerIndex: 2 });
    awaiting = applyAction(awaiting, { type: 'PASS_REACTION', playerIndex: 3 });

    expect(applyAction(awaiting, { type: 'DRAW_TILE' })).toBe(awaiting);
    expect(applyAction(awaiting, { type: 'DISCARD_TILE', tileId: 'wan-2-2' })).toBe(awaiting);
  });

  it('ignores draw actions until the pending player is waiting to draw', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
    ]);
    const waitingForDiscard = advanceTurn(state);
    const afterSecondDrawIntent = advanceTurn(waitingForDiscard);

    expect(afterSecondDrawIntent).toBe(waitingForDiscard);
  });

  it('moves a drawn flower to the flower area, draws one replacement from the tail, and waits for discard', () => {
    const deck = createNanjingMahjongDeck();
    const initialState = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const nextState = advanceTurn(initialState);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1']);
    expect(tileIds(currentPlayer.hand)).toEqual(['wan-2-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
    expect(playerAt(initialState, 0).hand).toEqual([]);
    expect(playerAt(initialState, 0).flowers).toEqual([]);
    expect(tileIds(initialState.wall)).toEqual(['flower-red-center-1', 'tiao-2-1', 'wan-2-1']);
  });

  it('keeps replacing when a tail replacement is also a flower', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1', 'season-summer-1']);
    expect(tileIds(currentPlayer.hand)).toEqual(['tong-3-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
  });

  it('records consecutive tail flowers before the ordinary replacement tile', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual([
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(tileIds(currentPlayer.hand)).toEqual(['tong-3-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
  });

  it('ends the game when the wall cannot provide a legal draw or replacement', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(nextState.phase).toBe('ended');
    expect(nextState.turnStage).toBe('hand-ended');
    expect(nextState.pendingAction).toEqual({
      playerIndex: null,
      seat: null,
      type: 'none',
    });
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.wall).toEqual([]);
    expect(currentPlayer.hand).toEqual([]);
    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1', 'flower-fortune-1']);
  });

  it('keeps the discard opportunity when the final ordinary head draw exhausts the wall', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([ordinaryTileById(deck, 'wan-1-1')]);

    const nextState = advanceTurn(state);

    expect(nextState.phase).toBe('playing');
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.wall).toEqual([]);
    expect(tileIds(playerAt(nextState, 0).hand)).toEqual(['wan-1-1']);
    expect(nextState.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: 'wan-1-1',
      source: 'wall-head',
    });
    expect(playerAt(state, 0).hand).toEqual([]);
    expect(tileIds(state.wall)).toEqual(['wan-1-1']);
  });
});
describe('Nanjing Mahjong tile deck', () => {
  it('creates the complete 144-tile deck with stable unique ids', () => {
    const deck = createNanjingMahjongDeck();
    const ids = deck.map((tile) => tile.id);

    expect(deck).toHaveLength(144);
    expect(new Set(ids).size).toBe(144);
    expect(ids.slice(0, 4)).toEqual(['wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4']);
    expect(ids.at(-1)).toBe('season-winter-1');
  });

  it('returns a fresh deck array with stable tile contents and fresh tile objects each time', () => {
    const firstDeck = createNanjingMahjongDeck();
    const secondDeck = createNanjingMahjongDeck();

    expect(firstDeck).not.toBe(secondDeck);
    expect(firstDeck).toEqual(secondDeck);

    for (let index = 0; index < firstDeck.length; index += 1) {
      expect(firstDeck[index]).not.toBe(secondDeck[index]);
    }
  });

  it('keeps generated deck order independent from mutations to previous returned arrays', () => {
    const firstDeck = createNanjingMahjongDeck();
    const secondDeck = createNanjingMahjongDeck();
    const stableIds = secondDeck.map((tile) => tile.id);

    firstDeck.pop();
    firstDeck.reverse();
    firstDeck.splice(0, 3);

    expect(secondDeck).toHaveLength(144);
    expect(secondDeck.map((tile) => tile.id)).toEqual(stableIds);

    const freshDeck = createNanjingMahjongDeck();

    expect(freshDeck).toHaveLength(144);
    expect(freshDeck.map((tile) => tile.id)).toEqual(stableIds);
    expect(freshDeck.slice(0, 4).map((tile) => tile.id)).toEqual([
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-1-4',
    ]);
    expect(freshDeck.at(-1)?.id).toBe('season-winter-1');
  });

  it('contains four copies of every suited number tile', () => {
    const deck = createNanjingMahjongDeck();
    const numberTiles = deck.filter(isNumberTile);

    expect(numberTiles).toHaveLength(108);

    for (const suit of NUMBER_TILE_SUITS) {
      for (let rank = 1; rank <= 9; rank += 1) {
        const copies = numberTiles.filter((tile) => tile.suit === suit && tile.rank === rank);

        expect(copies.map((tile) => tile.copy)).toEqual([1, 2, 3, 4]);
        expect(copies.map((tile) => tile.id)).toEqual([
          `${suit}-${rank}-1`,
          `${suit}-${rank}-2`,
          `${suit}-${rank}-3`,
          `${suit}-${rank}-4`,
        ]);
      }
    }
  });

  it('contains four copies of every wind tile', () => {
    const deck = createNanjingMahjongDeck();
    const windTiles = deck.filter(isWindTile);

    expect(windTiles).toHaveLength(16);

    for (const wind of WIND_TILE_KINDS) {
      const copies = windTiles.filter((tile) => tile.wind === wind);

      expect(copies.map((tile) => tile.copy)).toEqual([1, 2, 3, 4]);
      expect(copies.map((tile) => tile.id)).toEqual([
        `wind-${wind}-1`,
        `wind-${wind}-2`,
        `wind-${wind}-3`,
        `wind-${wind}-4`,
      ]);
    }
  });

  it('contains exactly 124 ordinary hand tiles split into 108 number tiles and 16 wind tiles', () => {
    const deck = createNanjingMahjongDeck();
    const ordinaryHandTiles = deck.filter(isOrdinaryHandTile);

    expect(ordinaryHandTiles).toHaveLength(124);
    expect(ordinaryHandTiles.filter(isNumberTile)).toHaveLength(108);
    expect(ordinaryHandTiles.filter(isWindTile)).toHaveLength(16);
    expect(ordinaryHandTiles.every(isOrdinaryHandTile)).toBe(true);
    expect(ordinaryHandTiles.every((tile) => !requiresFlowerReveal(tile))).toBe(true);
  });

  it('models red center, fortune, white board, plants, and seasons as flower tiles', () => {
    const deck = createNanjingMahjongDeck();
    const flowerTiles = deck.filter(isFlowerTile);

    expect(flowerTiles).toHaveLength(20);

    for (const flower of FLOWER_TILE_KINDS) {
      const copies = flowerTiles.filter((tile) => tile.flower === flower);
      const expectedCopies =
        flower === 'red-center' || flower === 'fortune' || flower === 'white-board' ? 4 : 1;

      expect(copies).toHaveLength(expectedCopies);
      expect(copies.every(requiresFlowerReveal)).toBe(true);
      expect(copies.every(isOrdinaryHandTile)).toBe(false);
    }

    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-red-center-1');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-fortune-4');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-white-board-4');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-plum-1');
    expect(flowerTiles.map((tile) => tile.id)).toContain('season-spring-1');
  });

  it('classifies all 20 flower tiles as reveal-only non-hand tiles', () => {
    const deck = createNanjingMahjongDeck();
    const flowerTiles = deck.filter(isFlowerTile);

    expect(flowerTiles).toHaveLength(20);
    expect(flowerTiles.every(isFlowerTile)).toBe(true);
    expect(flowerTiles.every(isOrdinaryHandTile)).toBe(false);
    expect(flowerTiles.every(requiresFlowerReveal)).toBe(true);
  });

  it('distinguishes ordinary hand tiles from tiles that must be revealed for flower replacement', () => {
    const deck = createNanjingMahjongDeck();
    const [wanOne] = deck.filter((tile) => tile.id === 'wan-1-1');
    const [eastWind] = deck.filter((tile) => tile.id === 'wind-east-1');
    const [redCenter] = deck.filter((tile) => tile.id === 'flower-red-center-1');

    expect(wanOne).toBeDefined();
    expect(eastWind).toBeDefined();
    expect(redCenter).toBeDefined();

    expect(wanOne && isOrdinaryHandTile(wanOne)).toBe(true);
    expect(eastWind && isOrdinaryHandTile(eastWind)).toBe(true);
    expect(redCenter && isOrdinaryHandTile(redCenter)).toBe(false);

    expect(wanOne && requiresFlowerReveal(wanOne)).toBe(false);
    expect(eastWind && requiresFlowerReveal(eastWind)).toBe(false);
    expect(redCenter && requiresFlowerReveal(redCenter)).toBe(true);
  });

  it('places every tile in exactly one primary tile category', () => {
    const deck = createNanjingMahjongDeck();

    expect(deck).toHaveLength(144);

    for (const tile of deck) {
      const matchingCategories = [isNumberTile(tile), isWindTile(tile), isFlowerTile(tile)].filter(
        Boolean,
      );

      expect(matchingCategories).toHaveLength(1);
    }
  });
});
describe('Nanjing Mahjong tile wall and flower replacement', () => {
  it('creates a 144-tile wall from the current fixed deck order without shuffling', () => {
    const deck = createNanjingMahjongDeck();
    const wall = createNanjingMahjongTileWall();

    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(deck.map((tile) => tile.id));
    expect(wall.tiles).not.toBe(deck);
  });

  it('creates fresh wall objects and tile arrays from the same tile sequence', () => {
    const deck = createNanjingMahjongDeck();
    const tiles = [ordinaryTileById(deck, 'wan-1-1'), flowerTileById(deck, 'season-spring-1')];
    const firstWall = createTileWall(tiles);
    const secondWall = createTileWall(tiles);

    expect(firstWall).not.toBe(secondWall);
    expect(firstWall.tiles).not.toBe(secondWall.tiles);
    expect(firstWall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'season-spring-1']);
    expect(secondWall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'season-spring-1']);
  });

  it('keeps a created wall independent from later mutations to the source tile array', () => {
    const deck = createNanjingMahjongDeck();
    const sourceTiles: MahjongTile[] = [
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wind-east-1'),
    ];
    const wall = createTileWall(sourceTiles);

    sourceTiles.reverse();
    sourceTiles.pop();
    sourceTiles.push(flowerTileById(deck, 'flower-red-center-1'));

    expect(sourceTiles.map((tile) => tile.id)).toEqual(['wind-east-1', 'flower-red-center-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
  });

  it('draws a normal tile from the head of the wall without mutating the input wall', () => {
    const wall = createNanjingMahjongTileWall();
    const result = drawTileFromWallHead(wall);

    expect(result.status).toBe('drawn');

    if (result.status !== 'drawn') {
      throw new Error('Expected a head draw to succeed');
    }

    expect(result.tile.id).toBe('wan-1-1');
    expect(result.wall.tiles).toHaveLength(143);
    expect(result.wall.tiles[0]?.id).toBe('wan-1-2');
    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles[0]?.id).toBe('wan-1-1');
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('draws a replacement tile from the tail of the wall without mutating the input wall', () => {
    const wall = createNanjingMahjongTileWall();
    const result = drawTileFromWallTail(wall);

    expect(result.status).toBe('drawn');

    if (result.status !== 'drawn') {
      throw new Error('Expected a tail draw to succeed');
    }

    expect(result.tile.id).toBe('season-winter-1');
    expect(result.wall.tiles).toHaveLength(143);
    expect(result.wall.tiles.at(-1)?.id).toBe('season-autumn-1');
    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles.at(-1)?.id).toBe('season-winter-1');
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('returns a clear exhausted result when drawing from an empty wall', () => {
    const wall = createTileWall([]);
    const headResult = drawTileFromWallHead(wall);
    const tailResult = drawTileFromWallTail(wall);

    expect(headResult.status).toBe('wall-exhausted');
    expect(tailResult.status).toBe('wall-exhausted');
    expect(headResult.wall.tiles).toEqual([]);
    expect(tailResult.wall.tiles).toEqual([]);
    expect(headResult.wall).not.toBe(wall);
    expect(tailResult.wall).not.toBe(wall);
    expect(headResult.wall.tiles).not.toBe(wall.tiles);
    expect(tailResult.wall.tiles).not.toBe(wall.tiles);
  });

  it('does not draw from the tail when an initial hand has no flowers', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [ordinaryTileById(deck, 'wan-1-1'), ordinaryTileById(deck, 'wind-east-1')];
    const existingFlowers = [flowerTileById(deck, 'season-spring-1')];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: existingFlowers,
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(result.newlyRevealedFlowers).toEqual([]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.wall.tiles).toHaveLength(2);
    expect(initialHand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(existingFlowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
  });

  it('replaces two initial flowers and records replacement and tail flower order', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'wind-east-1'),
      flowerTileById(deck, 'flower-white-board-1'),
    ];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wind-east-1', 'wan-2-1', 'tong-3-1']);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.newlyRevealedFlowers.slice(2).map((tile) => tile.id)).toEqual([
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1', 'tong-3-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual([
      'tiao-2-1',
      'tong-3-1',
      'season-summer-1',
      'flower-fortune-1',
      'wan-2-1',
    ]);
  });

  it('reveals flowers from one player hand and keeps drawing from the tail until ordinary tiles replace them', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      ordinaryTileById(deck, 'wan-1-1'),
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'wind-east-1'),
    ];
    const existingFlowers = [flowerTileById(deck, 'season-spring-1')];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: existingFlowers,
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1', 'tiao-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(result.wall.tiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual([
      'wan-1-1',
      'flower-red-center-1',
      'wind-east-1',
    ]);
    expect(existingFlowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.hand).not.toBe(initialHand);
    expect(result.flowers).not.toBe(existingFlowers);
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('fails flower replacement with an exhausted result when the final available replacement tile is also a flower', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [flowerTileById(deck, 'flower-red-center-1')];
    const wall = createTileWall([flowerTileById(deck, 'flower-fortune-1')]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand).toEqual([]);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.wall.tiles).toEqual([]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual(['flower-red-center-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1']);
  });

  it('keeps partial initial flower replacement records when the wall exhausts after a normal replacement', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-white-board-1'),
    ];
    const wall = createTileWall([
      flowerTileById(deck, 'flower-fortune-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.wall.tiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
    ]);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1', 'wan-2-1']);
  });

  it('adds a single drawn ordinary tile to the hand without consuming the wall', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = ordinaryTileById(deck, 'wind-east-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(result.newlyRevealedFlowers).toEqual([]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
  });

  it('reveals a single drawn flower and replaces it with a tail ordinary tile', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wan-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual(['flower-red-center-1']);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'wan-2-1']);
  });

  it('continues revealing tail flowers after a drawn flower until a normal replacement tile appears', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'tong-3-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['tong-3-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual([
      'tiao-2-1',
      'tong-3-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
  });

  it('returns wall-exhausted after a drawn flower when only tail flowers remain', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles).toEqual([]);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1', 'season-summer-1']);
  });
});
