import type { GameAction } from '../actions';
import type { Meld } from '../meld';
import type {
  FlowerKongKind,
  GameState,
  ReactionAvailability,
  ReactionWindow,
  ScoreTransfer,
  ScoringEventCreationStage,
  FlowerTile,
  HuEvaluation,
  HuSource,
  OrdinaryHandTile,
} from '../state';

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

export interface HuEvaluationContext {
  readonly source: HuSource;
  readonly winnerPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly playerCount: number;
  readonly winningTile: OrdinaryHandTile;
  readonly concealedTiles: readonly OrdinaryHandTile[];
  readonly melds: readonly Meld[];
  readonly flowers: readonly FlowerTile[];
  readonly allMelds: readonly Meld[];
}

export interface HuScoringContext {
  readonly source: HuSource;
  readonly winnerPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly playerCount: number;
  readonly evaluation: HuEvaluation;
}

export interface RuleSet {
  readonly id: RuleSetId;
  readonly displayName: string;
  readonly totalEffectiveDealerTurns: number;
  readonly validateAction: (state: GameState, action: GameAction) => boolean;
  readonly applyAction: (state: GameState, action: GameAction) => GameState;
  readonly getAvailableReactions: (
    state: GameState,
    reactionWindow: ReactionWindow,
  ) => readonly ReactionAvailability[];
  readonly getMingGangScoreTransfers: (context: MingGangScoringContext) => readonly ScoreTransfer[];
  readonly getAnGangScoreTransfers: (context: AnGangScoringContext) => readonly ScoreTransfer[];
  readonly getBuGangScoreTransfers: (context: BuGangScoringContext) => readonly ScoreTransfer[];
  readonly evaluateHu: (context: HuEvaluationContext) => HuEvaluation | null;
  readonly getHuScoreTransfers: (context: HuScoringContext) => readonly ScoreTransfer[];
  readonly getFlowerKongScoreTransfers: (
    context: FlowerKongScoringContext,
  ) => readonly ScoreTransfer[];
}
