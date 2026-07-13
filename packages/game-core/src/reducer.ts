import { copyPlayers, createInitialPlayers, SEATS } from './player';
import type { PlayerState } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type {
  DeclareAnGangAction,
  DeclareBuGangAction,
  DiscardAction,
  GameAction,
  ReactionResponseType,
} from './actions';
import type { GameCreationOptions, StartGameOptions } from './options';
import {
  FOUR_COPY_FLOWER_KINDS,
  FOUR_COPY_INDEXES,
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  PLANT_FLOWER_KINDS,
  SEASON_FLOWER_KINDS,
  WIND_TILE_KINDS,
  isSameOrdinaryTileFace,
} from './state';
import type {
  DrawTileFromWallResult,
  DrawnTileResolutionResult,
  BuGangReactionWindow,
  DiscardReactionWindow,
  FlowerKongKind,
  FlowerReplacementResult,
  FlowerTile,
  GameState,
  HandProgressFacts,
  HandResult,
  HuSource,
  MahjongTile,
  NumberTile,
  OrdinaryTileFace,
  OrdinaryHandTile,
  PendingAction,
  PendingScoringEvent,
  ReactionResponse,
  ReactionWindow,
  ScoringEventCreationStage,
  SinglePlayerFlowerReplacementInput,
  SinglePlayerFlowerReplacementResult,
  TileWall,
  WindTile,
} from './state';

export type {
  ClaimReactionAction,
  DeclareAnGangAction,
  DeclareBuGangAction,
  DiscardAction,
  DrawAction,
  GameAction,
  PassReactionAction,
  ReactionAction,
  ReactionResponseType,
  ResolveReactionWindowAction,
  SubmitReactionAction,
  StartGameAction,
} from './actions';

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return startGameState(state, {
        ruleSetId: action.ruleSetId,
        dealerIndex: action.dealerIndex,
        dealerSeat: action.dealerSeat,
      });
    case 'DRAW_TILE':
      return drawReducer(state);
    case 'DISCARD_TILE':
    case 'DISCARDED_TILE':
      return discardReducer(state, action);
    case 'PASS_REACTION':
      return submitReactionReducer(state, action.playerIndex, 'pass');
    case 'SUBMIT_REACTION':
      return submitReactionReducer(state, action.playerIndex, action.responseType);
    case 'RESOLVE_REACTION_WINDOW':
      return resolveReactionWindowReducer(state);
    case 'DECLARE_AN_GANG':
      return declareAnGangReducer(state, action);
    case 'DECLARE_BU_GANG':
      return declareBuGangReducer(state, action);
    case 'PENG':
    case 'GANG':
    case 'HU':
      return reactionReducer(state);
  }
}

export interface AvailableBuGang {
  readonly targetMeldId: string;
  readonly tileFace: OrdinaryTileFace;
}

export function getAvailableBuGangs(state: GameState, playerIndex: number): AvailableBuGang[] {
  return findBuGangCandidates(state, playerIndex).map((candidate) => ({
    targetMeldId: candidate.meld.id,
    tileFace: ordinaryTileFace(candidate.tile),
  }));
}

export function getAvailableAnGangs(state: GameState, playerIndex: number): OrdinaryTileFace[] {
  if (!isAnGangTurn(state, playerIndex)) return [];
  const player = state.players[playerIndex];
  if (!player || !Array.isArray(player.hand) || !player.hand.every(isValidOrdinaryTile)) return [];

  const faces: OrdinaryTileFace[] = [];
  for (const tile of player.hand) {
    const tileFace = ordinaryTileFace(tile);
    if (faces.some((candidate) => isSameOrdinaryTileFaceValue(candidate, tileFace))) continue;
    const candidates = matchingAnGangTiles(player.hand, tileFace);
    if (
      candidates.length >= 4 &&
      new Set(candidates.map((candidate) => candidate.id)).size === candidates.length
    ) {
      faces.push(tileFace);
    }
  }

  return faces.sort(compareOrdinaryTileFaces).map((tileFace) => ({ ...tileFace }));
}

export function declareAnGangReducer(state: GameState, action: DeclareAnGangAction): GameState {
  if (
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0 ||
    !isValidOrdinaryTileFace(action.tileFace) ||
    !getAvailableAnGangs(state, action.playerIndex).some((tileFace) =>
      isSameOrdinaryTileFaceValue(tileFace, action.tileFace),
    )
  ) {
    return state;
  }

  const player = state.players[action.playerIndex];
  if (!player) return state;
  const candidates = matchingAnGangTiles(player.hand, action.tileFace).sort(compareTilesById);
  if (new Set(candidates.map((tile) => tile.id)).size !== candidates.length) return state;
  const selectedTiles = candidates.slice(0, 4);
  if (selectedTiles.length !== 4) return state;

  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));
  if (tailDraw.status === 'wall-exhausted') return state;
  const selectedIds = new Set(selectedTiles.map((tile) => tile.id));
  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    player.hand.filter((tile) => !selectedIds.has(tile.id)),
    player.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const meldId = `meld-${state.nextMeldSequence}`;
  const transfers = getRuleSet(state.ruleSetId)
    .getAnGangScoreTransfers({
      playerIndex: action.playerIndex,
      playerCount: state.players.length,
      meldId,
    })
    .map((transfer) => ({ ...transfer }));
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'an-gang-created',
      playerIndex: action.playerIndex,
      meldId,
      transfers,
      status: 'pending',
    },
  ];
  const players = state.players.map((candidate, index) =>
    index === action.playerIndex
      ? addBuGangDrawProvenance(
          {
            ...candidate,
            hand: [...drawResolution.hand],
            flowers: [...drawResolution.flowers],
            melds: [
              ...candidate.melds,
              { id: meldId, type: 'an-gang' as const, tiles: [...selectedTiles] },
            ],
            buGangDrawProvenance: candidate.buGangDrawProvenance.filter(
              (provenance) => !selectedIds.has(provenance.tileId),
            ),
          },
          newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
        )
      : candidate,
  );
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    scoringEvents,
    player,
    action.playerIndex,
    player.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  const nextState: GameState = {
    ...state,
    nextMeldSequence: state.nextMeldSequence + 1,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: action.playerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, action.playerIndex, 'discard'),
    pendingScoringEvents,
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulAnGangCount: state.handProgressFacts.successfulAnGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
  };

  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

export function declareBuGangReducer(state: GameState, action: DeclareBuGangAction): GameState {
  if (
    !Number.isInteger(action.playerIndex) ||
    typeof action.meldId !== 'string' ||
    action.meldId.length === 0
  ) {
    return state;
  }
  const candidate = findBuGangCandidates(state, action.playerIndex).find(
    (value) => value.meld.id === action.meldId,
  );
  const declarer = state.players[action.playerIndex];
  if (!candidate || !declarer) return state;

  const responderOrder = createResponderOrder(state.players, action.playerIndex);
  const windowShell: BuGangReactionWindow = {
    source: 'bu-gang',
    intent: {
      declarerPlayerIndex: action.playerIndex,
      declarerSeat: declarer.seat,
      targetMeldId: candidate.meld.id,
      tile: candidate.tile,
    },
    responderOrder,
    availableReactions: [],
    responses: [],
    status: 'open',
  };
  const firstResponder = responderOrder[0];
  if (!firstResponder) return state;
  const stateForAvailability: GameState = {
    ...copyGameState(state),
    currentPlayerIndex: action.playerIndex,
    turnStage: 'waiting-for-reaction',
    pendingAction: createPendingAction(state.players, firstResponder.playerIndex, 'reaction'),
    reactionWindow: windowShell,
  };
  return {
    ...stateForAvailability,
    reactionWindow: {
      ...windowShell,
      availableReactions: [
        ...getRuleSet(state.ruleSetId).getAvailableReactions(stateForAvailability, windowShell),
      ],
    },
  };
}

