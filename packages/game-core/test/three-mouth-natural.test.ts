import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  completeCurrentHand,
  settlePendingScoringEvents,
} from '../src/index.js';
import type { FlowerTile, GameState, OrdinaryHandTile, TileId } from '../src/index.js';

const deck = createNanjingMahjongDeck();
const tile = (id: string) => deck.find((t) => t.id === id) as OrdinaryHandTile;
function naturalState(selfDraw: boolean, allPungs = true, discarder = 2): GameState {
  const base = createGame();
  const winningTile = tile('tong-7-2');
  return {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    nextMeldSequence: 4,
    currentPlayerIndex: selfDraw ? 1 : discarder,
    pendingAction: {
      type: 'discard',
      playerIndex: selfDraw ? 1 : discarder,
      seat: base.players[selfDraw ? 1 : discarder]!.seat,
    },
    wall: [tile('wind-north-4')],
    players: base.players.map((p, i) => ({
      ...p,
      flowers:
        i === 1 && !allPungs
          ? [
              'flower-red-center-1',
              'flower-fortune-1',
              'flower-white-board-1',
              'flower-plum-1',
            ].map((id) => deck.find((t) => t.id === id) as FlowerTile)
          : [],
      hand:
        i === 1
          ? [
              ...(allPungs
                ? ['wan-5-1', 'wan-5-2', 'wan-5-3']
                : ['wan-4-1', 'wan-5-1', 'wan-6-1']
              ).map(tile),
              tile('tong-7-1'),
              ...(selfDraw ? [winningTile] : []),
            ]
          : i === discarder && !selfDraw
            ? [winningTile]
            : [],
      melds:
        i === 1
          ? ['wan-1', 'tiao-2', 'tong-3'].map((face, n) => ({
              id: `meld-${n + 1}`,
              type: 'peng' as const,
              tiles: [1, 2, 3].map((c) => tile(`${face}-${c}`)),
              fromPlayerIndex: 0,
              claimedTileId: `${face}-1` as TileId,
            }))
          : [],
    })),
    threeMouthState: [
      base.threeMouthState[0],
      { status: 'active', payerPlayerIndex: 0 },
      base.threeMouthState[2],
      base.threeMouthState[3],
    ],
    ...(selfDraw
      ? {
          selfDrawProvenance: {
            source: 'wall-head' as const,
            playerIndex: 1,
            tileId: winningTile.id,
          },
        }
      : {}),
  };
}
function finish(state: GameState, selfDraw: boolean) {
  if (selfDraw) return applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
  let next = applyAction(state, { type: 'DISCARD_TILE', tileId: 'tong-7-2' });
  expect(
    next.reactionWindow!.availableReactions.find((r) => r.playerIndex === 1)!.responseTypes,
  ).toContain('hu');
  for (const r of next.reactionWindow!.responderOrder)
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: r.playerIndex,
      responseType: r.playerIndex === 1 ? 'hu' : 'pass',
    });
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}
describe('natural three-mouth wins through the full engine', () => {
  it('clears active three-mouth on a drawn hand without creating a package settlement', () => {
    const state = naturalState(false);
    const ended = applyAction(
      {
        ...state,
        wall: [],
        turnStage: 'waiting-for-draw',
        pendingAction: { type: 'draw', playerIndex: 2, seat: 'west' },
      },
      { type: 'DRAW_TILE' },
    );
    expect(ended.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(ended.threeMouthState).toEqual(createGame().threeMouthState);
    expect(ended.handProgressFacts.packageSettlementCount).toBe(0);
  });
  it.each([
    ['third-party', false, 2, 'all-pungs'],
    ['supplier', false, 0, 'global-single-wait'],
    ['self-draw', true, 2, 'global-single-wait'],
  ] as const)(
    '%s retains natural validation and redirects three shares',
    (_name, selfDraw, discarder, pattern) => {
      const ended = finish(naturalState(selfDraw, true, discarder), selfDraw);
      expect(ended.phase).toBe('ended');
      expect(ended.threeMouthState).toEqual(createGame().threeMouthState);
      const event = ended.pendingScoringEvents.find((e) => e.type === 'hu-resolved')!;
      if (event.type !== 'hu-resolved') throw new Error('fixture');
      expect(event.evaluation.structure.type).toBe('standard');
      expect(event.evaluation.patterns).toContain(pattern);
      if (pattern === 'global-single-wait')
        expect(event.evaluation.patterns).not.toContain('all-pungs');
      expect(event.packageKind).toBe('three-mouth');
      expect(event.transfers).toHaveLength(3);
      expect(event.transfers.every((t) => t.fromPlayerIndex === 0 && t.toPlayerIndex === 1)).toBe(
        true,
      );
      expect(ended.handProgressFacts.packageSettlementCount).toBe(1);
      for (const turn of [15, 16]) {
        const settled = settlePendingScoringEvents({
          ...createMatch(),
          status: 'playing',
          currentHandStatus: 'playing',
          effectiveDealerTurn: turn,
          isFinalDealerTurn: turn === 16,
          currentHand: ended,
        });
        expect(settled.cumulativeScores.reduce((a, b) => a + b)).toBe(4000);
        const completed = completeCurrentHand(settled);
        expect(completed.effectiveDealerTurn).toBe(turn);
        expect(completed.status).toBe('playing');
      }
    },
  );
  it.each([false, true])(
    'does not redirect a natural non-all-pungs win (selfDraw=%s)',
    (selfDraw) => {
      const ended = finish(naturalState(selfDraw, false), selfDraw);
      expect(ended.phase).toBe('ended');
      expect(ended.threeMouthState).toEqual(createGame().threeMouthState);
      expect(ended.handProgressFacts.packageSettlementCount).toBe(0);
      const event = ended.pendingScoringEvents.find((e) => e.type === 'hu-resolved')!;
      if (event.type !== 'hu-resolved') throw new Error('fixture');
      expect(event.packageKind).toBeUndefined();
      expect(event.transfers.map((t) => t.fromPlayerIndex)).toEqual(selfDraw ? [0, 2, 3] : [2]);
    },
  );
});
