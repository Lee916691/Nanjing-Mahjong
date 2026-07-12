import { copyPlayers, createInitialPlayers, SEATS } from './player';
import type { PlayerState } from './player';
import { DEFAULT_RULE_SET_ID, getRuleSet } from './rules';
import type { DiscardAction, GameAction, ReactionResponseType } from './actions';
import type { GameCreationOptions, StartGameOptions } from './options';
import {
  FOUR_COPY_FLOWER_KINDS,
  FOUR_COPY_INDEXES,
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  PLANT_FLOWER_KINDS,
  SEASON_FLOWER_KINDS,
  WIND_TILE_KINDS,
} from './state';
import type {
  DrawTileFromWallResult,
  DrawnTileResolutionResult,
  FlowerKongKind,
  FlowerReplacementResult,
  FlowerTile,
  GameState,
  MahjongTile,
  NumberTile,
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
    case 'PENG':
    case 'GANG':
    case 'HU':
      return reactionReducer(state);
  }
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

  const nextState: GameState = {
    ruleSetId: state.ruleSetId,
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, state.currentPlayerIndex, 'discard'),
    pendingScoringEvents: [...(state.pendingScoringEvents ?? [])],
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
    hand: [
      ...copiedPlayer.hand.slice(0, discardedTileIndex),
      ...copiedPlayer.hand.slice(discardedTileIndex + 1),
    ],
    discardPile: [...copiedPlayer.discardPile, discardedTile],
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
    state.currentPlayerIndex !== playerIndex
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
      currentPlayerIndex: nextResponder.playerIndex,
      turnStage: 'waiting-for-reaction',
      pendingAction: createPendingAction(state.players, nextResponder.playerIndex, 'reaction'),
      reactionWindow,
    };
  }

  return {
    ...copyGameState(state),
    currentPlayerIndex: currentResponder.playerIndex,
    turnStage: 'waiting-for-reaction',
    pendingAction: createNoPendingAction(),
    reactionWindow,
  };
}

export function resolveReactionWindowReducer(state: GameState): GameState {
  const window = state.reactionWindow;

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
    ) ||
    window.responses.some((response) => response.type !== 'pass')
  ) {
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
export function reactionReducer(state: GameState): GameState {
  return copyGameState(state);
}

export function createGameState(options: GameCreationOptions = {}): GameState {
  const ruleSet = getRuleSet(options.ruleSetId ?? DEFAULT_RULE_SET_ID);
  const dealerIndex = resolveDealerIndex(options, 0);

  const players = createInitialPlayers(dealerIndex);

  return {
    ruleSetId: ruleSet.id,
    players,
    wall: createNanjingMahjongDeck(),
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'ready',
    turnStage: 'waiting-for-draw',
    pendingAction: createPendingAction(players, dealerIndex, 'draw'),
    pendingScoringEvents: [],
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
    ruleSetId: ruleSet.id,
    players,
    wall: [...state.wall],
    currentPlayerIndex: dealerIndex,
    dealerIndex,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: createPendingAction(players, dealerIndex, 'discard'),
    pendingScoringEvents: [],
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

  for (const playerIndex of playerOrderFromDealer(state.dealerIndex)) {
    const player = players[playerIndex];

    if (!player) {
      throw new Error(`Invalid player index ${playerIndex}`);
    }

    pendingScoringEvents = appendFlowerKongEvents(
      pendingScoringEvents,
      player,
      playerIndex,
      rawHands[playerIndex]?.filter(isFlowerTile) ?? [],
      'initial-deal',
    );
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
    pendingScoringEvents = appendFlowerKongEvents(
      pendingScoringEvents,
      players[playerIndex],
      playerIndex,
      replacement.flowers,
      'initial-flower-replacement',
    );

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
  };

  return phase === 'ended' ? markHandEnded(nextState) : nextState;
}

function playerOrderFromDealer(dealerIndex: number): number[] {
  return SEATS.map((_, offset) => (dealerIndex + offset) % SEATS.length);
}

function appendFlowerKongEvents(
  events: readonly PendingScoringEvent[],
  player: PlayerState,
  playerIndex: number,
  flowers: readonly FlowerTile[],
  createdDuring: ScoringEventCreationStage,
): PendingScoringEvent[] {
  const nextEvents = [...events];

  for (const kind of findFlowerKongKinds(flowers)) {
    const alreadyRecorded = nextEvents.some(
      (event) => event.playerIndex === playerIndex && event.kind === kind,
    );

    if (!alreadyRecorded) {
      nextEvents.push({
        type: 'flower-kong-created',
        playerIndex,
        seat: player.seat,
        kind,
        createdDuring,
        status: 'pending',
      });
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
  };
}

function createReactionWindow(
  players: readonly PlayerState[],
  fromPlayerIndex: number,
  discardedTile: MahjongTile,
): ReactionWindow {
  const discarder = players[fromPlayerIndex];

  if (!discarder) {
    throw new Error(`Invalid discard player index ${fromPlayerIndex}`);
  }

  return {
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
  };
}

function nextPlayerIndex(currentPlayerIndex: number): number {
  return (currentPlayerIndex + 1) % SEATS.length;
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