export function drawReducer(state: GameState): GameState {
  if (state.phase !== 'playing' || state.turnStage !== 'waiting-for-draw') {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (!currentPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  const headDraw = drawTileFromWallHead(createTileWall(state.wall));

  if (headDraw.status === 'wall-exhausted') {
    return markHandEnded({
      ...copyGameState(state),
      wall: [...headDraw.wall.tiles],
    });
  }

  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    currentPlayer.hand,
    currentPlayer.flowers,
    headDraw.tile,
    headDraw.wall,
  );
  const players = copyPlayers(state.players);
  const copiedPlayer = players[state.currentPlayerIndex];

  if (!copiedPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  players[state.currentPlayerIndex] = {
    ...copiedPlayer,
    hand: [...drawResolution.hand],
    flowers: [...drawResolution.flowers],
  };
  players[state.currentPlayerIndex] = addBuGangDrawProvenance(
    players[state.currentPlayerIndex]!,
    newlyDrawnOrdinaryTile(headDraw.tile, drawResolution),
  );

  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    state.pendingScoringEvents ?? [],
    currentPlayer,
    state.currentPlayerIndex,
    currentPlayer.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );

  const nextState: GameState = {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, state.currentPlayerIndex, 'discard'),
    pendingScoringEvents,
    handProgressFacts: addFlowerKongFacts(
      state.handProgressFacts,
      state.pendingScoringEvents,
      pendingScoringEvents,
    ),
  };

  return drawResolution.status === 'wall-exhausted' || drawResolution.wall.tiles.length === 0
    ? markHandEnded(nextState)
    : nextState;
}

export function discardReducer(state: GameState, action: DiscardAction): GameState {
  if (state.phase !== 'playing' || state.turnStage !== 'waiting-for-discard') {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (!currentPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  const discardedTileIndex = currentPlayer.hand.findIndex((tile) => tile.id === action.tileId);

  if (discardedTileIndex === -1) {
    throw new Error(`Current player ${currentPlayer.id} cannot discard tile ${action.tileId}`);
  }

  const discardedTile = currentPlayer.hand[discardedTileIndex];

  if (!discardedTile) {
    throw new Error(`Current player ${currentPlayer.id} cannot discard tile ${action.tileId}`);
  }

  const players = copyPlayers(state.players);
  const copiedPlayer = players[state.currentPlayerIndex];

  if (!copiedPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  players[state.currentPlayerIndex] = {
    ...copiedPlayer,
    passHu: false,
    hand: [
      ...copiedPlayer.hand.slice(0, discardedTileIndex),
      ...copiedPlayer.hand.slice(discardedTileIndex + 1),
    ],
    discardPile: [...copiedPlayer.discardPile, { tile: discardedTile }],
    buGangDrawProvenance: copiedPlayer.buGangDrawProvenance.filter(
      (provenance) => provenance.tileId !== discardedTile.id,
    ),
  };

  const reactionWindowShell = createReactionWindow(
    players,
    state.currentPlayerIndex,
    discardedTile,
  );
  const firstResponder = reactionWindowShell.responderOrder[0];

  if (!firstResponder) {
    throw new Error('Reaction window must have at least one responder');
  }

  const pendingAction = createPendingAction(players, firstResponder.playerIndex, 'reaction');
  const lastDiscard = {
    tile: discardedTile,
    tileId: discardedTile.id,
    fromPlayerIndex: state.currentPlayerIndex,
    fromSeat: copiedPlayer.seat,
  };
  const stateForAvailability: GameState = {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...state.wall],
    currentPlayerIndex: firstResponder.playerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-reaction',
    pendingAction,
    lastDiscard,
    reactionWindow: reactionWindowShell,
    pendingScoringEvents: [...(state.pendingScoringEvents ?? [])],
    handProgressFacts: state.handProgressFacts,
  };
  const reactionWindow: ReactionWindow = {
    ...reactionWindowShell,
    availableReactions: [
      ...getRuleSet(state.ruleSetId).getAvailableReactions(
        stateForAvailability,
        reactionWindowShell,
      ),
    ],
  };

  return {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...state.wall],
    currentPlayerIndex: firstResponder.playerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-reaction',
    pendingAction,
    lastDiscard,
    reactionWindow,
    pendingScoringEvents: [...(state.pendingScoringEvents ?? [])],
    handProgressFacts: state.handProgressFacts,
  };
}

export function passReactionReducer(state: GameState, playerIndex: number): GameState {
  return submitReactionReducer(state, playerIndex, 'pass');
}

export function submitReactionReducer(
  state: GameState,
  playerIndex: number,
  responseType: ReactionResponseType,
): GameState {
  if (
    state.reactionWindow &&
    state.reactionWindow.source !== 'discard' &&
    state.reactionWindow.source !== 'bu-gang'
  ) {
    return state;
  }
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= state.players.length) {
    return state;
  }

  const currentResponder =
    state.reactionWindow?.responderOrder[state.reactionWindow.responses.length];

  if (
    state.phase !== 'playing' ||
    state.turnStage !== 'waiting-for-reaction' ||
    state.reactionWindow?.status !== 'open' ||
    state.pendingAction.type !== 'reaction' ||
    state.pendingAction.playerIndex !== playerIndex ||
    currentResponder?.playerIndex !== playerIndex ||
    (state.reactionWindow.source === 'discard' && state.currentPlayerIndex !== playerIndex) ||
    (state.reactionWindow.source === 'bu-gang' &&
      state.currentPlayerIndex !== state.reactionWindow.intent.declarerPlayerIndex)
  ) {
    return state;
  }

  const availability = state.reactionWindow.availableReactions.find(
    (candidate) => candidate.playerIndex === playerIndex,
  );

  if (!availability?.responseTypes.includes(responseType)) {
    return state;
  }

  const response: ReactionResponse = {
    playerIndex: currentResponder.playerIndex,
    seat: currentResponder.seat,
    type: responseType,
  };
  const players =
    state.reactionWindow.source === 'discard' &&
    responseType !== 'hu' &&
    availability.responseTypes.includes('hu')
      ? state.players.map((player, index) =>
          index === playerIndex ? { ...player, passHu: true } : player,
        )
      : state.players;
  const responses = [...state.reactionWindow.responses, response];
  const nextResponder = state.reactionWindow.responderOrder[responses.length];
  const reactionWindow: ReactionWindow = {
    ...state.reactionWindow,
    responses,
    status: nextResponder ? 'open' : 'awaiting-resolution',
  };

  if (nextResponder) {
    return {
      ...copyGameState(state),
      players: copyPlayers(players),
      currentPlayerIndex:
        reactionWindow.source === 'discard'
          ? nextResponder.playerIndex
          : reactionWindow.intent.declarerPlayerIndex,
      turnStage: 'waiting-for-reaction',
      pendingAction: createPendingAction(state.players, nextResponder.playerIndex, 'reaction'),
      reactionWindow,
    };
  }

  return {
    ...copyGameState(state),
    players: copyPlayers(players),
    currentPlayerIndex:
      reactionWindow.source === 'discard'
        ? currentResponder.playerIndex
        : reactionWindow.intent.declarerPlayerIndex,
    turnStage: 'waiting-for-reaction',
    pendingAction: createNoPendingAction(),
    reactionWindow,
  };
}

