export const GAME_CORE_MODULE = 'game-core';

export const NUMBER_TILE_SUITS = ['wan', 'tiao', 'tong'] as const;
export type NumberTileSuit = (typeof NUMBER_TILE_SUITS)[number];

export const NUMBER_TILE_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type NumberTileRank = (typeof NUMBER_TILE_RANKS)[number];

export const WIND_TILE_KINDS = ['east', 'south', 'west', 'north'] as const;
export type WindTileKind = (typeof WIND_TILE_KINDS)[number];

export const FOUR_COPY_FLOWER_KINDS = ['red-center', 'fortune', 'white-board'] as const;
export type FourCopyFlowerKind = (typeof FOUR_COPY_FLOWER_KINDS)[number];

export const PLANT_FLOWER_KINDS = ['plum', 'orchid', 'bamboo', 'chrysanthemum'] as const;
export type PlantFlowerKind = (typeof PLANT_FLOWER_KINDS)[number];

export const SEASON_FLOWER_KINDS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonFlowerKind = (typeof SEASON_FLOWER_KINDS)[number];

export const FLOWER_TILE_KINDS = [
  ...FOUR_COPY_FLOWER_KINDS,
  ...PLANT_FLOWER_KINDS,
  ...SEASON_FLOWER_KINDS,
] as const;
export type FlowerTileKind = (typeof FLOWER_TILE_KINDS)[number];

export const FOUR_COPY_INDEXES = [1, 2, 3, 4] as const;
export type FourCopyIndex = (typeof FOUR_COPY_INDEXES)[number];

export type NumberTileId = `${NumberTileSuit}-${NumberTileRank}-${FourCopyIndex}`;
export type WindTileId = `wind-${WindTileKind}-${FourCopyIndex}`;
export type FourCopyFlowerTileId = `flower-${FourCopyFlowerKind}-${FourCopyIndex}`;
export type PlantFlowerTileId = `flower-${PlantFlowerKind}-1`;
export type SeasonFlowerTileId = `season-${SeasonFlowerKind}-1`;
export type FlowerTileId = FourCopyFlowerTileId | PlantFlowerTileId | SeasonFlowerTileId;
export type TileId = NumberTileId | WindTileId | FlowerTileId;

interface TileBase {
  readonly id: TileId;
  readonly copy: number;
}

export interface NumberTile extends TileBase {
  readonly category: 'number';
  readonly id: NumberTileId;
  readonly suit: NumberTileSuit;
  readonly rank: NumberTileRank;
  readonly copy: FourCopyIndex;
}

export interface WindTile extends TileBase {
  readonly category: 'wind';
  readonly id: WindTileId;
  readonly wind: WindTileKind;
  readonly copy: FourCopyIndex;
}

export interface FourCopyFlowerTile extends TileBase {
  readonly category: 'flower';
  readonly id: FourCopyFlowerTileId;
  readonly flowerGroup: 'four-copy';
  readonly flower: FourCopyFlowerKind;
  readonly copy: FourCopyIndex;
}

export interface PlantFlowerTile extends TileBase {
  readonly category: 'flower';
  readonly id: PlantFlowerTileId;
  readonly flowerGroup: 'plant';
  readonly flower: PlantFlowerKind;
  readonly copy: 1;
}

export interface SeasonFlowerTile extends TileBase {
  readonly category: 'flower';
  readonly id: SeasonFlowerTileId;
  readonly flowerGroup: 'season';
  readonly flower: SeasonFlowerKind;
  readonly copy: 1;
}

export type FlowerTile = FourCopyFlowerTile | PlantFlowerTile | SeasonFlowerTile;
export type OrdinaryHandTile = NumberTile | WindTile;
export type MahjongTile = OrdinaryHandTile | FlowerTile;

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

export interface TileWall {
  readonly tiles: readonly MahjongTile[];
}

export type DrawTileFromWallResult =
  | {
      readonly status: 'drawn';
      readonly tile: MahjongTile;
      readonly wall: TileWall;
    }
  | {
      readonly status: 'wall-exhausted';
      readonly wall: TileWall;
    };

export type FlowerReplacementResult =
  | {
      readonly status: 'complete';
      readonly wall: TileWall;
      readonly hand: readonly OrdinaryHandTile[];
      readonly flowers: readonly FlowerTile[];
      readonly newlyRevealedFlowers: readonly FlowerTile[];
      readonly replacementTiles: readonly OrdinaryHandTile[];
    }
  | {
      readonly status: 'wall-exhausted';
      readonly wall: TileWall;
      readonly hand: readonly OrdinaryHandTile[];
      readonly flowers: readonly FlowerTile[];
      readonly newlyRevealedFlowers: readonly FlowerTile[];
      readonly replacementTiles: readonly OrdinaryHandTile[];
    };

export interface SinglePlayerFlowerReplacementInput {
  readonly wall: TileWall;
  readonly hand: readonly MahjongTile[];
  readonly flowers: readonly FlowerTile[];
}

export type SinglePlayerFlowerReplacementResult = FlowerReplacementResult;

export type DrawnTileResolutionResult = FlowerReplacementResult;

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
export function createNanjingMahjongDeck(): MahjongTile[] {
  return [...createNumberTiles(), ...createWindTiles(), ...createFlowerTiles()];
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
      flower,
      copy: 1,
    });
  }

  return tiles;
}
