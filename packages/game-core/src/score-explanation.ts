import type { PendingScoringEvent, PackageEvaluation, HuPattern, SoftFlowerKind } from './state.js';
import { PATTERN_POINTS } from './rules/nanjing-open.js';
import type { RuleSetId } from './rules/RuleSet.js';

export interface ScoreBreakdown {
  terms: { label: string; points: number }[];
  factors: { label: string; value: number }[];
  formula: string;
  perPayment: number;
  payments: number;
  total: number;
  winner?: number;
}
const patternNames: Record<HuPattern, string> = {
  'men-qing': '门清',
  'all-pungs': '对对胡',
  'global-single-wait': '全球独钓',
  'mixed-one-suit': '混一色',
  'pure-one-suit': '清一色',
  'seven-pairs': '七对',
  'dragon-seven-pairs': '龙七对',
  'no-flower': '无花果',
  'pressure-absolute': '压绝',
  'di-hu': '地胡',
  'tian-hu': '天胡',
  'hua-kai': '花开',
  'gang-kai': '杠开',
};
const softNames: Record<SoftFlowerKind, string> = {
  'self-draw': '自摸加花',
  'missing-suit': '缺一',
  'exposed-kong': '明／补杠',
  'concealed-kong': '暗杠',
  'wind-triplet': '风刻',
  'closed-wait': '压当',
  'edge-wait': '边张',
  'single-wait': '独占',
};
function huTerms(evaluation: PackageEvaluation): ScoreBreakdown['terms'] {
  const terms: ScoreBreakdown['terms'] = [{ label: '底分', points: 10 }];
  for (const pattern of evaluation.patterns)
    terms.push({ label: patternNames[pattern], points: PATTERN_POINTS[pattern] });
  if (evaluation.hardFlowerCount)
    terms.push({
      label: `硬花 ${evaluation.hardFlowerCount} 个`,
      points: evaluation.hardFlowerCount * 2,
    });
  if (evaluation.softFlowerCount) {
    const items = evaluation.softFlowerItems;
    if (
      items?.length &&
      items.every(
        (item) =>
          Object.hasOwn(softNames, item.kind) && Number.isInteger(item.count) && item.count > 0,
      ) &&
      items.reduce((total, item) => total + item.count, 0) === evaluation.softFlowerCount
    ) {
      for (const item of items)
        terms.push({ label: `${softNames[item.kind]} ${item.count} 花`, points: item.count * 2 });
    } else
      terms.push({
        label: `软花 ${evaluation.softFlowerCount} 花`,
        points: evaluation.softFlowerCount * 2,
      });
  }
  return terms;
}
/** Describe committed rule amounts; never infer missing historical pattern details from a total. */
export function explainNanjingScore(
  event: PendingScoringEvent,
  ruleSetId: RuleSetId = 'nanjing-open',
): ScoreBreakdown | undefined {
  const duo = ruleSetId === 'nanjing-open-duo';
  let terms: ScoreBreakdown['terms'];
  let factors: ScoreBreakdown['factors'] = [{ label: '比下胡', value: 2 }];
  let winner: number | undefined;
  if (event.type === 'hu-resolved') {
    winner = event.winnerPlayerIndex;
    if (event.evaluation.patterns.includes('tian-hu')) {
      terms = [{ label: '天胡定额', points: 1000 }];
      factors = [];
    } else {
      terms = huTerms(event.evaluation);
      if (event.source === 'rob-bu-gang' && !duo) factors.push({ label: '抢补杠', value: 3 });
    }
  } else if (event.type === 'package-resolved') {
    winner = event.result.winnerPlayerIndex;
    terms = huTerms(event.result.evaluation);
  } else {
    const label =
      event.type === 'an-gang-created'
        ? '暗杠'
        : event.type === 'ming-gang-created'
          ? '明杠'
          : event.type === 'bu-gang-created'
            ? '补杠'
            : event.type === 'flower-kong-created'
              ? '花杠'
              : event.source === 'four-winds-gathered'
                ? '四风归齐'
                : event.source === 'follow-discard'
                  ? '跟打一圈'
                  : '同牌四打';
    const base = ['ming-gang-created', 'bu-gang-created', 'flower-kong-created'].includes(
      event.type,
    )
      ? 10
      : event.type === 'an-gang-created' && duo
        ? 10
        : 5;
    terms = [{ label, points: base }];
  }
  const perPayment =
    terms.reduce((sum, t) => sum + t.points, 0) *
    factors.reduce((product, f) => product * f.value, 1);
  if (!event.transfers.length || event.transfers.some((t) => t.amount !== perPayment)) return;
  const addition = terms.map((t) => t.points).join('+');
  const formula =
    (terms.length > 1 ? `(${addition})` : addition) +
    factors.map((f) => `×${f.value}`).join('') +
    `=${perPayment}`;
  return {
    terms,
    factors,
    formula,
    perPayment,
    payments: event.transfers.length,
    total: event.transfers.reduce((sum, t) => sum + t.amount, 0),
    ...(winner === undefined ? {} : { winner }),
  };
}
