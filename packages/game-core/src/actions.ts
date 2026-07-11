import type { Seat } from './player';
import type { RuleSetId } from './rules/RuleSet';

export type StartGameAction = {
  type: 'START_GAME';
  ruleSetId?: RuleSetId;
  dealerIndex?: number;
  dealerSeat?: Seat;
};
export type DrawAction = { type: 'DRAW_TILE' };
export type DiscardAction =
  { type: 'DISCARD_TILE'; tileId: string } | { type: 'DISCARDED_TILE'; tileId: string };
export type PassReactionAction = { type: 'PASS_REACTION' };
export type ClaimReactionAction = { type: 'PENG' } | { type: 'GANG' } | { type: 'HU' };
export type ReactionAction = PassReactionAction | ClaimReactionAction;
export type GameAction = StartGameAction | DrawAction | DiscardAction | ReactionAction;
