import type { Seat } from './player';
import type { RuleSetId } from './rules';

export interface GameCreationOptions {
  readonly ruleSetId?: RuleSetId;
  readonly dealerIndex?: number;
  readonly dealerSeat?: Seat;
}

export type StartGameOptions = GameCreationOptions;
export type RuleSetOptions = GameCreationOptions;
