import { NANJING_OPEN_RULE_SET } from './nanjing-open';
import type { RuleSet, RuleSetId } from './RuleSet';

export const DEFAULT_RULE_SET_ID: RuleSetId = 'nanjing-open';

export const RULE_SET_REGISTRY = {
  [NANJING_OPEN_RULE_SET.id]: NANJING_OPEN_RULE_SET,
} as const satisfies Record<RuleSetId, RuleSet>;

export function getRuleSet(ruleSetId: RuleSetId = DEFAULT_RULE_SET_ID): RuleSet {
  const ruleSet = RULE_SET_REGISTRY[ruleSetId];

  if (!ruleSet) {
    throw new Error(`Unsupported rule set ${ruleSetId}`);
  }

  return ruleSet;
}

export function listRuleSets(): RuleSet[] {
  return Object.values(RULE_SET_REGISTRY);
}

export { NANJING_OPEN_RULE_SET } from './nanjing-open';
export type {
  AnGangScoringContext,
  BuGangReactionAvailabilityContext,
  BuGangScoringContext,
  DiscardReactionAvailabilityContext,
  FlowerKongScoringContext,
  HuEvaluationContext,
  HuScoringContext,
  MingGangScoringContext,
  ReactionAvailabilityContext,
  RuleSet,
  RuleSetId,
} from './RuleSet';
