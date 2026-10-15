import { describe, expect, it } from 'vitest';
import {
  createNanjingMahjongDeck,
  NANJING_OPEN_RULE_SET,
  explainNanjingScore,
} from '../src/index.js';
import type { FlowerTile, OrdinaryHandTile, PendingHuScoringEvent } from '../src/index.js';

const deck = createNanjingMahjongDeck();
const tile = (id: string) => deck.find((t) => t.id === id) as OrdinaryHandTile;
const flowers = ['flower-red-center-1', 'flower-fortune-1'].map(
  (id) => deck.find((t) => t.id === id) as FlowerTile,
);
const ordinaryFaces = ['wan-1', 'wan-4', 'tiao-2', 'tiao-5', 'tong-3', 'tong-6', 'wind-east'];
function score(source: 'discard' | 'self-draw' | 'rob-bu-gang', faces = ordinaryFaces) {
  const winningTile = tile(`${faces[6]}-2`);
  const details =
    source === 'self-draw'
      ? { source, drawSource: 'wall-head' as const }
      : { source, payerPlayerIndex: 1 };
  const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
    ...details,
    winnerPlayerIndex: 0,
    playerCount: 4,
    winningTile,
    concealedTiles: [
      ...faces.slice(0, 6).flatMap((f) => [tile(`${f}-1`), tile(`${f}-2`)]),
      tile(`${faces[6]}-1`),
    ],
    flowers,
    melds: [],
    allMelds: [],
    dealerIndex: 1,
  })!;
  expect(evaluation).not.toBeNull();
  const event: PendingHuScoringEvent = {
    ...details,
    type: 'hu-resolved',
    winnerPlayerIndex: 0,
    winningTile,
    evaluation,
    status: 'pending',
    transfers: NANJING_OPEN_RULE_SET.getHuScoreTransfers({
      ...details,
      winnerPlayerIndex: 0,
      playerCount: 4,
      evaluation,
    }),
  };
  return event;
}
describe('V1.0.10 seven pairs scores', () => {
  it.each([
    ['discard', 128, 1],
    ['self-draw', 128, 3],
    ['rob-bu-gang', 384, 1],
  ] as const)('%s uses seven pairs +40 and preserves payment topology', (source, amount, count) => {
    const event = score(source);
    expect(event.evaluation.patterns).toEqual(['men-qing', 'seven-pairs']);
    expect(event.transfers).toEqual(
      (source === 'self-draw' ? [1, 2, 3] : [1]).map((fromPlayerIndex) => ({
        fromPlayerIndex,
        toPlayerIndex: 0,
        amount,
      })),
    );
    const explanation = explainNanjingScore(event)!;
    expect(explanation.terms).toContainEqual({ label: '七对', points: 40 });
    expect(explanation.formula).toBe(
      source === 'rob-bu-gang' ? '(10+10+40+4)×2×3=384' : '(10+10+40+4)×2=128',
    );
    expect(explanation.total).toBe(amount * count);
  });
  it.each([
    [['wan-1', 'wan-4', 'tiao-2', 'tiao-5', 'wan-7', 'wan-8', 'wind-east'], 132],
    [['wan-1', 'wan-2', 'wan-3', 'wan-4', 'wan-5', 'wan-6', 'wind-east'], 188],
    [['wan-1', 'wan-2', 'wan-3', 'wan-4', 'wan-5', 'wan-6', 'wan-7'], 208],
  ] as const)('keeps actual missing-suit/one-suit additions (%s)', (faces, amount) => {
    expect(score('discard', [...faces]).transfers[0]!.amount).toBe(amount);
  });
  it('keeps dragon seven pairs +100 without stacking ordinary seven pairs', () => {
    const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'discard',
      payerPlayerIndex: 1,
      winnerPlayerIndex: 0,
      playerCount: 4,
      winningTile: tile('wan-1-4'),
      concealedTiles: [
        tile('wan-1-1'),
        tile('wan-1-2'),
        tile('wan-1-3'),
        ...ordinaryFaces.slice(1, 6).flatMap((f) => [tile(`${f}-1`), tile(`${f}-2`)]),
      ],
      flowers,
      melds: [],
      allMelds: [],
      dealerIndex: 1,
    })!;
    expect(evaluation.patterns).toEqual(['men-qing', 'dragon-seven-pairs']);
    expect(
      NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'discard',
        payerPlayerIndex: 1,
        winnerPlayerIndex: 0,
        playerCount: 4,
        evaluation,
      }),
    ).toEqual([{ fromPlayerIndex: 1, toPlayerIndex: 0, amount: 248 }]);
  });
});