export function resolveReactionWindowReducer(state: GameState): GameState {
  const window = state.reactionWindow;

  if (window && window.source !== 'discard' && window.source !== 'bu-gang') return state;

  if (
    state.phase !== 'playing' ||
    state.turnStage !== 'waiting-for-reaction' ||
    window?.status !== 'awaiting-resolution' ||
    state.pendingAction.type !== 'none' ||
    window.responses.length !== window.responderOrder.length ||
    window.responderOrder.some(
      (responder) =>
        window.responses.filter((response) => response.playerIndex === responder.playerIndex)
          .length !== 1,
    )
  ) {
    return state;
  }

  const nonPassResponses = window.responses.filter((response) => response.type !== 'pass');
  const huResponses = nonPassResponses.filter((response) => response.type === 'hu');

  if (huResponses.length > 0) {
    return resolveHu(state, window, huResponses);
  }

  if (window.source === 'bu-gang') {
    return nonPassResponses.length === 0 ? finalizeBuGang(state, window) : state;
  }

  if (nonPassResponses.length === 1 && nonPassResponses[0]?.type === 'peng') {
    return resolvePeng(state, window, nonPassResponses[0]);
  }

  if (nonPassResponses.length === 1 && nonPassResponses[0]?.type === 'ming-gang') {
    return resolveMingGang(state, window, nonPassResponses[0]);
  }

  if (nonPassResponses.length !== 0) {
    return state;
  }

  const nextDrawPlayerIndex = nextPlayerIndex(window.fromPlayerIndex);

  return {
    ...copyGameState(state),
    currentPlayerIndex: nextDrawPlayerIndex,
    turnStage: 'waiting-for-draw',
    pendingAction: createPendingAction(state.players, nextDrawPlayerIndex, 'draw'),
    reactionWindow: { ...window, status: 'closed' },
  };
}

function resolveMingGang(
  state: GameState,
  window: DiscardReactionWindow,
  response: ReactionResponse,
): GameState {
  const playerIndex = response.playerIndex;
  const player = state.players[playerIndex];
  const discarder = state.players[window.fromPlayerIndex];
  const discardedTile = window.discardedTile;
  const lastDiscard = state.lastDiscard;
  const latestDiscard = discarder?.discardPile.at(-1);

  if (
    !Number.isInteger(playerIndex) ||
    playerIndex < 0 ||
    playerIndex >= state.players.length ||
    !player ||
    response.seat !== player.seat ||
    !discarder ||
    window.fromPlayerIndex === playerIndex ||
    window.fromSeat !== discarder.seat ||
    !isOrdinaryHandTile(discardedTile) ||
    !window.availableReactions.some(
      (availability) =>
        availability.playerIndex === playerIndex &&
        availability.seat === player.seat &&
        availability.responseTypes.includes('ming-gang'),
    ) ||
    !lastDiscard ||
    lastDiscard.tile.id !== discardedTile.id ||
    lastDiscard.tileId !== discardedTile.id ||
    lastDiscard.fromPlayerIndex !== window.fromPlayerIndex ||
    lastDiscard.fromSeat !== window.fromSeat ||
    !latestDiscard ||
    latestDiscard.tile.id !== discardedTile.id ||
    latestDiscard.claimedByMeldId !== undefined ||
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0 ||
    state.wall.length === 0
  ) {
    return state;
  }

  const selectedTiles = player.hand
    .filter((tile) => isSameOrdinaryTileFace(tile, discardedTile))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, 3);

  if (selectedTiles.length !== 3) {
    return state;
  }

  const selectedIds = new Set(selectedTiles.map((tile) => tile.id));

  if (selectedIds.size !== 3 || selectedIds.has(discardedTile.id)) {
    return state;
  }

  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));

  if (tailDraw.status === 'wall-exhausted') {
    return state;
  }

  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    player.hand.filter((tile) => !selectedIds.has(tile.id)),
    player.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const meldId = `meld-${state.nextMeldSequence}`;
  const meld = {
    id: meldId,
    type: 'ming-gang' as const,
    tiles: [...selectedTiles, discardedTile],
    claimedTileId: discardedTile.id,
    fromPlayerIndex: window.fromPlayerIndex,
  };
  const players = state.players.map((candidate, index) => {
    if (index === playerIndex) {
      return addBuGangDrawProvenance(
        {
          ...candidate,
          hand: [...drawResolution.hand],
          flowers: [...drawResolution.flowers],
          melds: [...candidate.melds, meld],
          buGangDrawProvenance: candidate.buGangDrawProvenance.filter(
            (provenance) => !selectedIds.has(provenance.tileId),
          ),
        },
        newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
      );
    }

    if (index === window.fromPlayerIndex) {
      return {
        ...candidate,
        discardPile: candidate.discardPile.map((record, recordIndex) =>
          recordIndex === candidate.discardPile.length - 1
            ? { ...record, claimedByMeldId: meldId }
            : record,
        ),
      };
    }

    return candidate;
  });
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'ming-gang-created',
      receiverPlayerIndex: playerIndex,
      payerPlayerIndex: window.fromPlayerIndex,
      meldId,
      transfers: getRuleSet(state.ruleSetId).getMingGangScoreTransfers({
        receiverPlayerIndex: playerIndex,
        payerPlayerIndex: window.fromPlayerIndex,
        playerCount: state.players.length,
        meldId,
      }),
      status: 'pending',
    },
  ];
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    scoringEvents,
    player,
    playerIndex,
    player.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  const nextState: GameState = {
    nextMeldSequence: state.nextMeldSequence + 1,
    ruleSetId: state.ruleSetId,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: playerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, playerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    pendingScoringEvents,
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulMingOrBuGangCount: state.handProgressFacts.successfulMingOrBuGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
  };

  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

function resolvePeng(
  state: GameState,
  window: DiscardReactionWindow,
  response: ReactionResponse,
): GameState {
  const pengPlayerIndex = response.playerIndex;
  const pengPlayer = state.players[pengPlayerIndex];
  const discarder = state.players[window.fromPlayerIndex];
  const lastDiscard = state.lastDiscard;
  const discardedTile = window.discardedTile;
  const latestDiscardRecord = discarder?.discardPile.at(-1);

  if (
    !Number.isInteger(pengPlayerIndex) ||
    pengPlayerIndex < 0 ||
    pengPlayerIndex >= state.players.length ||
    !pengPlayer ||
    response.seat !== pengPlayer.seat ||
    !discarder ||
    window.fromPlayerIndex === pengPlayerIndex ||
    window.fromSeat !== discarder.seat ||
    !isOrdinaryHandTile(discardedTile) ||
    !window.availableReactions.some(
      (availability) =>
        availability.playerIndex === pengPlayerIndex &&
        availability.seat === pengPlayer.seat &&
        availability.responseTypes.includes('peng'),
    ) ||
    !lastDiscard ||
    lastDiscard.tile.id !== discardedTile.id ||
    lastDiscard.tileId !== discardedTile.id ||
    lastDiscard.fromPlayerIndex !== window.fromPlayerIndex ||
    lastDiscard.fromSeat !== window.fromSeat ||
    !latestDiscardRecord ||
    latestDiscardRecord.tile.id !== discardedTile.id ||
    latestDiscardRecord.claimedByMeldId !== undefined ||
    !Number.isInteger(state.nextMeldSequence) ||
    state.nextMeldSequence <= 0
  ) {
    return state;
  }

  const matchingTiles = pengPlayer.hand
    .filter((tile) => isSameOrdinaryTileFace(tile, discardedTile))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const selectedTiles = matchingTiles.slice(0, 2);

  if (selectedTiles.length !== 2) {
    return state;
  }

  const meldId = `meld-${state.nextMeldSequence}`;
  const selectedTileIds = new Set(selectedTiles.map((tile) => tile.id));
  const meld = {
    id: meldId,
    type: 'peng' as const,
    tiles: [...selectedTiles, discardedTile],
    claimedTileId: discardedTile.id,
    fromPlayerIndex: window.fromPlayerIndex,
  };
  const players = state.players.map((player, playerIndex) => {
    if (playerIndex === pengPlayerIndex) {
      return {
        ...player,
        hand: player.hand.filter((tile) => !selectedTileIds.has(tile.id)),
        melds: [...player.melds, meld],
        buGangDrawProvenance: player.buGangDrawProvenance.filter(
          (provenance) => !selectedTileIds.has(provenance.tileId),
        ),
      };
    }

    if (playerIndex === window.fromPlayerIndex) {
      return {
        ...player,
        discardPile: player.discardPile.map((record, recordIndex) =>
          recordIndex === player.discardPile.length - 1
            ? { ...record, claimedByMeldId: meldId }
            : record,
        ),
      };
    }

    return player;
  });
  const stateWithoutLastDiscard = { ...state };
  delete stateWithoutLastDiscard.lastDiscard;

  return {
    ...stateWithoutLastDiscard,
    players,
    currentPlayerIndex: pengPlayerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, pengPlayerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    nextMeldSequence: state.nextMeldSequence + 1,
  };
}

