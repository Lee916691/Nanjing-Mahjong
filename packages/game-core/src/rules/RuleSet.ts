import type { GameAction } from '../reducer';
import type { GameState } from '../state';

export type RuleSetId = 'nanjing-open';

export interface RuleSet {
  readonly id: RuleSetId;
  readonly displayName: string;
  readonly totalEffectiveDealerTurns: number;
  readonly validateAction: (state: GameState, action: GameAction) => boolean;
  readonly applyAction: (state: GameState, action: GameAction) => GameState;
}
