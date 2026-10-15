import { describe, expect, it } from 'vitest';
import {
  createNanjingMahjongDeck,
  NANJING_OPEN_RULE_SET,
  explainNanjingScore,
} from '../src/index.js';
import type {
  OrdinaryHandTile,
  FlowerTile,
  PendingHuScoringEvent,
  PendingScoringEvent,
} from '../src/index.js';
const deck = createNanjingMahjongDeck();
const tile = (id: string) => deck.find((t) => t.id === id) as OrdinaryHandTile;
const flowers = ['flower-red-center-1', 'flower-fortune-1', 'flower-white-board-1'].map(
  (id) => deck.find((t) => t.id === id) as FlowerTile,
);
function event(source: 'discard' | 'rob-bu-gang' | 'self-draw' = 'discard'): PendingHuScoringEvent {
  const winningTile = tile('wan-9-1');
  const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
    ...(source === 'self-draw'
      ? { source, drawSource: 'wall-head' as const }
      : { source, payerPlayerIndex: 0 }),
    winnerPlayerIndex: 1,
    playerCount: 4,
    winningTile,
    concealedTiles: [
      'wan-1-1',
      'wan-2-1',
      'wan-3-1',
      'wan-4-1',
      'wan-5-1',
      'wan-6-1',
      'wan-7-1',
      'wan-8-1',
      'tiao-1-1',
      'tiao-2-1',
      'tiao-3-1',
      'tiao-5-1',
      'tiao-5-2',
    ].map(tile),
    melds: [],
    flowers,
    allMelds: [],
    dealerIndex: 0,
  })!;
  const details =
    source === 'self-draw'
      ? { source, drawSource: 'wall-head' as const }
      : { source, payerPlayerIndex: 0 };
  return {
    type: 'hu-resolved',
    ...details,
    winnerPlayerIndex: 1,
    winningTile,
    evaluation,
    status: 'pending',
    transfers: NANJING_OPEN_RULE_SET.getHuScoreTransfers({
      ...details,
      winnerPlayerIndex: 1,
      playerCount: 4,
      evaluation,
    }),
  };
}
describe('score explanation snapshots', () => {
  it('retains soft-flower sources for a special hu without adding an unperformed kong', () => {
    const resolution = NANJING_OPEN_RULE_SET.getThreeMouthForcedHuResolution({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      discarderPlayerIndex: 2,
      playerCount: 4,
      winningTile: tile('tong-8-1'),
      concealedTiles: ['tong-8-2', 'tong-8-3', 'tiao-7-1'].map(tile),
      melds: [
        { id: 'm1', type: 'an-gang', tiles: [1, 2, 3, 4].map((n) => tile(`wind-east-${n}`)) },
      ],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
      trigger: 'discard-peng-opportunity',
      forcedBasePattern: 'all-pungs',
    })!;
    expect(resolution.evaluation.softFlowerItems).toEqual([
      { kind: 'missing-suit', count: 1 },
      { kind: 'concealed-kong', count: 2 },
      { kind: 'wind-triplet', count: 1 },
    ]);
    expect(resolution.evaluation.softFlowerCount).toBe(4);
    expect(
      explainNanjingScore({
        type: 'hu-resolved',
        source: 'discard',
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        winningTile: tile('tong-8-1'),
        status: 'pending',
        ...resolution,
      })?.total,
    ).toBe(resolution.transfers.reduce((sum, t) => sum + t.amount, 0));
  });
  it('explains base + menqing + three hard flowers + missing suit, with correct arithmetic', () => {
    const e = event(),
      breakdown = explainNanjingScore(e)!;
    expect(e.evaluation.softFlowerItems).toEqual([{ kind: 'missing-suit', count: 1 }]);
    expect(breakdown.terms).toEqual([
      { label: '底分', points: 10 },
      { label: '门清', points: 10 },
      { label: '硬花 3 个', points: 6 },
      { label: '缺一 1 花', points: 2 },
    ]);
    expect(breakdown.formula).toBe('(10+10+6+2)×2=56');
    expect(breakdown.perPayment).toBe(56);
    expect(breakdown.total).toBe(56);
  });
  it('separates the rob-kong multiplier from doubling', () => {
    const b = explainNanjingScore(event('rob-bu-gang'))!;
    expect(b.formula).toBe('(10+10+6+2)×2×3=168');
    expect(b.factors).toEqual([
      { label: '比下胡', value: 2 },
      { label: '抢补杠', value: 3 },
    ]);
  });
  it('shows three payments for self-draw and redirected packages without multiplying twice', () => {
    const e = event('self-draw'),
      b = explainNanjingScore(e)!;
    expect(b.perPayment).toBe(56);
    expect(b.payments).toBe(3);
    expect(b.total).toBe(168);
    expect(
      explainNanjingScore({
        ...e,
        packageKind: 'three-mouth',
        transfers: e.transfers.map((t) => ({ ...t, fromPlayerIndex: 0 })),
      })?.total,
    ).toBe(168);
  });
  it('keeps heaven win fixed at 1000 per player', () => {
    const e = event('self-draw');
    if (e.source !== 'self-draw') throw new Error('fixture');
    const b = explainNanjingScore({
      ...e,
      drawSource: 'initial-dealer',
      evaluation: {
        ...e.evaluation,
        patterns: ['tian-hu'],
        hardFlowerCount: 0,
        softFlowerCount: 0,
        softFlowerItems: [],
      },
      transfers: e.transfers.map((t) => ({ ...t, amount: 1000 })),
    })!;
    expect(b.formula).toBe('1000=1000');
    expect(b.factors).toEqual([]);
    expect(b.total).toBe(3000);
  });
  it('explains legacy soft-flower totals without inventing their source', () => {
    const e = event();
    const b = explainNanjingScore({
      ...e,
      evaluation: { ...e.evaluation, softFlowerItems: undefined },
    })!;
    expect(b.terms.at(-1)).toEqual({ label: '软花 1 花', points: 2 });
  });
  it('does not publish an equation when metadata disagrees with settled transfers', () => {
    const e = event();
    expect(
      explainNanjingScore({ ...e, transfers: e.transfers.map((t) => ({ ...t, amount: 60 })) }),
    ).toBeUndefined();
  });
  it('explains a non-hu real-time event from the existing rule amount', () => {
    const e: PendingScoringEvent = {
      type: 'an-gang-created',
      playerIndex: 1,
      meldId: 'm',
      status: 'pending',
      transfers: [0, 2, 3].map((i) => ({ fromPlayerIndex: i, toPlayerIndex: 1, amount: 10 })),
    };
    expect(explainNanjingScore(e)?.formula).toBe('5×2=10');
  });
});