function resolveHu(
  state: GameState,
  window: ReactionWindow,
  huResponses: readonly ReactionResponse[],
): GameState {
  const targetTile =
    window.source === 'discard'
      ? isOrdinaryHandTile(window.discardedTile)
        ? window.discardedTile
        : null
      : window.intent.tile;
  const payerPlayerIndex =
    window.source === 'discard' ? window.fromPlayerIndex : window.intent.declarerPlayerIndex;
  if (!targetTile) return state;
  const pendingIntent =
    window.source === 'bu-gang' ? validatePendingBuGangIntent(state, window) : null;
  if (window.source === 'bu-gang' && !pendingIntent) return state;

  const ruleSet = getRuleSet(state.ruleSetId);
  const winners = huResponses.map((response) => {
    const player = state.players[response.playerIndex];
    const availability = window.availableReactions.find(
      (candidate) => candidate.playerIndex === response.playerIndex,
    );
    if (!player || !availability?.responseTypes.includes('hu')) return null;
    const evaluation = ruleSet.evaluateHu({
      source: window.source === 'discard' ? 'discard' : 'rob-bu-gang',
      winnerPlayerIndex: response.playerIndex,
      payerPlayerIndex,
      playerCount: state.players.length,
      winningTile: targetTile,
      concealedTiles: player.hand,
      melds: player.melds,
      flowers: player.flowers,
      allMelds: state.players.flatMap((candidate) => candidate.melds),
    });
    return evaluation ? { playerIndex: response.playerIndex, evaluation } : null;
  });
  if (winners.some((winner) => winner === null)) return state;
  const validWinners = winners.filter((winner) => winner !== null);
  if (validWinners.length === 0) return state;

  const source: HuSource = window.source === 'discard' ? 'discard' : 'rob-bu-gang';
  const pendingScoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    ...validWinners.map((winner) => ({
      type: 'hu-resolved' as const,
      source,
      winnerPlayerIndex: winner.playerIndex,
      payerPlayerIndex,
      winningTile: targetTile,
      evaluation: winner.evaluation,
      transfers: ruleSet
        .getHuScoreTransfers({
          source,
          winnerPlayerIndex: winner.playerIndex,
          payerPlayerIndex,
          playerCount: state.players.length,
          evaluation: winner.evaluation,
        })
        .map((transfer) => ({ ...transfer })),
      status: 'pending' as const,
    })),
  ];
  const players =
    window.source === 'bu-gang' && pendingIntent
      ? state.players.map((player, index) =>
          index === payerPlayerIndex
            ? {
                ...player,
                hand: player.hand.filter((tile) => tile.id !== pendingIntent.tile.id),
                buGangDrawProvenance: player.buGangDrawProvenance.filter(
                  (provenance) => provenance.tileId !== pendingIntent.tile.id,
                ),
              }
            : player,
        )
      : state.players;

  return {
    ...copyGameState(state),
    players: copyPlayers(players),
    currentPlayerIndex: payerPlayerIndex,
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: createNoPendingAction(),
    reactionWindow: { ...window, status: 'closed' },
    pendingScoringEvents,
    result: {
      type: 'win',
      source,
      winningTile: targetTile,
      payerPlayerIndex,
      winners: validWinners,
    },
  };
}

function finalizeBuGang(state: GameState, window: BuGangReactionWindow): GameState {
  const pendingIntent = validatePendingBuGangIntent(state, window);
  if (!pendingIntent || state.wall.length === 0) return state;
  const { declarer, meld, tile } = pendingIntent;
  const payerPlayerIndex = meld.fromPlayerIndex;
  if (payerPlayerIndex === undefined) return state;
  const tailDraw = drawTileFromWallTail(createTileWall(state.wall));
  if (tailDraw.status === 'wall-exhausted') return state;
  const drawResolution = resolveDrawnTileWithFlowerReplacement(
    declarer.hand.filter((candidate) => candidate.id !== tile.id),
    declarer.flowers,
    tailDraw.tile,
    tailDraw.wall,
  );
  const upgradedMeld = { ...meld, type: 'bu-gang' as const, tiles: [...meld.tiles, tile] };
  const players = state.players.map((player, index) =>
    index === window.intent.declarerPlayerIndex
      ? addBuGangDrawProvenance(
          {
            ...player,
            hand: [...drawResolution.hand],
            flowers: [...drawResolution.flowers],
            melds: player.melds.map((candidate) =>
              candidate.id === meld.id ? upgradedMeld : candidate,
            ),
            buGangDrawProvenance: player.buGangDrawProvenance.filter(
              (provenance) => provenance.targetMeldId !== meld.id && provenance.tileId !== tile.id,
            ),
          },
          newlyDrawnOrdinaryTile(tailDraw.tile, drawResolution),
        )
      : player,
  );
  const scoringEvents: PendingScoringEvent[] = [
    ...state.pendingScoringEvents,
    {
      type: 'bu-gang-created',
      playerIndex: window.intent.declarerPlayerIndex,
      payerPlayerIndex,
      meldId: meld.id,
      transfers: getRuleSet(state.ruleSetId)
        .getBuGangScoreTransfers({
          playerIndex: window.intent.declarerPlayerIndex,
          payerPlayerIndex,
          playerCount: state.players.length,
          meldId: meld.id,
        })
        .map((transfer) => ({ ...transfer })),
      status: 'pending',
    },
  ];
  const pendingScoringEvents = appendRuntimeFlowerKongEvents(
    state.ruleSetId,
    scoringEvents,
    declarer,
    window.intent.declarerPlayerIndex,
    declarer.flowers,
    drawResolution.newlyRevealedFlowers,
    drawResolution.status === 'wall-exhausted',
  );
  const nextState: GameState = {
    ...state,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: window.intent.declarerPlayerIndex,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, window.intent.declarerPlayerIndex, 'discard'),
    reactionWindow: { ...window, status: 'closed' },
    pendingScoringEvents,
    handProgressFacts: addFlowerKongFacts(
      {
        ...state.handProgressFacts,
        successfulMingOrBuGangCount: state.handProgressFacts.successfulMingOrBuGangCount + 1,
      },
      scoringEvents,
      pendingScoringEvents,
    ),
  };
  return drawResolution.status === 'wall-exhausted' ? markHandEnded(nextState) : nextState;
}

interface ValidPendingBuGangIntent {
  readonly declarer: PlayerState;
  readonly meld: PlayerState['melds'][number];
  readonly tile: OrdinaryHandTile;
}

