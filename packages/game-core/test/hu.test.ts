import { describe, expect, it } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  evaluateHuStructure,
  NANJING_OPEN_RULE_SET,
  settlePendingScoringEvents,
  type GameState,
  type HandResult,
  type HuStructure,
  type MatchState,
  type Meld,
  type OrdinaryHandTile,
  type PendingHuScoringEvent,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function tile(id: TileId): OrdinaryHandTile {
  const value = deck.find((candidate) => candidate.id === id);
  if (!value || value.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return value;
}

function tiles(...ids: TileId[]): OrdinaryHandTile[] {
  return ids.map(tile);
}

function structure(
  concealedTileIds: TileId[],
  winningTileId: TileId,
  melds: readonly Meld[] = [],
): HuStructure | null {
  return evaluateHuStructure({
    concealedTiles: tiles(...concealedTileIds),
    winningTile: tile(winningTileId),
    melds,
  });
}

const standardWait = [
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
] satisfies TileId[];

describe('Hu structure evaluator', () => {
  it('rejects null and primitive evaluator inputs without throwing', () => {
    for (const value of [null, 7, 'invalid']) {
      expect(() =>
        evaluateHuStructure(value as unknown as Parameters<typeof evaluateHuStructure>[0]),
      ).not.toThrow();
      expect(
        evaluateHuStructure(value as unknown as Parameters<typeof evaluateHuStructure>[0]),
      ).toBeNull();
    }
  });

  it('recognizes a deterministic standard hand with sequences and a pair', () => {
    const result = structure(standardWait, 'wind-east-2');

    expect(result).toMatchObject({
      type: 'standard',
      pair: { category: 'wind', wind: 'east' },
    });
    expect(result && result.type === 'standard' ? result.concealedMelds : []).toEqual([
      {
        type: 'sequence',
        tiles: [
          { category: 'number', suit: 'wan', rank: 1 },
          { category: 'number', suit: 'wan', rank: 2 },
          { category: 'number', suit: 'wan', rank: 3 },
        ],
      },
      {
        type: 'sequence',
        tiles: [
          { category: 'number', suit: 'wan', rank: 4 },
          { category: 'number', suit: 'wan', rank: 5 },
          { category: 'number', suit: 'wan', rank: 6 },
        ],
      },
      {
        type: 'sequence',
        tiles: [
          { category: 'number', suit: 'tiao', rank: 1 },
          { category: 'number', suit: 'tiao', rank: 2 },
          { category: 'number', suit: 'tiao', rank: 3 },
        ],
      },
      {
        type: 'sequence',
        tiles: [
          { category: 'number', suit: 'tong', rank: 1 },
          { category: 'number', suit: 'tong', rank: 2 },
          { category: 'number', suit: 'tong', rank: 3 },
        ],
      },
    ]);
  });

  it('rejects missing pairs, incomplete melds, and the wrong concealed count', () => {
    expect(structure(standardWait.slice(0, -1), 'wind-east-2')).toBeNull();
    expect(structure([...standardWait.slice(0, -1), 'wind-south-1'], 'wind-east-2')).toBeNull();
    expect(structure([...standardWait, 'wind-south-1'], 'wind-east-2')).toBeNull();
  });

  it('recognizes seven pairs and only upgrades to dragon seven pairs when the winning tile is the fourth', () => {
    const ordinarySevenPairs = structure(
      [
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
        'wind-east-1',
      ],
      'wind-east-2',
    );
    expect(ordinarySevenPairs?.type).toBe('seven-pairs');

    const dragon = structure(
      [
        'wan-1-1',
        'wan-1-2',
        'wan-1-3',
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
      ],
      'wan-1-4',
    );
    expect(dragon).toMatchObject({
      type: 'dragon-seven-pairs',
      dragon: { category: 'number', suit: 'wan', rank: 1 },
    });

    expect(
      structure(
        [
          'wan-1-1',
          'wan-1-2',
          'wan-1-3',
          'wan-1-4',
          'wan-2-1',
          'wan-2-2',
          'wan-3-1',
          'wan-3-2',
          'tiao-1-1',
          'tiao-1-2',
          'tiao-2-1',
          'tiao-2-2',
          'tong-1-1',
        ],
        'tong-1-2',
      )?.type,
    ).toBe('seven-pairs');
  });

  it.each(['peng', 'ming-gang', 'an-gang', 'bu-gang'] as const)(
    'recognizes a standard hand with an existing %s meld and rejects seven pairs with melds',
    (type) => {
      const meldTiles = tiles(
        'wan-1-1',
        'wan-1-2',
        'wan-1-3',
        ...(type === 'peng' ? [] : (['wan-1-4'] as TileId[])),
      );
      const meld: Meld = {
        id: 'meld-1',
        type,
        tiles: meldTiles,
        ...(type === 'an-gang' ? {} : { claimedTileId: 'wan-1-3' as const, fromPlayerIndex: 2 }),
      };
      expect(
        structure(
          [
            'wan-2-1',
            'wan-3-1',
            'wan-4-1',
            'tiao-2-1',
            'tiao-3-1',
            'tiao-4-1',
            'tong-5-1',
            'tong-5-2',
            'wind-east-1',
            'wind-east-2',
          ],
          'tong-5-3',
          [meld],
        )?.type,
      ).toBe('standard');
      expect(structure(standardWait, 'wind-east-2', [meld])).toBeNull();
    },
  );

  it('rejects duplicate entities, more than four copies of a face, and corrupt melds', () => {
    expect(structure([...standardWait.slice(0, -1), 'wan-1-1'], 'wind-east-2')).toBeNull();
    expect(
      evaluateHuStructure({
        concealedTiles: tiles(...standardWait),
        winningTile: { ...tile('wind-east-2'), id: 'wind-east-1' } as OrdinaryHandTile,
        melds: [],
      }),
    ).toBeNull();
    const corruptMeld: Meld = {
      id: 'meld-1',
      type: 'peng',
      tiles: tiles('wan-1-1', 'wan-1-2', 'wan-2-1'),
      claimedTileId: 'wan-1-2',
      fromPlayerIndex: 1,
    };
    expect(structure(standardWait, 'wind-east-2', [corruptMeld])).toBeNull();
  });

  it('does not mutate inputs and returns the same decomposition repeatedly', () => {
    const concealedTiles = tiles(...standardWait);
    const before = structuredClone(concealedTiles);
    const first = evaluateHuStructure({
      concealedTiles,
      winningTile: tile('wind-east-2'),
      melds: [],
    });
    const second = evaluateHuStructure({
      concealedTiles,
      winningTile: tile('wind-east-2'),
      melds: [],
    });

    expect(first).toEqual(second);
    expect(concealedTiles).toEqual(before);
  });

  it.each([
    ['unknown meld type', { type: 'future-gang' }],
    ['negative source player', { fromPlayerIndex: -1 }],
    ['source player at the player-count upper bound', { fromPlayerIndex: 4 }],
    ['fractional source player', { fromPlayerIndex: 1.5 }],
    ['claimed tile outside the meld', { claimedTileId: 'tong-9-4' }],
    ['peng with four tiles', { tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4') }],
  ])('rejects %s without throwing or mutating the meld', (_name, change) => {
    const meld = {
      id: 'meld-corrupt',
      type: 'peng',
      tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3'),
      claimedTileId: 'wan-1-3',
      fromPlayerIndex: 2,
      ...change,
    } as unknown as Meld;
    const before = structuredClone(meld);

    expect(() => structure(standardWait, 'wind-east-2', [meld])).not.toThrow();
    expect(structure(standardWait, 'wind-east-2', [meld])).toBeNull();
    expect(meld).toEqual(before);
  });

  it.each([
    [
      'an-gang with claimedTileId',
      {
        id: 'meld-corrupt',
        type: 'an-gang',
        tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4'),
        claimedTileId: 'wan-1-1',
      },
    ],
    [
      'an-gang with fromPlayerIndex',
      {
        id: 'meld-corrupt',
        type: 'an-gang',
        tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4'),
        fromPlayerIndex: 2,
      },
    ],
    [
      'gang with three tiles',
      {
        id: 'meld-corrupt',
        type: 'ming-gang',
        tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3'),
        claimedTileId: 'wan-1-3',
        fromPlayerIndex: 2,
      },
    ],
    [
      'bu-gang with mixed faces',
      {
        id: 'meld-corrupt',
        type: 'bu-gang',
        tiles: tiles('wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-2-1'),
        claimedTileId: 'wan-1-3',
        fromPlayerIndex: 2,
      },
    ],
    [
      'duplicate meld tile entity',
      {
        id: 'meld-corrupt',
        type: 'peng',
        tiles: tiles('wan-1-1', 'wan-1-1', 'wan-1-3'),
        claimedTileId: 'wan-1-3',
        fromPlayerIndex: 2,
      },
    ],
    [
      'invalid meld tile face',
      {
        id: 'meld-corrupt',
        type: 'peng',
        tiles: [...tiles('wan-1-1', 'wan-1-2'), { ...tile('wan-1-3'), rank: 10 }],
        claimedTileId: 'wan-1-3',
        fromPlayerIndex: 2,
      },
    ],
  ])('rejects %s without throwing or mutating the input', (_name, value) => {
    const meld = value as unknown as Meld;
    const before = structuredClone(meld);

    expect(() => structure(standardWait, 'wind-east-2', [meld])).not.toThrow();
    expect(structure(standardWait, 'wind-east-2', [meld])).toBeNull();
    expect(meld).toEqual(before);
  });
});

function createDiscardHuState(winnerIndexes: readonly number[]): GameState {
  const state = createGame();
  const filler = tiles(...standardWait);
  const players = state.players.map((player, playerIndex) => ({
    ...player,
    hand:
      playerIndex === 0
        ? [...filler, tile('wind-east-2')]
        : winnerIndexes.includes(playerIndex)
          ? [...filler]
          : tiles(
              'wan-7-1',
              'wan-7-2',
              'wan-8-1',
              'tiao-7-1',
              'tiao-7-2',
              'tiao-8-1',
              'tong-7-1',
              'tong-7-2',
              'tong-8-1',
              'wind-south-1',
              'wind-west-1',
              'wind-north-1',
              'wind-north-2',
            ),
  }));
  return {
    ...state,
    players,
    wall: [tile('wan-9-1'), tile('wan-8-4')],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

function submitAll(
  state: GameState,
  responses: Readonly<Record<number, 'pass' | 'hu' | 'peng' | 'ming-gang'>>,
): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, {
      type: 'SUBMIT_REACTION',
      playerIndex: responder.playerIndex,
      responseType: responses[responder.playerIndex] ?? 'pass',
    });
  }
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

describe('discard Hu production flow', () => {
  it('keeps all current-rule points in RuleSet snapshots for discard and rob-BuGang Hu', () => {
    const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: tiles(...standardWait),
      melds: [],
      flowers: [],
      allMelds: [],
    });
    expect(evaluation).toMatchObject({
      patterns: ['men-qing', 'no-flower'],
      hardFlowerCount: 0,
      softFlowerCount: 1,
    });
    expect(
      evaluation &&
        NANJING_OPEN_RULE_SET.getHuScoreTransfers({
          source: 'discard',
          winnerPlayerIndex: 1,
          payerPlayerIndex: 0,
          playerCount: 4,
          evaluation,
        }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 104 }]);
    expect(
      evaluation &&
        NANJING_OPEN_RULE_SET.getHuScoreTransfers({
          source: 'rob-bu-gang',
          winnerPlayerIndex: 1,
          payerPlayerIndex: 0,
          playerCount: 4,
          evaluation,
        }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 312 }]);
  });

  it.each([[[1]], [[1, 2]], [[1, 2, 3]]] as const)(
    'resolves ordered Hu winners %j through discard, responses, and resolution',
    (winnerIndexes) => {
      const opened = applyAction(createDiscardHuState(winnerIndexes), {
        type: 'DISCARD_TILE',
        tileId: 'wind-east-2',
      });
      expect(opened.reactionWindow?.source).toBe('discard');
      winnerIndexes.forEach((playerIndex) => {
        expect(opened.reactionWindow?.availableReactions[playerIndex - 1]?.responseTypes).toContain(
          'hu',
        );
      });

      const resolved = submitAll(
        opened,
        Object.fromEntries(winnerIndexes.map((playerIndex) => [playerIndex, 'hu'])),
      );

      expect(resolved.phase).toBe('ended');
      expect(resolved.result).toMatchObject({
        type: 'win',
        source: 'discard',
        payerPlayerIndex: 0,
        winningTile: { id: 'wind-east-2' },
        winners: winnerIndexes.map((playerIndex) => ({ playerIndex })),
      });
      expect(resolved.pendingScoringEvents.map((event) => event.type)).toEqual(
        winnerIndexes.map(() => 'hu-resolved'),
      );
      expect(resolved.players.every((player) => player.melds.length === 0)).toBe(true);
    },
  );

  it('gives Hu priority over Peng and MingGang without losing later Hu winners', () => {
    const base = createDiscardHuState([1, 2]);
    const state = {
      ...base,
      players: base.players.map((player, index) =>
        index === 3
          ? {
              ...player,
              hand: [
                ...player.hand.slice(0, 10),
                ...tiles('wind-east-1', 'wind-east-3', 'wind-east-4'),
              ],
            }
          : player,
      ),
    };
    const opened = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    const resolved = submitAll(opened, { 1: 'hu', 2: 'hu', 3: 'ming-gang' });

    expect(
      resolved.result?.type === 'win' && resolved.result.source !== 'self-draw'
        ? resolved.result.winners.map((winner) => winner.playerIndex)
        : [],
    ).toEqual([1, 2]);
    expect(resolved.players[3]?.melds).toEqual([]);
  });

  it('marks only a player who passes a real discard Hu opportunity and clears it only when that player discards', () => {
    const opened = applyAction(createDiscardHuState([1]), {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    const afterPass = applyAction(opened, {
      type: 'SUBMIT_REACTION',
      playerIndex: 1,
      responseType: 'pass',
    });
    expect(afterPass.players[1]?.passHu).toBe(true);

    const afterOthers = submitAll(afterPass, {});
    expect(afterOthers.players[1]?.passHu).toBe(true);
    const afterDraw = applyAction(afterOthers, { type: 'DRAW_TILE' });
    expect(afterDraw.players[1]?.passHu).toBe(true);
    const discarded = applyAction(afterDraw, { type: 'DISCARD_TILE', tileId: 'wan-9-1' });
    expect(discarded.players[1]?.passHu).toBe(false);
  });

  it('blocks a later real discard Hu until the player discards, then restores Hu', () => {
    const base = createDiscardHuState([2]);
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1
          ? { ...player, hand: [...player.hand.slice(0, 12), tile('wind-east-3')] }
          : index === 3
            ? { ...player, hand: [...player.hand.slice(0, 12), tile('wind-east-4')] }
            : player,
      ),
      wall: [tile('wan-9-1'), tile('wan-8-4'), tile('tong-9-4'), tile('tiao-9-4')],
    };
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(state.players[2]?.passHu).toBe(true);

    state = applyAction(state, { type: 'DRAW_TILE' });
    expect(state.players[2]?.passHu).toBe(true);
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-3' });
    const blocked = state;
    expect(
      blocked.reactionWindow?.availableReactions.find((value) => value.playerIndex === 2)
        ?.responseTypes,
    ).not.toContain('hu');
    expect(
      applyAction(blocked, { type: 'SUBMIT_REACTION', playerIndex: 2, responseType: 'hu' }),
    ).toBe(blocked);

    state = submitAll(blocked, {});
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-8-4' });
    expect(state.players[2]?.passHu).toBe(false);
    state = submitAll(state, {});
    state = applyAction(state, { type: 'DRAW_TILE' });
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-4' });
    expect(
      state.reactionWindow?.availableReactions.find((value) => value.playerIndex === 2)
        ?.responseTypes,
    ).toContain('hu');
  });

  it('does not set pass-Hu for an unavailable Hu and keeps player states independent', () => {
    let unavailable = applyAction(createDiscardHuState([]), {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    unavailable = applyAction(unavailable, { type: 'PASS_REACTION', playerIndex: 1 });
    expect(unavailable.players[1]?.passHu).toBe(false);

    let independent = applyAction(createDiscardHuState([1, 2]), {
      type: 'DISCARD_TILE',
      tileId: 'wind-east-2',
    });
    independent = applyAction(independent, { type: 'PASS_REACTION', playerIndex: 1 });
    independent = applyAction(independent, {
      type: 'SUBMIT_REACTION',
      playerIndex: 2,
      responseType: 'hu',
    });
    expect(independent.players[1]?.passHu).toBe(true);
    expect(independent.players[2]?.passHu).toBe(false);
  });

  it.each(['peng', 'ming-gang'] as const)(
    'sets pass-Hu when choosing %s from a real window that also offers Hu',
    (responseType) => {
      const dragonWait = tiles(
        'wan-1-1',
        'wan-1-2',
        'wan-1-3',
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
      );
      const base = createDiscardHuState([]);
      const state: GameState = {
        ...base,
        players: base.players.map((player, index) =>
          index === 0
            ? { ...player, hand: [...player.hand.slice(0, 13), tile('wan-1-4')] }
            : index === 1
              ? { ...player, hand: dragonWait }
              : player,
        ),
      };
      const opened = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-1-4' });
      expect(opened.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
        'pass',
        'hu',
        'peng',
        'ming-gang',
      ]);

      const submitted = applyAction(opened, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType,
      });
      expect(submitted.players[1]?.passHu).toBe(true);
    },
  );

  it('keeps pass-Hu through a real AnGang tail draw', () => {
    const base = createDiscardHuState([]);
    const waitingWithQuad = tiles(
      'wan-2-1',
      'wan-2-2',
      'wan-2-3',
      'wan-2-4',
      'wan-3-1',
      'wan-3-2',
      'tiao-1-1',
      'tiao-1-2',
      'tiao-2-1',
      'tiao-2-2',
      'tong-1-1',
      'tong-1-2',
      'wind-east-1',
    );
    let state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, hand: waitingWithQuad } : player,
      ),
      wall: [tile('wan-9-4'), tile('tiao-9-4'), tile('tong-9-4')],
    };
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    state = applyAction(state, { type: 'DRAW_TILE' });
    expect(state.players[1]?.passHu).toBe(true);

    state = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 2 },
    });
    expect(state.players[1]?.melds.at(-1)?.type).toBe('an-gang');
    expect(state.players[1]?.passHu).toBe(true);
  });

  it('settles Hu transfer snapshots immediately through Match and completes with its typed result', () => {
    const hand = createDiscardHuState([1, 2]);
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: hand,
    };
    match = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'SUBMIT_REACTION',
        playerIndex: responder.playerIndex,
        responseType: responder.playerIndex < 3 ? 'hu' : 'pass',
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(match.cumulativeScores).toEqual([792, 1104, 1104, 1000]);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    const completed = completeCurrentHand(match);
    expect(completed.completedHands.at(-1)?.result).toEqual(match.currentHand.result);
    expect(completed.completedHands.at(-1)?.pendingScoringEventCount).toBe(0);
    expect(completed.dealerIndex).toBe(0);
  });

  it('settles arbitrary valid Hu snapshots without recomputing their amount', () => {
    const winResult: HandResult = {
      type: 'win',
      source: 'discard',
      winningTile: tile('wind-east-2'),
      payerPlayerIndex: 0,
      winners: [],
    };
    const state = createDiscardHuState([]);
    const match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: {
        ...state,
        phase: 'ended',
        turnStage: 'hand-ended',
        pendingAction: { playerIndex: null, seat: null, type: 'none' },
        result: winResult,
        pendingScoringEvents: [
          {
            type: 'hu-resolved',
            source: 'discard',
            winnerPlayerIndex: 1,
            payerPlayerIndex: 0,
            winningTile: tile('wind-east-2'),
            evaluation: {
              structure: structure(standardWait, 'wind-east-2')!,
              patterns: ['men-qing'],
              hardFlowerCount: 0,
              softFlowerCount: 0,
            },
            transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 }],
            status: 'pending',
          },
        ],
      },
    };

    expect(settlePendingScoringEvents(match).cumulativeScores).toEqual([990, 1010, 1000, 1000]);
  });

  it.each([
    [
      'empty structure',
      (result: HandResult) => ({
        ...result,
        winners: [
          { ...winnerOf(result), evaluation: { ...winnerOf(result).evaluation, structure: {} } },
        ],
      }),
    ],
    [
      'unknown structure type',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, structure: { type: 'future' } },
          },
        ],
      }),
    ],
    [
      'unknown pattern',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, patterns: ['future'] },
          },
        ],
      }),
    ],
    [
      'inconsistent standard meld counts',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: {
              ...winnerOf(result).evaluation,
              structure: { ...winnerOf(result).evaluation.structure, existingMeldCount: 4 },
            },
          },
        ],
      }),
    ],
    [
      'duplicate pattern',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, patterns: ['men-qing', 'men-qing'] },
          },
        ],
      }),
    ],
    [
      'negative flower count',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, hardFlowerCount: -1 },
          },
        ],
      }),
    ],
    [
      'fractional flower count',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, hardFlowerCount: 1.5 },
          },
        ],
      }),
    ],
    [
      'NaN flower count',
      (result: HandResult) => ({
        ...result,
        winners: [
          {
            ...winnerOf(result),
            evaluation: { ...winnerOf(result).evaluation, hardFlowerCount: Number.NaN },
          },
        ],
      }),
    ],
    [
      'winning tile without id',
      (result: HandResult) => ({
        ...result,
        winningTile: { category: 'wind', wind: 'east', copy: 2 },
      }),
    ],
    [
      'winning tile with invalid face',
      (result: HandResult) => ({
        ...result,
        winningTile: { ...tile('wind-east-2'), wind: 'future' },
      }),
    ],
    ['payer out of range', (result: HandResult) => ({ ...result, payerPlayerIndex: 4 })],
    [
      'winner out of range',
      (result: HandResult) => ({ ...result, winners: [{ ...winnerOf(result), playerIndex: 4 }] }),
    ],
    [
      'winner equals payer',
      (result: HandResult) => ({ ...result, winners: [{ ...winnerOf(result), playerIndex: 0 }] }),
    ],
    [
      'duplicate winner',
      (result: HandResult) => ({ ...result, winners: [winnerOf(result), winnerOf(result)] }),
    ],
    ['empty winners', (result: HandResult) => ({ ...result, winners: [] })],
    ['unknown win source', (result: HandResult) => ({ ...result, source: 'future' })],
    [
      'a second transfer ledger',
      (result: HandResult) => ({
        ...result,
        transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 }],
      }),
    ],
    ['corrupt draw reason', () => ({ type: 'draw', reason: 'future' })],
  ] as const)('rejects corrupt HandResult metadata: %s', (_name, corrupt) => {
    const valid = validHandResult();
    const match = endedMatch(corrupt(valid) as unknown as HandResult);
    const before = structuredClone(match);

    expect(() => completeCurrentHand(match)).toThrow(/valid result/);
    expect(match).toEqual(before);
  });

  it.each([
    ['corrupt evaluation', (event: PendingHuScoringEvent) => ({ ...event, evaluation: {} })],
    [
      'unknown pattern',
      (event: PendingHuScoringEvent) => ({
        ...event,
        evaluation: { ...event.evaluation, patterns: ['future'] },
      }),
    ],
    [
      'negative flower count',
      (event: PendingHuScoringEvent) => ({
        ...event,
        evaluation: { ...event.evaluation, hardFlowerCount: -1 },
      }),
    ],
    [
      'invalid winning tile',
      (event: PendingHuScoringEvent) => ({
        ...event,
        winningTile: { ...event.winningTile, id: 'future' },
      }),
    ],
    ['invalid source', (event: PendingHuScoringEvent) => ({ ...event, source: 'future' })],
    ['winner out of range', (event: PendingHuScoringEvent) => ({ ...event, winnerPlayerIndex: 4 })],
    ['payer out of range', (event: PendingHuScoringEvent) => ({ ...event, payerPlayerIndex: 4 })],
    ['winner equals payer', (event: PendingHuScoringEvent) => ({ ...event, winnerPlayerIndex: 0 })],
    ['non-pending status', (event: PendingHuScoringEvent) => ({ ...event, status: 'settled' })],
  ] as const)('rejects a corrupt Hu event transactionally: %s', (_name, corrupt) => {
    const valid = validHuEvent();
    const match = settlementMatch([
      valid,
      corrupt(valid) as unknown as PendingHuScoringEvent,
      {
        ...valid,
        winnerPlayerIndex: 2,
        transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 2, amount: 10 }],
      },
    ]);
    const before = structuredClone(match);

    expect(() => settlePendingScoringEvents(match)).toThrow(/settlement invariant/i);
    expect(match).toEqual(before);
  });

  it('rejects a corrupt Hu event before a valid event without settling or clearing either', () => {
    const valid = validHuEvent();
    const corrupt = {
      ...valid,
      evaluation: { ...valid.evaluation, softFlowerCount: Number.POSITIVE_INFINITY },
    } as unknown as PendingHuScoringEvent;
    const match = settlementMatch([corrupt, valid]);
    const before = structuredClone(match);

    expect(() => settlePendingScoringEvents(match)).toThrow(/settlement invariant/i);
    expect(match).toEqual(before);
  });
});

