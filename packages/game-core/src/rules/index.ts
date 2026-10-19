import { NANJING_OPEN_RULE_SET, NANJING_OPEN_DUO_RULE_SET } from './nanjing-open.js';
import type { RuleSet, RuleSetId } from './RuleSet.js';

export const DEFAULT_RULE_SET_ID: RuleSetId = 'nanjing-open';

export const RULE_SET_REGISTRY = {
  'nanjing-open': NANJING_OPEN_RULE_SET,
  'nanjing-open-duo': NANJING_OPEN_DUO_RULE_SET,
} as const satisfies Record<RuleSetId, RuleSet>;

export function getRuleSet(ruleSetId: RuleSetId = DEFAULT_RULE_SET_ID): RuleSet {
  const ruleSet = RULE_SET_REGISTRY[ruleSetId];

  if (!ruleSet) {
    throw new Error(`Unsupported rule set ${ruleSetId}`);
  }

  return ruleSet;
}

export function isRuleSetId(value: unknown): value is RuleSetId {
  return value === 'nanjing-open' || value === 'nanjing-open-duo';
}

export function listRuleSets(): RuleSet[] {
  return Object.values(RULE_SET_REGISTRY);
}

export { NANJING_OPEN_RULE_SET, NANJING_OPEN_DUO_RULE_SET } from './nanjing-open.js';
export type {
  AnGangScoringContext,
  BuGangReactionAvailabilityContext,
  BuGangScoringContext,
  DiscardReactionAvailabilityContext,
  FlowerKongScoringContext,
  HuEvaluationContext,
  HuScoringContext,
  ThreeMouthForcedHuContext,
  ThreeMouthForcedHuResolution,
  MingGangScoringContext,
  ReactionAvailabilityContext,
  SpecialDiscardScoringContext,
  RuleSet,
  RuleSetId,
} from './RuleSet.js';