function validatePendingBuGangIntent(
  state: GameState,
  window: BuGangReactionWindow,
): ValidPendingBuGangIntent | null {
  const declarer = state.players[window.intent.declarerPlayerIndex];
  if (
    !declarer ||
    declarer.seat !== window.intent.declarerSeat ||
    state.currentPlayerIndex !== window.intent.declarerPlayerIndex ||
    !isValidOrdinaryTile(window.intent.tile) ||
    !Array.isArray(declarer.buGangDrawProvenance) ||
    !declarer.buGangDrawProvenance.every(isValidBuGangDrawProvenance)
  ) {
    return null;
  }
  const meld = declarer.melds.find((candidate) => candidate.id === window.intent.targetMeldId);
  const tile = declarer.hand.find((candidate) => candidate.id === window.intent.tile.id);
  const provenance = declarer.buGangDrawProvenance.filter(
    (candidate) => candidate.targetMeldId === window.intent.targetMeldId,
  );
  if (
    !meld ||
    meld.type !== 'peng' ||
    !tile ||
    !isValidPengMeld(meld, window.intent.declarerPlayerIndex) ||
    !isSameOrdinaryTileFace(tile, window.intent.tile) ||
    provenance.length !== 1 ||
    provenance[0]?.tileId !== tile.id ||
    !meld.tiles.every((candidate) => isSameOrdinaryTileFace(candidate, tile)) ||
    new Set([...meld.tiles.map((candidate) => candidate.id), tile.id]).size !== 4
  ) {
    return null;
  }
  return { declarer, meld, tile };
}
export function reactionReducer(state: GameState): GameState {
  return copyGameState(state);
}

export function createGameState(options: GameCreationOptions = {}): GameState {
  const ruleSet = getRuleSet(options.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const dealerIndex = resolveDealerIndex(options, 0);

  const players = createInitialPlayers(dealerIndex);

  return {
    nextMeldSequence: 1,
    ruleSetId: ruleSet.id,
    players,
    wall: createNanjingMahjongDeck(),
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'ready',
    turnStage: 'waiting-for-draw',
    pendingAction: createPendingAction(players, dealerIndex, 'draw'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
  };
}

export function startGameState(state: GameState, options: StartGameOptions = {}): GameState {
  const ruleSet = getRuleSet(options.ruleSetId ?? state.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const dealerIndex = resolveDealerIndex(options, state.dealerIndex);

  if (state.phase !== 'ready') {
    return {
      ...copyGameState(state),
      ruleSetId: ruleSet.id,
    };
  }

  const players = createInitialPlayers(dealerIndex);

  return dealInitialHands({
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: ruleSet.id,
    players,
    wall: [...state.wall],
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, dealerIndex, 'discard'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
  });
}

function dealInitialHands(state: GameState): GameState {
  let wall = createTileWall(state.wall);
  const players = copyPlayers(state.players);
  const rawHands = players.map((): MahjongTile[] => []);
  const targetCounts = players.map((_, index) => (index === state.dealerIndex ? 14 : 13));

  while (targetCounts.some((targetCount, index) => rawHands[index]?.length !== targetCount)) {
    for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
      const targetCount = targetCounts[playerIndex];

      if (targetCount === undefined) {
        throw new Error(`Invalid player index ${playerIndex}`);
      }

      if ((rawHands[playerIndex]?.length ?? 0) >= targetCount) {
        continue;
      }

      const drawResult = drawTileFromWallHead(wall);

      if (drawResult.status === 'wall-exhausted') {
        return finishInitialDealFromRawHands(state, players, rawHands, drawResult.wall, 'ended');
      }

      rawHands[playerIndex]?.push(drawResult.tile);
      wall = drawResult.wall;
    }
  }

  let pendingScoringEvents: PendingScoringEvent[] = [];
  let handProgressFacts = createEmptyHandProgressFacts();

  for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
    const player = players[playerIndex];

    if (!player) {
      throw new Error(`Invalid player index ${playerIndex}`);
    }

    const previousEvents = pendingScoringEvents;
    pendingScoringEvents = appendFlowerKongEvents(
      state.ruleSetId,
      pendingScoringEvents,
      player,
      playerIndex,
      rawHands[playerIndex]?.filter(isFlowerTile) ?? [],
      'initial-deal',
    );
    handProgressFacts = addFlowerKongFacts(handProgressFacts, previousEvents, pendingScoringEvents);
  }

  let phase: GameState['phase'] = 'playing';

  for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
    const player = players[playerIndex];
    const rawHand = rawHands[playerIndex];

    if (!player || !rawHand) {
      throw new Error(`Invalid player index ${playerIndex}`);
    }

    const replacement = replaceFlowersForSinglePlayer({
      wall,
      hand: rawHand,
      flowers: [],
    });

    players[playerIndex] = {
      ...player,
      hand: [...replacement.hand],
      flowers: [...replacement.flowers],
    };
    wall = replacement.wall;
    const previousEvents = pendingScoringEvents;
    pendingScoringEvents = appendFlowerKongEvents(
      state.ruleSetId,
      pendingScoringEvents,
      players[playerIndex],
      playerIndex,
      replacement.flowers,
      'initial-flower-replacement',
    );
    handProgressFacts = addFlowerKongFacts(handProgressFacts, previousEvents, pendingScoringEvents);

    if (replacement.status === 'wall-exhausted') {
      phase = 'ended';
      break;
    }
  }

  const nextState: GameState = {
    ...state,
    players,
    wall: [...wall.tiles],
    currentPlayerIndex: state.dealerIndex,
    phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, state.dealerIndex, 'discard'),
    pendingScoringEvents,
    handProgressFacts,
  };

  return phase === 'ended' ? markHandEnded(nextState) : nextState;
}

function finishInitialDealFromRawHands(
  state: GameState,
  players: PlayerState[],
  rawHands: readonly MahjongTile[][],
  wall: TileWall,
  phase: GameState['phase'],
): GameState {
  const nextPlayers = players.map((player, index) => ({
    ...player,
    hand: rawHands[index]?.filter(isOrdinaryHandTile) ?? [],
    flowers: rawHands[index]?.filter(isFlowerTile) ?? [],
  }));
  const nextState: GameState = {
    ...state,
    players: nextPlayers,
    wall: [...wall.tiles],
    currentPlayerIndex: state.dealerIndex,
    phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(nextPlayers, state.dealerIndex, 'discard'),
    pendingScoringEvents: [],
    handProgressFacts: createEmptyHandProgressFacts(),
  };

  return phase === 'ended' ? markHandEnded(nextState) : nextState;
}

function playerOrderFromDealer(dealerIndex: number): number[] {
  return SEATS.map((_, offset) => (dealerIndex + offset) % SEATS.length);
}

function appendFlowerKongEvents(
  ruleSetId: GameState['ruleSetId'],
  events: readonly PendingScoringEvent[],
  player: PlayerState,
  playerIndex: number,
  flowers: readonly FlowerTile[],
  createdDuring: ScoringEventCreationStage,
): PendingScoringEvent[] {
  const nextEvents = [...events];

  for (const kind of findFlowerKongKinds(flowers)) {
    const alreadyRecorded = nextEvents.some(
      (event) =>
        event.type === 'flower-kong-created' &&
        event.playerIndex === playerIndex &&
        event.kind === kind,
    );

    if (!alreadyRecorded) {
      nextEvents.push({
        type: 'flower-kong-created',
        playerIndex,
        seat: player.seat,
        kind,
        createdDuring,
        transfers: getRuleSet(ruleSetId).getFlowerKongScoreTransfers({
          playerIndex,
          playerCount: SEATS.length,
          kind,
          createdDuring,
        }),
        status: 'pending',
      });
    }
  }

  return nextEvents;
}

