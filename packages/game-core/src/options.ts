import type { RuleSetId } from './rules';

export interface GameCreationOptions {
  readonly ruleSetId?: RuleSetId;
}

export type StartGameOptions = GameCreationOptions;
export type RuleSetOptions = GameCreationOptions;
