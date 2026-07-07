export {
  FLOWER_TILE_KINDS,
  FOUR_COPY_FLOWER_KINDS,
  FOUR_COPY_INDEXES,
  GAME_CORE_MODULE,
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  PLANT_FLOWER_KINDS,
  SEASON_FLOWER_KINDS,
  WIND_TILE_KINDS,
} from './state';
export type {
  DrawTileFromWallResult,
  DrawnTileResolutionResult,
  FlowerReplacementResult,
  FlowerTile,
  FlowerTileId,
  FlowerTileKind,
  FourCopyFlowerTile,
  FourCopyFlowerTileId,
  FourCopyFlowerKind,
  FourCopyIndex,
  GamePhase,
  GameState,
  MahjongTile,
  NumberTile,
  NumberTileId,
  NumberTileRank,
  NumberTileSuit,
  OrdinaryHandTile,
  PlantFlowerTile,
  PlantFlowerTileId,
  PlantFlowerKind,
  SeasonFlowerTile,
  SeasonFlowerTileId,
  SeasonFlowerKind,
  SinglePlayerFlowerReplacementInput,
  SinglePlayerFlowerReplacementResult,
  Tile,
  TileId,
  TileWall,
  Wall,
  WindTile,
  WindTileId,
  WindTileKind,
} from './state';

export {
  DEFAULT_RULE_SET_ID,
  NANJING_OPEN_RULE_SET,
  RULE_SET_REGISTRY,
  getRuleSet,
  listRuleSets,
} from './rules';
export type { RuleSet, RuleSetId } from './rules';

export { SEATS, createInitialPlayers } from './player';
export type { PlayerState, Seat } from './player';

export type {
  DiscardAction,
  DrawAction,
  GameAction,
  ReactionAction,
  StartGameAction,
} from './actions';
export type { GameCreationOptions, RuleSetOptions, StartGameOptions } from './options';

export {
  createNanjingMahjongDeck,
  createNanjingMahjongTileWall,
  createTileWall,
  drawTileFromWallHead,
  drawTileFromWallTail,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  replaceFlowersForSinglePlayer,
  requiresFlowerReveal,
  resolveDrawnTileWithFlowerReplacement,
} from './reducer';

export {
  advanceTurn,
  applyAction,
  createGame,
  createInitialGame,
  gameEngine,
  startGame,
} from './engine';
export type { GameEngine } from './engine';