function validEvaluation() {
  return {
    structure: structure(standardWait, 'wind-east-2')!,
    patterns: ['men-qing'] as const,
    hardFlowerCount: 0,
    softFlowerCount: 0,
  };
}

function validHandResult(): HandResult {
  return {
    type: 'win',
    source: 'discard',
    winningTile: tile('wind-east-2'),
    payerPlayerIndex: 0,
    winners: [{ playerIndex: 1, evaluation: validEvaluation() }],
  };
}

function winnerOf(result: HandResult) {
  if (result.type !== 'win' || result.source === 'self-draw' || !result.winners[0]) {
    throw new Error('Expected single-payer win result');
  }
  return result.winners[0];
}

function endedMatch(result: HandResult): MatchState {
  const match = createMatch();
  return {
    ...match,
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: {
      ...match.currentHand,
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      result,
    },
  };
}

function validHuEvent(): PendingHuScoringEvent {
  return {
    type: 'hu-resolved',
    source: 'discard',
    winnerPlayerIndex: 1,
    payerPlayerIndex: 0,
    winningTile: tile('wind-east-2'),
    evaluation: validEvaluation(),
    transfers: [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 }],
    status: 'pending',
  };
}

function settlementMatch(events: readonly PendingHuScoringEvent[]): MatchState {
  const match = createMatch();
  return { ...match, currentHand: { ...match.currentHand, pendingScoringEvents: events } };
}
