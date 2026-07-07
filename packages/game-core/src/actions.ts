import type { RuleSetId } from './rules/RuleSet';

export type StartGameAction = { type: 'START_GAME'; ruleSetId?: RuleSetId };
export type DrawAction = { type: 'DRAW_TILE' };
export type DiscardAction =
  { type: 'DISCARD_TILE'; tileId: string } | { type: 'DISCARDED_TILE'; tileId: string };
export type ReactionAction = { type: 'PENG' } | { type: 'GANG' } | { type: 'HU' };
export type GameAction = StartGameAction | DrawAction | DiscardAction | ReactionAction;