function appendRuntimeFlowerKongEvents(
  ruleSetId: GameState['ruleSetId'],
  events: readonly PendingScoringEvent[],
  player: PlayerState,
  playerIndex: number,
  previousFlowers: readonly FlowerTile[],
  newlyRevealedFlowers: readonly FlowerTile[],
  suppressFinalFlower: boolean,
): PendingScoringEvent[] {
  let nextEvents = [...events];
  const flowers = [...previousFlowers];
  const eventFlowerCount = newlyRevealedFlowers.length - (suppressFinalFlower ? 1 : 0);

  for (const [index, flower] of newlyRevealedFlowers.entries()) {
    flowers.push(flower);

    if (index < eventFlowerCount) {
      nextEvents = appendFlowerKongEvents(
        ruleSetId,
        nextEvents,
        player,
        playerIndex,
        flowers,
        'runtime-flower-replacement',
      );
    }
  }

  return nextEvents;
}

function findFlowerKongKinds(flowers: readonly FlowerTile[]): FlowerKongKind[] {
  const flowerKinds = new Set(flowers.map((tile) => tile.flower));
  const kinds: FlowerKongKind[] = [];

  for (const flower of FOUR_COPY_FLOWER_KINDS) {
    if (flowers.filter((tile) => tile.flower === flower).length === FOUR_COPY_INDEXES.length) {
      kinds.push(flower);
    }
  }

  if (PLANT_FLOWER_KINDS.every((flower) => flowerKinds.has(flower))) {
    kinds.push('plum-orchid-bamboo-chrysanthemum');
  }

  if (SEASON_FLOWER_KINDS.every((flower) => flowerKinds.has(flower))) {
    kinds.push('spring-summer-autumn-winter');
  }

  return kinds;
}

function createEmptyHandProgressFacts(): HandProgressFacts {
  return {
    successfulAnGangCount: 0,
    successfulMingOrBuGangCount: 0,
    flowerKongCount: 0,
    gangKaiCount: 0,
    packageSettlementCount: 0,
    selfDrawCount: 0,
    followDiscardPenaltyCount: 0,
    fourIdenticalDiscardsPenaltyCount: 0,
    fourWindsGatheredCount: 0,
  };
}

function addFlowerKongFacts(
  facts: HandProgressFacts,
  before: readonly PendingScoringEvent[],
  after: readonly PendingScoringEvent[],
): HandProgressFacts {
  const addedCount = after
    .slice(before.length)
    .filter((event) => event.type === 'flower-kong-created').length;
  return addedCount === 0
    ? facts
    : { ...facts, flowerKongCount: facts.flowerKongCount + addedCount };
}

function resolveDealerIndex(options: StartGameOptions, fallbackDealerIndex: number): number {
  const seatDealerIndex =
    options.dealerSeat === undefined ? undefined : SEATS.indexOf(options.dealerSeat);
  const dealerIndex = options.dealerIndex ?? seatDealerIndex ?? fallbackDealerIndex;

  if (options.dealerIndex !== undefined && seatDealerIndex !== undefined) {
    if (options.dealerIndex !== seatDealerIndex) {
      throw new Error('dealerIndex and dealerSeat must refer to the same player');
    }
  }

  if (!Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= SEATS.length) {
    throw new Error(`Invalid dealer index ${dealerIndex}`);
  }

  return dealerIndex;
}

export function isNumberTile(tile: MahjongTile): tile is NumberTile {
  return tile.category === 'number';
}

export function isWindTile(tile: MahjongTile): tile is WindTile {
  return tile.category === 'wind';
}

export function isFlowerTile(tile: MahjongTile): tile is FlowerTile {
  return tile.category === 'flower';
}

export function isOrdinaryHandTile(tile: MahjongTile): tile is OrdinaryHandTile {
  return isNumberTile(tile) || isWindTile(tile);
}

export function requiresFlowerReveal(tile: MahjongTile): tile is FlowerTile {
  return isFlowerTile(tile);
}

export function createTileWall(tiles: readonly MahjongTile[]): TileWall {
  return { tiles: [...tiles] };
}

export function createNanjingMahjongTileWall(): TileWall {
  return createTileWall(createNanjingMahjongDeck());
}

export function drawTileFromWallHead(wall: TileWall): DrawTileFromWallResult {
  const tile = wall.tiles[0];

  if (!tile) {
    return createWallExhaustedResult(wall);
  }

  return {
    status: 'drawn',
    tile,
    wall: createTileWall(wall.tiles.slice(1)),
  };
}

export function drawTileFromWallTail(wall: TileWall): DrawTileFromWallResult {
  const tile = wall.tiles.at(-1);

  if (!tile) {
    return createWallExhaustedResult(wall);
  }

  return {
    status: 'drawn',
    tile,
    wall: createTileWall(wall.tiles.slice(0, -1)),
  };
}

export function replaceFlowersForSinglePlayer(
  input: SinglePlayerFlowerReplacementInput,
): SinglePlayerFlowerReplacementResult {
  const hand: OrdinaryHandTile[] = [];
  const flowers: FlowerTile[] = [...input.flowers];
  const newlyRevealedFlowers: FlowerTile[] = [];
  let replacementCount = 0;

  for (const tile of input.hand) {
    if (isFlowerTile(tile)) {
      flowers.push(tile);
      newlyRevealedFlowers.push(tile);
      replacementCount += 1;
    } else {
      hand.push(tile);
    }
  }

  return drawReplacementTilesFromWall(
    {
      wall: createTileWall(input.wall.tiles),
      hand,
      flowers,
      newlyRevealedFlowers,
      replacementTiles: [],
    },
    replacementCount,
  );
}

export function resolveDrawnTileWithFlowerReplacement(
  hand: readonly OrdinaryHandTile[],
  flowers: readonly FlowerTile[],
  drawnTile: MahjongTile,
  wall: TileWall,
): DrawnTileResolutionResult {
  if (isOrdinaryHandTile(drawnTile)) {
    return {
      status: 'complete',
      wall: createTileWall(wall.tiles),
      hand: [...hand, drawnTile],
      flowers: [...flowers],
      newlyRevealedFlowers: [],
      replacementTiles: [],
    };
  }

  return drawReplacementTilesFromWall(
    {
      wall: createTileWall(wall.tiles),
      hand: [...hand],
      flowers: [...flowers, drawnTile],
      newlyRevealedFlowers: [drawnTile],
      replacementTiles: [],
    },
    1,
  );
}

export function createNanjingMahjongDeck(): MahjongTile[] {
  return [...createNumberTiles(), ...createWindTiles(), ...createFlowerTiles()];
}

function copyGameState(state: GameState): GameState {
  return {
    nextMeldSequence: state.nextMeldSequence,
    ruleSetId: state.ruleSetId,
    players: copyPlayers(state.players),
    wall: [...state.wall],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: state.turnStage,
    pendingAction: { ...state.pendingAction },
    ...(state.lastDiscard === undefined ? {} : { lastDiscard: { ...state.lastDiscard } }),
    ...(state.reactionWindow === undefined
      ? {}
      : { reactionWindow: copyReactionWindow(state.reactionWindow) }),
    pendingScoringEvents: [...(state.pendingScoringEvents ?? [])],
    handProgressFacts: { ...state.handProgressFacts },
    ...(state.result === undefined ? {} : { result: copyHandResult(state.result) }),
  };
}

function createReactionWindow(
  players: readonly PlayerState[],
  fromPlayerIndex: number,
  discardedTile: MahjongTile,
): DiscardReactionWindow {
  const discarder = players[fromPlayerIndex];

  if (!discarder) {
    throw new Error(`Invalid discard player index ${fromPlayerIndex}`);
  }

  return {
    source: 'discard',
    discardedTile,
    fromPlayerIndex,
    fromSeat: discarder.seat,
    responderOrder: createResponderOrder(players, fromPlayerIndex),
    availableReactions: [],
    responses: [],
    status: 'open',
  };
}

