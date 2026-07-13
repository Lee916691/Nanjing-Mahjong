import type { ReactionResponseType } from './actions';
import type { HuStructure } from './hu';
import type { PlayerState } from './player';
import type { RuleSetId } from './rules/RuleSet';

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
export type OrdinaryTileFace =
  | {
      readonly category: 'number';
      readonly suit: NumberTileSuit;
      readonly rank: NumberTileRank;
    }
  | {
      readonly category: 'wind';
      readonly wind: WindTileKind;
    };
export type MahjongTile = OrdinaryHandTile | FlowerTile;
export type Tile = MahjongTile;

export function isSameOrdinaryTileFace(left: OrdinaryHandTile, right: OrdinaryHandTile): boolean {
  if (left.category === 'number' && right.category === 'number') {
    return left.suit === right.suit && left.rank === right.rank;
  }

  return left.category === 'wind' && right.category === 'wind' && left.wind === right.wind;
}

export type GamePhase = 'ready' | 'playing' | 'ended';
export type TurnStage =
  'waiting-for-draw' | 'waiting-for-discard' | 'waiting-for-reaction' | 'hand-ended';
export type PendingActionType = 'draw' | 'discard' | 'reaction' | 'none';

export interface PendingAction {
  readonly playerIndex: number | null;
  readonly seat: PlayerState['seat'] | null;
  readonly type: PendingActionType;
}

export interface LastDiscard {
  readonly tile: Tile;
  readonly tileId: TileId;
  readonly fromPlayerIndex: number;
  readonly fromSeat: PlayerState['seat'];
}

export interface ReactionResponder {
  readonly playerIndex: number;
  readonly seat: PlayerState['seat'];
}

export interface ReactionAvailability {
  readonly playerIndex: number;
  readonly seat: PlayerState['seat'];
  readonly responseTypes: readonly ReactionResponseType[];
}

export interface ReactionResponse {
  readonly playerIndex: number;
  readonly seat: PlayerState['seat'];
  readonly type: ReactionResponseType;
}

export type ReactionWindowStatus = 'open' | 'awaiting-resolution' | 'closed';

export interface ReactionWindowBase {
  readonly responderOrder: readonly ReactionResponder[];
  readonly availableReactions: readonly ReactionAvailability[];
  readonly responses: readonly ReactionResponse[];
  readonly status: ReactionWindowStatus;
}

export interface DiscardReactionWindow extends ReactionWindowBase {
  readonly source: 'discard';
  readonly discardedTile: Tile;
  readonly fromPlayerIndex: number;
  readonly fromSeat: PlayerState['seat'];
}

export interface PendingBuGangIntent {
  readonly declarerPlayerIndex: number;
  readonly declarerSeat: PlayerState['seat'];
  readonly targetMeldId: string;
  readonly tile: OrdinaryHandTile;
}

export interface BuGangReactionWindow extends ReactionWindowBase {
  readonly source: 'bu-gang';
  readonly intent: PendingBuGangIntent;
}

export type ReactionWindow = DiscardReactionWindow | BuGangReactionWindow;

export type FlowerKongKind =
  FourCopyFlowerKind | 'plum-orchid-bamboo-chrysanthemum' | 'spring-summer-autumn-winter';

export type ScoringEventCreationStage =
  'initial-deal' | 'initial-flower-replacement' | 'runtime-flower-replacement';

export interface ScoreTransfer {
  readonly fromPlayerIndex: number;
  readonly toPlayerIndex: number;
  readonly amount: number;
}

export interface PendingFlowerKongScoringEvent {
  readonly type: 'flower-kong-created';
  readonly playerIndex: number;
  readonly seat: PlayerState['seat'];
  readonly kind: FlowerKongKind;
  readonly createdDuring: ScoringEventCreationStage;
  readonly transfers: readonly ScoreTransfer[];
  readonly status: 'pending';
}

export interface PendingMingGangScoringEvent {
  readonly type: 'ming-gang-created';
  readonly receiverPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly meldId: string;
  readonly transfers: readonly ScoreTransfer[];
  readonly status: 'pending';
}

export interface PendingAnGangScoringEvent {
  readonly type: 'an-gang-created';
  readonly playerIndex: number;
  readonly meldId: string;
  readonly transfers: readonly ScoreTransfer[];
  readonly status: 'pending';
}

export type HuSource = 'discard' | 'rob-bu-gang';
export type HuPattern =
  | 'men-qing'
  | 'all-pungs'
  | 'global-single-wait'
  | 'mixed-one-suit'
  | 'pure-one-suit'
  | 'seven-pairs'
  | 'dragon-seven-pairs'
  | 'no-flower'
  | 'pressure-absolute';

export interface HuEvaluation {
  readonly structure: HuStructure;
  readonly patterns: readonly HuPattern[];
  readonly hardFlowerCount: number;
  readonly softFlowerCount: number;
}

export interface PendingHuScoringEvent {
  readonly type: 'hu-resolved';
  readonly source: HuSource;
  readonly winnerPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly winningTile: OrdinaryHandTile;
  readonly evaluation: HuEvaluation;
  readonly transfers: readonly ScoreTransfer[];
  readonly status: 'pending';
}

export interface PendingBuGangScoringEvent {
  readonly type: 'bu-gang-created';
  readonly playerIndex: number;
  readonly payerPlayerIndex: number;
  readonly meldId: string;
  readonly transfers: readonly ScoreTransfer[];
  readonly status: 'pending';
}

export type PendingScoringEvent =
  | PendingFlowerKongScoringEvent
  | PendingMingGangScoringEvent
  | PendingAnGangScoringEvent
  | PendingHuScoringEvent
  | PendingBuGangScoringEvent;

export interface DrawHandResult {
  readonly type: 'draw';
  readonly reason: 'wall-exhausted';
}

export interface WinHandWinner {
  readonly playerIndex: number;
  readonly evaluation: HuEvaluation;
}

export interface WinHandResult {
  readonly type: 'win';
  readonly source: HuSource;
  readonly winningTile: OrdinaryHandTile;
  readonly payerPlayerIndex: number;
  readonly winners: readonly WinHandWinner[];
}

export type HandResult = DrawHandResult | WinHandResult;

export interface HandProgressFacts {
  readonly successfulAnGangCount: number;
  readonly successfulMingOrBuGangCount: number;
  readonly flowerKongCount: number;
  readonly gangKaiCount: number;
  readonly packageSettlementCount: number;
  readonly selfDrawCount: number;
  readonly followDiscardPenaltyCount: number;
  readonly fourIdenticalDiscardsPenaltyCount: number;
  readonly fourWindsGatheredCount: number;
}

export interface GameState {
  readonly nextMeldSequence: number;
  ruleSetId: RuleSetId;
  players: PlayerState[];
  wall: Tile[];
  currentPlayerIndex: number;
  dealerIndex: number;
  phase: GamePhase;
  turnStage: TurnStage;
  pendingAction: PendingAction;
  lastDiscard?: LastDiscard;
  reactionWindow?: ReactionWindow;
  pendingScoringEvents: readonly PendingScoringEvent[];
  handProgressFacts: HandProgressFacts;
  result?: HandResult;
}

export interface TileWall {
  readonly tiles: readonly MahjongTile[];
}

export type Wall = TileWall;

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
