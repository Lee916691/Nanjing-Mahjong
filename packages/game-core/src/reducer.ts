import { copyPlayers, createInitialPlayers, SEATS } from './player';
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
  FlowerReplacementResult,
  FlowerTile,
  GameState,
  MahjongTile,
  NumberTile,
  OrdinaryHandTile,
  SinglePlayerFlowerReplacementInput,
  SinglePlayerFlowerReplacementResult,
  TileWall,
  WindTile,
} from './state';

export type DrawAction = { type: 'DRAW_TILE' };
export type DiscardAction =
  { type: 'DISCARD_TILE'; tileId: string } | { type: 'DISCARDED_TILE'; tileId: string };
export type ReactionAction = { type: 'PENG' } | { type: 'GANG' } | { type: 'HU' };
export type GameAction = { type: 'START_GAME' } | DrawAction | DiscardAction | ReactionAction;

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME':
      return startGameState(state);
    case 'DRAW_TILE':
      return drawReducer(state);
    case 'DISCARD_TILE':
    case 'DISCARDED_TILE':
      return discardReducer(state, action);
    case 'PENG':
    case 'GANG':
    case 'HU':
      return reactionReducer(state);
  }
}

export function drawReducer(state: GameState): GameState {
  if (state.phase !== 'playing') {
    return copyGameState(state);
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (!currentPlayer) {
    throw new Error(`Invalid current player index ${state.currentPlayerIndex}`);
  }

  const headDraw = drawTileFromWallHead(createTileWall(state.wall));

  if (headDraw.status === 'wall-exhausted') {
    return {
      ...copyGameState(state),
      wall: [...headDraw.wall.tiles],
      phase: 'ended',
    };
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

  return {
    players,
    wall: [...drawResolution.wall.tiles],
    currentPlayerIndex:
      drawResolution.status === 'complete'
        ? nextPlayerIndex(state.currentPlayerIndex)
        : state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase:
      drawResolution.status === 'wall-exhausted' || drawResolution.wall.tiles.length === 0
        ? 'ended'
        : state.phase,
  };
}

export function discardReducer(state: GameState, action: DiscardAction): GameState {
  if (state.phase !== 'playing') {
    return copyGameState(state);
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

  return {
    players,
    wall: [...state.wall],
    currentPlayerIndex: nextPlayerIndex(state.currentPlayerIndex),
    dealerIndex: state.dealerIndex,
    phase: state.phase,
  };
}

export function reactionReducer(state: GameState): GameState {
  return copyGameState(state);
}

export function createGameState(): GameState {
  return {
    players: createInitialPlayers(),
    wall: createNanjingMahjongDeck(),
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'ready',
  };
}

export function startGameState(state: GameState): GameState {
  return {
    players: copyPlayers(state.players),
    wall: [...state.wall],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase === 'ready' ? 'playing' : state.phase,
  };
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
    players: copyPlayers(state.players),
    wall: [...state.wall],
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    phase: state.phase,
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
