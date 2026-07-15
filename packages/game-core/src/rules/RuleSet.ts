import type { GameAction } from '../actions';
import type { Meld } from '../meld';
import type { Seat } from '../player';
import type {
  FlowerKongKind,
  GameState,
  ReactionAvailability,
  ScoreTransfer,
  ScoringEventCreationStage,
  FlowerTile,
  DiHuDeclaration,
  HuEvaluation,
  OrdinaryHandTile,
  OrdinaryTileFace,
  SelfDrawSource,
  Tile,
} from '../state';
import type { WindTileKind } from '../state';

export type RuleSetId = 'nanjing-open';

export interface MingGangScoringContext {
  readonly receiverPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly playerCount: number;
  readonly meldId: string;
}

export interface AnGangScoringContext {
  readonly playerIndex: number;
  readonly playerCount: number;
  readonly meldId: string;
}

export interface FlowerKongScoringContext {
  readonly playerIndex: number;
  readonly playerCount: number;
  readonly kind: FlowerKongKind;
  readonly createdDuring: ScoringEventCreationStage;
}

export interface BuGangScoringContext {
  readonly playerIndex: number;
  readonly payerPlayerIndex: number;
  readonly playerCount: number;
  readonly meldId: string;
}

export type SpecialDiscardScoringContext =
  | {
      readonly source: 'follow-discard';
      readonly playerCount: number;
      readonly payerPlayerIndex: number;
      readonly triggeringPlayerIndex: number;
      readonly tileFace: OrdinaryTileFace;
    }
  | {
      readonly source: 'four-identical-discards';
      readonly playerCount: number;
      readonly payerPlayerIndex: number;
      readonly tileFace: OrdinaryTileFace;
    }
  | {
      readonly source: 'four-winds-gathered';
      readonly playerCount: number;
      readonly receiverPlayerIndex: number;
      readonly completingWind: WindTileKind;
    };

interface ReactionAvailabilityContextBase {
  readonly playerCount: number;
  readonly responderPlayerIndex: number;
  readonly responderSeat: Seat;
  readonly responderConcealedTiles: readonly OrdinaryHandTile[];
  readonly responderMelds: readonly Meld[];
  readonly responderFlowers: readonly FlowerTile[];
  readonly responderPassHu: boolean;
  readonly allMelds: readonly Meld[];
  readonly dealerIndex?: number;
  readonly responderDiHuDeclaration?: DiHuDeclaration;
}

export interface DiscardReactionAvailabilityContext extends ReactionAvailabilityContextBase {
  readonly source: 'discard';
  readonly fromPlayerIndex: number;
  readonly discardedTile: Tile;
  readonly canDrawFromWallTail: boolean;
}

export interface BuGangReactionAvailabilityContext extends ReactionAvailabilityContextBase {
  readonly source: 'bu-gang';
  readonly declarerPlayerIndex: number;
  readonly targetTile: OrdinaryHandTile;
}

export type ReactionAvailabilityContext =
  DiscardReactionAvailabilityContext | BuGangReactionAvailabilityContext;

interface HuContextBase {
  readonly winnerPlayerIndex: number;
  readonly playerCount: number;
  readonly winningTile: OrdinaryHandTile;
  readonly concealedTiles: readonly OrdinaryHandTile[];
  readonly melds: readonly Meld[];
  readonly flowers: readonly FlowerTile[];
  readonly allMelds: readonly Meld[];
  readonly dealerIndex?: number;
  readonly diHuDeclaration?: DiHuDeclaration;
}

export type HuEvaluationContext = HuContextBase &
  (
    | { readonly source: 'discard' | 'rob-bu-gang'; readonly payerPlayerIndex: number }
    | {
        readonly source: 'self-draw';
        readonly drawSource: Exclude<SelfDrawSource, 'flower-replacement'>;
      }
    | {
        readonly source: 'self-draw';
        readonly drawSource: 'flower-replacement';
        readonly formedFlowerKongDuringReplacement: boolean;
      }
  );

interface HuScoringContextBase {
  readonly winnerPlayerIndex: number;
  readonly playerCount: number;
  readonly evaluation: HuEvaluation;
}

export type HuScoringContext = HuScoringContextBase &
  (
    | { readonly source: 'discard' | 'rob-bu-gang'; readonly payerPlayerIndex: number }
    | {
        readonly source: 'self-draw';
        readonly drawSource: Exclude<SelfDrawSource, 'flower-replacement'>;
      }
    | {
        readonly source: 'self-draw';
        readonly drawSource: 'flower-replacement';
        readonly formedFlowerKongDuringReplacement: boolean;
      }
  );

export interface RuleSet {
  readonly id: RuleSetId;
  readonly displayName: string;
  readonly totalEffectiveDealerTurns: number;
  readonly validateAction: (state: GameState, action: GameAction) => boolean;
  readonly applyAction: (state: GameState, action: GameAction) => GameState;
  readonly getAvailableReactions: (context: ReactionAvailabilityContext) => ReactionAvailability;
  readonly getMingGangScoreTransfers: (context: MingGangScoringContext) => readonly ScoreTransfer[];
  readonly getAnGangScoreTransfers: (context: AnGangScoringContext) => readonly ScoreTransfer[];
  readonly getBuGangScoreTransfers: (context: BuGangScoringContext) => readonly ScoreTransfer[];
  readonly getSpecialDiscardScoreTransfers: (
    context: SpecialDiscardScoringContext,
  ) => readonly ScoreTransfer[];
  readonly evaluateHu: (context: HuEvaluationContext) => HuEvaluation | null;
  readonly getHuScoreTransfers: (context: HuScoringContext) => readonly ScoreTransfer[];
  readonly getFlowerKongScoreTransfers: (
    context: FlowerKongScoringContext,
  ) => readonly ScoreTransfer[];
}
