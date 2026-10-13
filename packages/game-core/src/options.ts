import type { Seat } from './player.js';
import type { RuleSetId } from './rules/index.js';

export interface GameCreationOptions {
  readonly ruleSetId?: RuleSetId;
  readonly dealerIndex?: number;
  readonly dealerSeat?: Seat;
}

export type StartGameOptions = GameCreationOptions;
export type RuleSetOptions = GameCreationOptions;