function createResponderOrder(
  players: readonly PlayerState[],
  fromPlayerIndex: number,
): ReactionWindow['responderOrder'] {
  return SEATS.slice(1).map((_, offset) => {
    const playerIndex = (fromPlayerIndex + offset + 1) % SEATS.length;
    const player = players[playerIndex];

    if (!player) {
      throw new Error(`Invalid responder player index ${playerIndex}`);
    }

    return {
      playerIndex,
      seat: player.seat,
    };
  });
}

function copyReactionWindow(reactionWindow: ReactionWindow): ReactionWindow {
  return {
    ...reactionWindow,
    ...(reactionWindow.source === 'bu-gang'
      ? { intent: { ...reactionWindow.intent, tile: { ...reactionWindow.intent.tile } } }
      : {}),
    responderOrder: reactionWindow.responderOrder.map((responder) => ({ ...responder })),
    availableReactions: reactionWindow.availableReactions.map((availability) => ({
      ...availability,
      responseTypes: [...availability.responseTypes],
    })),
    responses: reactionWindow.responses.map((response) => ({ ...response })),
  };
}

function createPendingAction(
  players: readonly PlayerState[],
  playerIndex: number,
  type: PendingAction['type'],
): PendingAction {
  const player = players[playerIndex];

  if (!player) {
    throw new Error(`Invalid pending action player index ${playerIndex}`);
  }

  return {
    playerIndex,
    seat: player.seat,
    type,
  };
}

function createNoPendingAction(): PendingAction {
  return {
    playerIndex: null,
    seat: null,
    type: 'none',
  };
}

function markHandEnded(state: GameState): GameState {
  return {
    ...state,
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: createNoPendingAction(),
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
}

function nextPlayerIndex(currentPlayerIndex: number): number {
  return (currentPlayerIndex + 1) % SEATS.length;
}

function isAnGangTurn(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  const reactionWindow = state.reactionWindow;
  const followsMingGang =
    reactionWindow?.source === 'discard' &&
    reactionWindow?.status === 'closed' &&
    reactionWindow.responses.some((response) => response.type === 'ming-gang');
  const followsBuGang = reactionWindow?.source === 'bu-gang' && reactionWindow.status === 'closed';

  return (
    state.players.length === SEATS.length &&
    Number.isInteger(playerIndex) &&
    playerIndex >= 0 &&
    playerIndex < state.players.length &&
    playerIndex === state.currentPlayerIndex &&
    state.phase === 'playing' &&
    state.turnStage === 'waiting-for-discard' &&
    state.pendingAction.type === 'discard' &&
    state.pendingAction.playerIndex === playerIndex &&
    state.pendingAction.seat === player?.seat &&
    state.wall.length > 0 &&
    (reactionWindow === undefined || followsMingGang || followsBuGang)
  );
}

interface BuGangCandidate {
  readonly meld: PlayerState['melds'][number];
  readonly tile: OrdinaryHandTile;
}

function findBuGangCandidates(state: GameState, playerIndex: number): BuGangCandidate[] {
  if (!isBuGangTurn(state, playerIndex)) return [];
  const player = state.players[playerIndex];
  if (
    !player ||
    !Array.isArray(player.hand) ||
    !player.hand.every(isValidOrdinaryTile) ||
    !Array.isArray(player.buGangDrawProvenance) ||
    !player.buGangDrawProvenance.every(isValidBuGangDrawProvenance)
  ) {
    return [];
  }
  const entityIds = [
    ...player.hand.map((tile) => tile.id),
    ...player.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
  ];
  if (
    new Set(entityIds).size !== entityIds.length ||
    new Set(player.melds.map((meld) => meld.id)).size !== player.melds.length
  ) {
    return [];
  }

  const validPengs = player.melds.filter((meld) => isValidPengMeld(meld, playerIndex));
  const duplicateFaces = new Set<string>();
  const faceCounts = new Map<string, number>();
  for (const meld of player.melds.filter(
    (candidate) =>
      candidate.type === 'peng' &&
      candidate.tiles.length === 3 &&
      candidate.tiles.every(isValidOrdinaryTile) &&
      candidate.tiles[0] !== undefined &&
      candidate.tiles.every((tile) => isSameOrdinaryTileFace(tile, candidate.tiles[0]!)),
  )) {
    const first = meld.tiles[0];
    if (!first) continue;
    const key = ordinaryTileFaceKeyValue(ordinaryTileFace(first));
    faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
    if ((faceCounts.get(key) ?? 0) > 1) duplicateFaces.add(key);
  }

  return validPengs
    .flatMap((meld): BuGangCandidate[] => {
      const first = meld.tiles[0];
      if (!first) return [];
      const key = ordinaryTileFaceKeyValue(ordinaryTileFace(first));
      if (duplicateFaces.has(key)) return [];
      const provenance = player.buGangDrawProvenance.filter(
        (candidate) => candidate.targetMeldId === meld.id,
      );
      if (provenance.length !== 1) return [];
      const matching = player.hand.filter(
        (tile) => tile.id === provenance[0]?.tileId && isSameOrdinaryTileFace(tile, first),
      );
      return matching.length === 1 ? [{ meld, tile: matching[0]! }] : [];
    })
    .sort((left, right) => left.meld.id.localeCompare(right.meld.id));
}

function addBuGangDrawProvenance(
  player: PlayerState,
  drawnTile: OrdinaryHandTile | null,
): PlayerState {
  if (!drawnTile) return player;
  const matchingPengs = player.melds.filter(
    (meld) =>
      isValidPengMeld(meld, player.id) &&
      meld.tiles[0] !== undefined &&
      isSameOrdinaryTileFace(meld.tiles[0], drawnTile),
  );
  if (matchingPengs.length !== 1) return player;
  return {
    ...player,
    buGangDrawProvenance: [
      ...player.buGangDrawProvenance.filter((candidate) => candidate.tileId !== drawnTile.id),
      { targetMeldId: matchingPengs[0]!.id, tileId: drawnTile.id },
    ],
  };
}

function newlyDrawnOrdinaryTile(
  initiallyDrawnTile: MahjongTile,
  resolution: DrawnTileResolutionResult,
): OrdinaryHandTile | null {
  if (isOrdinaryHandTile(initiallyDrawnTile)) return initiallyDrawnTile;
  return resolution.replacementTiles.at(-1) ?? null;
}

function isValidBuGangDrawProvenance(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.targetMeldId === 'string' &&
    value.targetMeldId.trim().length > 0 &&
    typeof value.tileId === 'string' &&
    value.tileId.trim().length > 0
  );
}

function isBuGangTurn(state: GameState, playerIndex: number): boolean {
  const player = state.players[playerIndex];
  const reactionWindow = state.reactionWindow;
  const followsMingGang =
    reactionWindow?.source === 'discard' &&
    reactionWindow.status === 'closed' &&
    reactionWindow.responses.some((response) => response.type === 'ming-gang');
  const followsBuGang = reactionWindow?.source === 'bu-gang' && reactionWindow.status === 'closed';
  return (
    state.players.length === SEATS.length &&
    Number.isInteger(playerIndex) &&
    playerIndex >= 0 &&
    playerIndex < state.players.length &&
    playerIndex === state.currentPlayerIndex &&
    state.phase === 'playing' &&
    state.turnStage === 'waiting-for-discard' &&
    state.pendingAction.type === 'discard' &&
    state.pendingAction.playerIndex === playerIndex &&
    state.pendingAction.seat === player?.seat &&
    state.wall.length > 0 &&
    (reactionWindow === undefined || followsMingGang || followsBuGang)
  );
}

