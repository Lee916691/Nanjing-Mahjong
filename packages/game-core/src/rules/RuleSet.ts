import type { GameAction } from '../actions';
import type {
  FlowerKongKind,
  GameState,
  ReactionAvailability,
  ReactionWindow,
  ScoreTransfer,
  ScoringEventCreationStage,
} from '../state';

export type RuleSetId = 'nanjing-open';

export interface MingGangScoringContext {
  readonly receiverPlayerIndex: number;
  readonly payerPlayerIndex: number;
  readonly playerCount: number;
  readonly meldId: string;
}

export interface FlowerKongScoringContext {
  readonly playerIndex: number;
  readonly playerCount: number;
  readonly kind: FlowerKongKind;
  readonly createdDuring: ScoringEventCreationStage;
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
  readonly getFlowerKongScoreTransfers: (
    context: FlowerKongScoringContext,
  ) => readonly ScoreTransfer[];
}
