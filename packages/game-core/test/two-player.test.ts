import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  explainNanjingScore,
  getAvailableSelfDrawHu,
  getAvailableAnGangs,
  getRuleSet,
  prepareNextHand,
  startGame,
  type FlowerTile,
  type GameState,
  type OrdinaryHandTile,
  type RuleSetId,
  type Meld,
  type MatchState,
} from '../src';

const duo = 'nanjing-open-duo' as RuleSetId;
const deck = createNanjingMahjongDeck();
const tile = (id: string) => {
  const found = deck.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing tile ${id}`);
  return found;
};
const ordinary = (id: string) => tile(id) as OrdinaryHandTile;
const flowers = ['flower-plum-1', 'flower-orchid-1'].map((id) => tile(id) as FlowerTile);
const sevenPairs = [
  'wan-1-1',
  'wan-1-2',
  'wan-2-1',
  'wan-2-2',
  'wan-3-1',
  'wan-3-2',
  'tiao-1-1',
  'tiao-1-2',
  'tiao-2-1',
  'tiao-2-2',
  'tong-1-1',
  'tong-1-2',
  'tong-2-1',
].map(ordinary);
const standard = [
  'wan-1-1',
  'wan-2-1',
  'wan-3-1',
  'wan-4-1',
  'wan-5-1',
  'wan-6-1',
  'tiao-1-1',
  'tiao-2-1',
  'tiao-3-1',
  'tong-1-1',
  'tong-2-1',
  'tong-3-1',
  'wind-east-1',
].map(ordinary);

function waiting(hand = sevenPairs, winning = ordinary('tong-2-2')): GameState {
  const base = createGame({ ruleSetId: duo });
  const used = new Set([...hand, ...flowers, winning].map((entry) => entry.id));
  const otherHand = deck
    .filter(
      (entry): entry is OrdinaryHandTile => entry.category !== 'flower' && !used.has(entry.id),
    )
    .slice(0, 13);
  otherHand.forEach((entry) => used.add(entry.id));
  return {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-draw',
    currentPlayerIndex: 1,
    pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
    players: base.players.map((player, index) =>
      index === 1 ? { ...player, hand, flowers } : { ...player, hand: otherHand },
    ),
    wall: [winning, ...deck.filter((entry) => !used.has(entry.id))],
  };
}

function peng(face: string, index: number, kind: 'peng' | 'an-gang' = 'peng'): Meld {
  const tiles = [1, 2, 3, ...(kind === 'an-gang' ? [4] : [])].map((copy) =>
    ordinary(`${face}-${copy}`),
  );
  return {
    id: `meld-${index}`,
    type: kind,
    tiles,
    ...(kind === 'peng' ? { fromPlayerIndex: 0, claimedTileId: tiles[2]!.id } : {}),
  } as Meld;
}

function packageState(
  melds: Meld[],
  hand: OrdinaryHandTile[],
  winning: OrdinaryHandTile,
  active = true,
): GameState {
  const base = createGame({ ruleSetId: duo });
  const used = new Set(
    [...melds.flatMap((meld) => meld.tiles), ...hand, winning, ...flowers].map((entry) => entry.id),
  );
  const other = deck
    .filter(
      (entry): entry is OrdinaryHandTile => entry.category !== 'flower' && !used.has(entry.id),
    )
    .slice(0, 13);
  other.forEach((entry) => used.add(entry.id));
  return {
    ...base,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    players: base.players.map((player, index) =>
      index === 0 ? { ...player, hand: [...other, winning] } : { ...player, hand, melds, flowers },
    ),
    wall: deck.filter((entry) => !used.has(entry.id)),
    nextMeldSequence: 10,
    threeMouthState: [
      base.threeMouthState[0]!,
      active ? { status: 'active', payerPlayerIndex: 0 } : { status: 'invalid' },
    ],
  };
}

function claim(
  initial: GameState,
  winning: OrdinaryHandTile,
  responseType: 'hu' | 'peng' | 'ming-gang' | 'pass' = 'hu',
): GameState {
  let state = applyAction(initial, { type: 'DISCARD_TILE', tileId: winning.id });
  state = applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType });
  return applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
}

function scoreEvent(state: GameState) {
  return state.pendingScoringEvents.find(
    (event) => event.type === 'hu-resolved' || event.type === 'package-resolved',
  )!;
}

const mixedPengs = () => ['wan-1', 'tiao-1', 'tong-1'].map((face, index) => peng(face, index));

function passDecisions(initial: GameState): GameState {
  let state = initial;
  while (state.diHuDeclarations?.status === 'collecting') {
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: state.diHuDeclarations.pendingPlayerIndices[0]!,
      decision: 'pass',
    });
  }
  return state;
}

describe('two-player Nanjing open mode', () => {
  it('creates exactly two players, two scores and eight effective turns without changing defaults', () => {
    const match = createMatch({ ruleSetId: duo });
    expect(match.currentHand.players).toHaveLength(2);
    expect(match.currentHand.threeMouthState).toHaveLength(2);
    expect(match.cumulativeScores).toEqual([1000, 1000]);
    expect(match.totalEffectiveDealerTurns).toBe(8);
    expect(createMatch().currentHand.players).toHaveLength(4);
    expect(createMatch().totalEffectiveDealerTurns).toBe(16);
    expect(() => createGame({ ruleSetId: duo, dealerIndex: 2 })).toThrow();
  });

  it.each([0, 1])(
    'deals the full 144-tile deck with dealer %s and no phantom responders',
    (dealerIndex) => {
      let game = passDecisions(startGame(createGame({ ruleSetId: duo, dealerIndex })));
      expect(game.players.map((player) => player.hand.length)).toEqual(
        dealerIndex === 0 ? [14, 13] : [13, 14],
      );
      const all = [
        ...game.wall,
        ...game.players.flatMap((player) => [...player.hand, ...player.flowers]),
      ];
      expect(all).toHaveLength(144);
      expect(new Set(all.map((entry) => entry.id)).size).toBe(144);
      for (let turn = 0; turn < 6; turn++) {
        const current = game.currentPlayerIndex;
        game = applyAction(game, {
          type: 'DISCARD_TILE',
          tileId: game.players[current]!.hand.at(-1)!.id,
        });
        expect(
          game.reactionWindow?.responderOrder.map((responder) => responder.playerIndex),
        ).toEqual([1 - current]);
        game = applyAction(game, {
          type: 'SUBMIT_REACTION',
          playerIndex: 1 - current,
          responseType: 'pass',
        });
        game = applyAction(game, { type: 'RESOLVE_REACTION_WINDOW' });
        expect(game.currentPlayerIndex).toBe(1 - current);
        game = applyAction(game, { type: 'DRAW_TILE' });
      }
    },
  );

  it('pays seven pairs 128 on discard and 136 on self draw with one transfer', () => {
    const state = waiting();
    const rules = getRuleSet(duo);
    const context = {
      playerCount: 2,
      winnerPlayerIndex: 1,
      concealedTiles: sevenPairs,
      winningTile: ordinary('tong-2-2'),
      melds: [],
      allMelds: [],
      flowers,
    };
    const evaluation = rules.evaluateHu({ ...context, source: 'discard', payerPlayerIndex: 0 })!;
    expect(
      rules.getHuScoreTransfers({
        source: 'discard',
        playerCount: 2,
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        evaluation,
      }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 128 }]);
    const match = applyGameActionToMatch(
      {
        ...createMatch({ ruleSetId: duo }),
        status: 'playing',
        currentHandStatus: 'playing',
        currentHand: applyAction(state, { type: 'DRAW_TILE' }),
      },
      { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 },
    );
    expect(match.cumulativeScores).toEqual([864, 1136]);
    expect(match.currentHand.result).toMatchObject({
      source: 'self-draw',
      winner: {
        evaluation: {
          softFlowerItems: [{ kind: 'self-draw', count: 2 }],
          softFlowerCount: 2,
        },
      },
    });
  });

  it('explains the extra two soft flowers and one payment from the same snapshot', () => {
    const resolved = applyAction(applyAction(waiting(), { type: 'DRAW_TILE' }), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const event = resolved.pendingScoringEvents.find((entry) => entry.type === 'hu-resolved')!;
    expect(explainNanjingScore(event, duo)).toMatchObject({
      perPayment: 136,
      payments: 1,
      total: 136,
      terms: expect.arrayContaining([{ label: '自摸加花 2 花', points: 4 }]),
    });
  });

  it('charges only one normal payment for robbing a supplemental kong', () => {
    const rules = getRuleSet(duo);
    const hand = [...standard.filter((entry) => entry.id !== 'tong-3-1'), ordinary('wind-east-2')];
    const exposed = peng('tong-3', 0);
    const evaluation = rules.evaluateHu({
      source: 'rob-bu-gang',
      playerCount: 2,
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      concealedTiles: hand,
      winningTile: ordinary('tong-3-4'),
      melds: [],
      allMelds: [exposed],
      flowers,
    })!;
    expect(evaluation.patterns).toEqual(['men-qing', 'pressure-absolute']);
    const transfers = rules.getHuScoreTransfers({
      source: 'rob-bu-gang',
      playerCount: 2,
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      evaluation,
    });
    expect(transfers).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 108 }]);
  });

  it.each([
    'special-discard',
    'natural-discard',
    'natural-self-draw',
    'special-self-draw',
  ] as const)('keeps three-mouth behavior, one payment and one bonus for %s', (kind) => {
    const selfDraw = kind.endsWith('self-draw');
    const winning = ordinary(`wan-7-${kind === 'special-self-draw' ? 4 : 3}`);
    const hand = (
      kind === 'special-discard'
        ? ['wan-7-1', 'wan-7-2', 'tiao-8-1', 'tong-9-1']
        : kind === 'special-self-draw'
          ? ['wan-7-1', 'wan-7-2', 'wan-7-3', 'tiao-8-1']
          : ['wan-7-1', 'wan-7-2', 'tiao-8-1', 'tiao-8-2']
    ).map(ordinary);
    const base = packageState(mixedPengs(), hand, winning);
    let ended: GameState;
    if (selfDraw) {
      const state: GameState = {
        ...base,
        currentPlayerIndex: 1,
        turnStage: 'waiting-for-draw',
        pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
        players: base.players.map((player, index) =>
          index === 0
            ? { ...player, hand: player.hand.filter((entry) => entry.id !== winning.id) }
            : player,
        ),
        wall: [winning, ...base.wall],
      };
      const drawn = applyAction(state, { type: 'DRAW_TILE' });
      if (kind === 'special-self-draw') expect(getAvailableAnGangs(drawn, 1)).toEqual([]);
      ended = applyAction(drawn, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
    } else ended = claim(base, winning);
    expect(ended.phase).toBe('ended');
    expect(ended.players[1]!.melds).toHaveLength(3);
    const event = scoreEvent(ended);
    expect(event.transfers).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 196 }]);
    expect(explainNanjingScore(event, duo)).toMatchObject({ payments: 1, total: 196 });
    expect(ended.handProgressFacts.packageSettlementCount).toBe(1);
    const match = completeCurrentHand({
      ...createMatch({ ruleSetId: duo }),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: ended,
    });
    expect(match.cumulativeScores).toEqual([804, 1196]);
    expect(match.dealerIndex).toBe(0);
    expect(applyAction(ended, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(ended);
  });

  it('allows declining a special discard hu without permitting the replaced peng', () => {
    const winning = ordinary('wan-7-3');
    const base = packageState(
      mixedPengs(),
      ['wan-7-1', 'wan-7-2', 'tiao-8-1', 'tong-9-1'].map(ordinary),
      winning,
    );
    const discarded = applyAction(base, { type: 'DISCARD_TILE', tileId: winning.id });
    expect(discarded.reactionWindow?.availableReactions[0]?.responseTypes).toEqual(['pass', 'hu']);
    expect(
      applyAction(discarded, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' }),
    ).toBe(discarded);
    const passed = claim(base, winning, 'pass');
    expect(passed.phase).toBe('playing');
    expect(passed.players[1]!.passHu).toBe(true);
    expect(passed.threeMouthState[1]).toEqual({ status: 'active', payerPlayerIndex: 0 });
  });

  it.each(['peng', 'ming-gang'] as const)(
    'retains three-pure %s order when three-mouth is invalid',
    (kind) => {
      const winning = ordinary(`wan-4-${kind === 'peng' ? 3 : 4}`);
      const hand = (
        kind === 'peng'
          ? ['wan-4-1', 'wan-4-2', 'wan-5-1', 'wan-6-1']
          : ['wan-4-1', 'wan-4-2', 'wan-4-3', 'wan-5-1']
      ).map(ordinary);
      const melds = ['wan-1', 'wan-2', 'wan-3'].map((face, index) => peng(face, index, 'an-gang'));
      const ended = claim(packageState(melds, hand, winning, false), winning, kind);
      expect(ended.result).toMatchObject({
        type: 'package',
        kind: 'three-pure',
        evaluation: {
          softFlowerItems: expect.arrayContaining([{ kind: 'self-draw', count: 2 }]),
        },
      });
      const event = scoreEvent(ended);
      expect(event.transfers).toEqual([
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: kind === 'peng' ? 300 : 324 },
      ]);
      expect(
        ended.pendingScoringEvents.filter((entry) => entry.type === 'ming-gang-created'),
      ).toHaveLength(kind === 'ming-gang' ? 1 : 0);
      const completed = completeCurrentHand({
        ...createMatch({ ruleSetId: duo }),
        status: 'playing',
        currentHandStatus: 'playing',
        currentHand: ended,
      });
      expect(completed.cumulativeScores).toEqual(kind === 'peng' ? [700, 1300] : [656, 1344]);
    },
  );

  it.each([true, false])(
    'adds the bonus to a global discard only when the rack actually applies: %s',
    (active) => {
      const melds = ['wan-1', 'tiao-1', 'tong-1'].map((face, index) =>
        peng(face, index, 'an-gang'),
      );
      melds.push(peng('wan-2', 3));
      const winning = ordinary('tiao-5-2');
      const base = packageState(melds, [ordinary('tiao-5-1')], winning, false);
      const ended = claim(
        {
          ...base,
          globalRacks: {
            1: {
              tile: ordinary('tiao-6-1'),
              wait: { category: 'number', suit: 'tiao', rank: 5 },
              active,
            },
          },
        },
        winning,
      );
      expect(scoreEvent(ended).transfers).toEqual([
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: active ? 220 : 212 },
      ]);
      expect(ended.handProgressFacts.packageSettlementCount).toBe(active ? 1 : 0);
      expect(
        completeCurrentHand({
          ...createMatch({ ruleSetId: duo }),
          status: 'playing',
          currentHandStatus: 'playing',
          currentHand: ended,
        }).cumulativeScores,
      ).toEqual(active ? [780, 1220] : [788, 1212]);
    },
  );

  it('does not change no-flower eligibility or let soft flowers satisfy the hard-flower threshold', () => {
    const rules = getRuleSet(duo);
    const context = {
      source: 'self-draw' as const,
      drawSource: 'wall-head' as const,
      playerCount: 2,
      winnerPlayerIndex: 1,
      winningTile: ordinary('tong-2-2'),
      concealedTiles: sevenPairs,
      melds: [],
      allMelds: [],
      flowers: [],
    };
    expect(rules.evaluateHu(context)?.patterns).toContain('no-flower');
    const concealed = [
      'wan-1-1',
      'wan-2-1',
      'wan-3-1',
      'wan-4-1',
      'wan-5-1',
      'wan-6-1',
      'tong-1-1',
      'tong-2-1',
      'wind-east-1',
      'wind-east-2',
    ].map(ordinary);
    expect(
      rules.evaluateHu({
        ...context,
        winningTile: ordinary('tong-3-1'),
        concealedTiles: concealed,
        melds: [peng('tiao-1', 0)],
        allMelds: [peng('tiao-1', 0)],
        flowers,
      }),
    ).toBeNull();
  });

  it('keeps tian hu fixed and adds the bonus alongside hua kai or gang kai exactly once', () => {
    const rules = getRuleSet(duo);
    for (const drawSource of [
      'initial-dealer',
      'ming-gang-tail',
      'an-gang-tail',
      'bu-gang-tail',
      'flower-replacement',
    ] as const) {
      const context = {
        source: 'self-draw' as const,
        playerCount: 2,
        winnerPlayerIndex: 1,
        concealedTiles: sevenPairs,
        winningTile: ordinary('tong-2-2'),
        melds: [],
        allMelds: [],
        flowers,
        ...(drawSource === 'flower-replacement'
          ? { drawSource, formedFlowerKongDuringReplacement: false }
          : { drawSource }),
      };
      const evaluation = rules.evaluateHu(context)!;
      const transfers = rules.getHuScoreTransfers({ ...context, evaluation });
      expect(transfers).toHaveLength(1);
      if (drawSource === 'initial-dealer') {
        expect(transfers[0]!.amount).toBe(1000);
        expect(evaluation.softFlowerCount).toBe(0);
      } else {
        expect(evaluation.softFlowerItems?.filter((item) => item.kind === 'self-draw')).toEqual([
          { kind: 'self-draw', count: 2 },
        ]);
        expect(transfers[0]!.amount).toBe(drawSource === 'flower-replacement' ? 156 : 176);
      }
    }
  });

  it.each(['ming-gang-tail', 'flower-replacement'] as const)(
    'retains gang responsibility and only one bonus for %s',
    (source) => {
      const meld = {
        ...peng('wan-1', 0, 'an-gang'),
        type: 'ming-gang',
        fromPlayerIndex: 0,
        claimedTileId: ordinary('wan-1-4').id,
      } as Meld;
      const hand = standard.filter(
        (entry) => !['wan-1-1', 'wan-2-1', 'wan-3-1'].includes(entry.id),
      );
      const winning = ordinary('wind-east-2');
      const base = packageState([meld], [...hand, winning], ordinary('tong-9-4'), false);
      const state: GameState = {
        ...base,
        currentPlayerIndex: 1,
        pendingAction: { type: 'discard', playerIndex: 1, seat: 'south' },
        gangPackage: {
          status: 'active',
          payerPlayerIndex: 0,
          beneficiaryPlayerIndex: 1,
          source: 'ming-gang',
          establishedByMeldId: meld.id,
        },
        selfDrawProvenance:
          source === 'flower-replacement'
            ? {
                playerIndex: 1,
                tileId: winning.id,
                source,
                formedFlowerKongDuringReplacement: false,
              }
            : { playerIndex: 1, tileId: winning.id, source },
      };
      const resolved = applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
      expect(resolved.phase).toBe('ended');
      const event = scoreEvent(resolved);
      expect(event.transfers).toEqual([
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: source === 'ming-gang-tail' ? 104 : 84 },
      ]);
      expect(resolved.handProgressFacts.packageSettlementCount).toBe(1);
      expect(resolved.gangPackage).toEqual({ status: 'none' });
      expect(
        completeCurrentHand({
          ...createMatch({ ruleSetId: duo }),
          status: 'playing',
          currentHandStatus: 'playing',
          currentHand: resolved,
        }).dealerIndex,
      ).toBe(0);
    },
  );

  it('rejects incompatible mode, indices, disabled facts and malformed soft flower snapshots', () => {
    const legacy = { ...waiting(), legacyThreeMouth: true };
    expect(applyAction(legacy, { type: 'DRAW_TILE' })).toBe(legacy);
    const resolved = applyAction(applyAction(waiting(), { type: 'DRAW_TILE' }), {
      type: 'DECLARE_SELF_DRAW_HU',
      playerIndex: 1,
    });
    const base: MatchState = {
      ...createMatch({ ruleSetId: duo }),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: resolved,
    };
    expect(() => completeCurrentHand({ ...base, totalEffectiveDealerTurns: 16 })).toThrow();
    expect(() =>
      completeCurrentHand({ ...base, currentHand: { ...resolved, ruleSetId: 'nanjing-open' } }),
    ).toThrow();
    expect(() =>
      completeCurrentHand({
        ...base,
        currentHand: {
          ...resolved,
          handProgressFacts: { ...resolved.handProgressFacts, fourWindsGatheredCount: 1 },
        },
      }),
    ).toThrow();
    if (resolved.result?.type !== 'win' || resolved.result.source !== 'self-draw')
      throw new Error('Missing result');
    const result = resolved.result;
    for (const softFlowerItems of [
      [{ kind: 'self-draw', count: 4 }],
      [
        { kind: 'self-draw', count: 1 },
        { kind: 'self-draw', count: 1 },
      ],
      [],
    ]) {
      const corrupt = {
        ...resolved,
        result: {
          ...result,
          winner: {
            ...result.winner,
            evaluation: { ...result.winner.evaluation, softFlowerItems },
          },
        },
      } as unknown as GameState;
      expect(() => completeCurrentHand({ ...base, currentHand: corrupt })).toThrow();
    }
  });

  it('uses the agreed real-time amounts and disables only the two excluded rules', () => {
    const rules = getRuleSet(duo);
    expect(rules.getAnGangScoreTransfers({ playerIndex: 1, playerCount: 2, meldId: 'a' })).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
    ]);
    expect(
      rules.getSpecialDiscardScoreTransfers({
        source: 'four-winds-gathered',
        playerCount: 2,
        receiverPlayerIndex: 1,
        completingWind: 'north',
      }),
    ).toEqual([]);
    expect(
      rules.getSpecialDiscardScoreTransfers({
        source: 'follow-discard',
        playerCount: 2,
        payerPlayerIndex: 0,
        triggeringPlayerIndex: 1,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toEqual([]);
    expect(
      rules.getSpecialDiscardScoreTransfers({
        source: 'four-identical-discards',
        playerCount: 2,
        payerPlayerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 }]);
  });

  it.each(['seven-pairs', 'flower-kong', 'four-identical-discards', 'combined'])(
    'continues the eighth turn for %s and resets the next hand facts',
    (reason) => {
      const state =
        reason === 'seven-pairs' ? waiting() : waiting(standard, ordinary('wind-east-2'));
      const resolved = applyAction(applyAction(state, { type: 'DRAW_TILE' }), {
        type: 'DECLARE_SELF_DRAW_HU',
        playerIndex: 1,
      });
      // The counters are authoritative reducer facts; this isolates Match's final-turn decision.
      const facts = {
        ...resolved.handProgressFacts,
        flowerKongCount: reason === 'flower-kong' || reason === 'combined' ? 1 : 0,
        fourIdenticalDiscardsPenaltyCount:
          reason === 'four-identical-discards' || reason === 'combined' ? 1 : 0,
      };
      const completed = completeCurrentHand({
        ...createMatch({ ruleSetId: duo }),
        status: 'playing',
        currentHandStatus: 'playing',
        effectiveDealerTurn: 8,
        isFinalDealerTurn: true,
        currentHand: { ...resolved, handProgressFacts: facts },
      });
      expect(completed.status).toBe('playing');
      expect(completed.effectiveDealerTurn).toBe(8);
      expect(completed.dealerIndex).toBe(0);
      expect(completed.completedHands).toHaveLength(1);
      expect(completed.completedHands[0]?.reason).toBe('final-turn-continuation');
      const next = prepareNextHand(completed);
      expect(next.effectiveDealerTurn).toBe(8);
      expect(next.currentHand.players).toHaveLength(2);
      expect(Object.values(next.currentHand.handProgressFacts).every((count) => count === 0)).toBe(
        true,
      );
    },
  );

  it.each([7, 8])(
    'does not treat self-draw soft flowers as a big hand on turn %s',
    (effectiveDealerTurn) => {
      const state = waiting(standard, ordinary('wind-east-2'));
      const drawn = applyAction(state, { type: 'DRAW_TILE' });
      expect(getAvailableSelfDrawHu(drawn, 1)?.evaluation.patterns).toEqual(['men-qing']);
      const match = {
        ...createMatch({ ruleSetId: duo }),
        status: 'playing' as const,
        currentHandStatus: 'playing' as const,
        effectiveDealerTurn,
        isFinalDealerTurn: effectiveDealerTurn === 8,
        currentHand: drawn,
      };
      const ended = applyGameActionToMatch(match, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
      const completed = completeCurrentHand(ended);
      expect(completed.status).toBe(effectiveDealerTurn === 8 ? 'completed' : 'playing');
      expect(completed.dealerIndex).toBe(1);
      expect(completed.currentHand.threeMouthState).toHaveLength(2);
      if (effectiveDealerTurn === 7)
        expect(prepareNextHand(completed).currentHand.players).toHaveLength(2);
    },
  );
});