function isValidPengMeld(meld: PlayerState['melds'][number], ownerPlayerIndex: number): boolean {
  return (
    meld.type === 'peng' &&
    typeof meld.id === 'string' &&
    meld.id.trim().length > 0 &&
    meld.tiles.length === 3 &&
    meld.tiles.every(isValidOrdinaryTile) &&
    new Set(meld.tiles.map((tile) => tile.id)).size === 3 &&
    meld.tiles[0] !== undefined &&
    meld.tiles.every((tile) => isSameOrdinaryTileFace(tile, meld.tiles[0]!)) &&
    typeof meld.claimedTileId === 'string' &&
    meld.tiles.some((tile) => tile.id === meld.claimedTileId) &&
    Number.isInteger(meld.fromPlayerIndex) &&
    (meld.fromPlayerIndex ?? -1) >= 0 &&
    (meld.fromPlayerIndex ?? SEATS.length) < SEATS.length &&
    meld.fromPlayerIndex !== ownerPlayerIndex
  );
}

function ordinaryTileFace(tile: OrdinaryHandTile): OrdinaryTileFace {
  return tile.category === 'number'
    ? { category: 'number', suit: tile.suit, rank: tile.rank }
    : { category: 'wind', wind: tile.wind };
}

function ordinaryTileFaceKeyValue(tileFace: OrdinaryTileFace): string {
  return tileFace.category === 'number'
    ? `${tileFace.suit}-${tileFace.rank}`
    : `wind-${tileFace.wind}`;
}

function copyHandResult(result: HandResult): HandResult {
  if (result.type === 'draw') return { ...result };
  return {
    ...result,
    winningTile: { ...result.winningTile },
    winners: result.winners.map((winner) => ({
      ...winner,
      evaluation: {
        ...winner.evaluation,
        patterns: [...winner.evaluation.patterns],
      },
    })),
  };
}

function isSameOrdinaryTileFaceValue(left: OrdinaryTileFace, right: OrdinaryTileFace): boolean {
  return left.category === 'number' && right.category === 'number'
    ? left.suit === right.suit && left.rank === right.rank
    : left.category === 'wind' && right.category === 'wind' && left.wind === right.wind;
}

function matchingAnGangTiles(
  hand: readonly OrdinaryHandTile[],
  tileFace: OrdinaryTileFace,
): OrdinaryHandTile[] {
  return hand.filter((tile) => isSameOrdinaryTileFaceValue(ordinaryTileFace(tile), tileFace));
}

function compareTilesById(left: OrdinaryHandTile, right: OrdinaryHandTile): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareOrdinaryTileFaces(left: OrdinaryTileFace, right: OrdinaryTileFace): number {
  const key = (tileFace: OrdinaryTileFace): number => {
    if (tileFace.category === 'wind') return 100 + WIND_TILE_KINDS.indexOf(tileFace.wind);
    return NUMBER_TILE_SUITS.indexOf(tileFace.suit) * 10 + tileFace.rank;
  };
  return key(left) - key(right);
}

function isValidOrdinaryTileFace(tileFace: unknown): tileFace is OrdinaryTileFace {
  if (!isRecord(tileFace)) return false;
  if (tileFace.category === 'number') {
    return (
      NUMBER_TILE_SUITS.some((suit) => suit === tileFace.suit) &&
      NUMBER_TILE_RANKS.some((rank) => rank === tileFace.rank)
    );
  }
  return tileFace.category === 'wind' && WIND_TILE_KINDS.some((wind) => wind === tileFace.wind);
}

function isValidOrdinaryTile(tile: unknown): tile is OrdinaryHandTile {
  if (!isRecord(tile) || !FOUR_COPY_INDEXES.some((copy) => copy === tile.copy)) return false;
  if (tile.category === 'number') {
    return (
      NUMBER_TILE_SUITS.some((suit) => suit === tile.suit) &&
      NUMBER_TILE_RANKS.some((rank) => rank === tile.rank) &&
      tile.id === `${tile.suit}-${tile.rank}-${tile.copy}`
    );
  }
  return (
    tile.category === 'wind' &&
    WIND_TILE_KINDS.some((wind) => wind === tile.wind) &&
    tile.id === `wind-${tile.wind}-${tile.copy}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createWallExhaustedResult(wall: TileWall): DrawTileFromWallResult {
  return {
    status: 'wall-exhausted',
    wall: createTileWall(wall.tiles),
  };
}

interface FlowerReplacementState {
  readonly wall: TileWall;
  readonly hand: OrdinaryHandTile[];
  readonly flowers: FlowerTile[];
  readonly newlyRevealedFlowers: FlowerTile[];
  readonly replacementTiles: OrdinaryHandTile[];
}

function drawReplacementTilesFromWall(
  state: FlowerReplacementState,
  replacementCount: number,
): FlowerReplacementResult {
  let wall = state.wall;
  const hand = [...state.hand];
  const flowers = [...state.flowers];
  const newlyRevealedFlowers = [...state.newlyRevealedFlowers];
  const replacementTiles = [...state.replacementTiles];
  let remainingReplacements = replacementCount;

  while (remainingReplacements > 0) {
    const drawResult = drawTileFromWallTail(wall);

    if (drawResult.status === 'wall-exhausted') {
      return {
        status: 'wall-exhausted',
        wall: drawResult.wall,
        hand,
        flowers,
        newlyRevealedFlowers,
        replacementTiles,
      };
    }

    wall = drawResult.wall;

    if (isFlowerTile(drawResult.tile)) {
      flowers.push(drawResult.tile);
      newlyRevealedFlowers.push(drawResult.tile);
      continue;
    }

    hand.push(drawResult.tile);
    replacementTiles.push(drawResult.tile);
    remainingReplacements -= 1;
  }

  return {
    status: 'complete',
    wall,
    hand,
    flowers,
    newlyRevealedFlowers,
    replacementTiles,
  };
}

function createNumberTiles(): NumberTile[] {
  const tiles: NumberTile[] = [];

  for (const suit of NUMBER_TILE_SUITS) {
    for (const rank of NUMBER_TILE_RANKS) {
      for (const copy of FOUR_COPY_INDEXES) {
        tiles.push({
          category: 'number',
          id: `${suit}-${rank}-${copy}`,
          suit,
          rank,
          copy,
        });
      }
    }
  }

  return tiles;
}

function createWindTiles(): WindTile[] {
  const tiles: WindTile[] = [];

  for (const wind of WIND_TILE_KINDS) {
    for (const copy of FOUR_COPY_INDEXES) {
      tiles.push({
        category: 'wind',
        id: `wind-${wind}-${copy}`,
        wind,
        copy,
      });
    }
  }

  return tiles;
}

function createFlowerTiles(): FlowerTile[] {
  const tiles: FlowerTile[] = [];

  for (const flower of FOUR_COPY_FLOWER_KINDS) {
    for (const copy of FOUR_COPY_INDEXES) {
      tiles.push({
        category: 'flower',
        id: `flower-${flower}-${copy}`,
        flowerGroup: 'four-copy',
        flower,
        copy,
      });
    }
  }

  for (const flower of PLANT_FLOWER_KINDS) {
    tiles.push({
      category: 'flower',
      id: `flower-${flower}-1`,
      flowerGroup: 'plant',
      flower,
      copy: 1,
    });
  }

  for (const flower of SEASON_FLOWER_KINDS) {
    tiles.push({
      category: 'flower',
      id: `season-${flower}-1`,
      flowerGroup: 'season',
      copy: 1,
      flower,
    });
  }

  return tiles;
}
