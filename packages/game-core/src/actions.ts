import type { Seat } from './player';
import type { RuleSetId } from './rules/RuleSet';
import type { OrdinaryTileFace } from './state';

export type StartGameAction = {
  type: 'START_GAME';
  ruleSetId?: RuleSetId;
  dealerIndex?: number;
  dealerSeat?: Seat;
};
export type DrawAction = { type: 'DRAW_TILE' };
export type DiscardAction =
  { type: 'DISCARD_TILE'; tileId: string } | { type: 'DISCARDED_TILE'; tileId: string };
export type ReactionResponseType = 'pass' | 'hu' | 'peng' | 'ming-gang';
export type SubmitReactionAction = {
  type: 'SUBMIT_REACTION';
  playerIndex: number;
  responseType: ReactionResponseType;
};
export type PassReactionAction = { type: 'PASS_REACTION'; playerIndex: number };
export type ResolveReactionWindowAction = { type: 'RESOLVE_REACTION_WINDOW' };
export type DeclareAnGangAction = {
  type: 'DECLARE_AN_GANG';
  playerIndex: number;
  tileFace: OrdinaryTileFace;
};
export type DeclareBuGangAction = {
  type: 'DECLARE_BU_GANG';
  playerIndex: number;
  meldId: string;
};
export type DeclareSelfDrawHuAction = {
  type: 'DECLARE_SELF_DRAW_HU';
  playerIndex: number;
};
export type DiHuDecision = 'declare' | 'pass';
export type SubmitDiHuDecisionAction = {
  type: 'SUBMIT_DI_HU_DECISION';
  playerIndex: number;
  decision: DiHuDecision;
};
export type ClaimReactionAction = { type: 'PENG' } | { type: 'GANG' } | { type: 'HU' };
export type ReactionAction = SubmitReactionAction | PassReactionAction | ClaimReactionAction;
export type GameAction =
  | StartGameAction
  | DrawAction
  | DiscardAction
  | ReactionAction
  | ResolveReactionWindowAction
  | DeclareAnGangAction
  | DeclareBuGangAction
  | DeclareSelfDrawHuAction
  | SubmitDiHuDecisionAction;
