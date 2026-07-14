import { describe, expect, it, vi } from 'vitest';
import {
  NANJING_OPEN_RULE_SET,
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  prepareNextHand,
  settlePendingScoringEvents,
} from '../src';
import type { GameState, MatchState, Meld, OrdinaryHandTile, PendingScoringEvent } from '../src';

const deck = createNanjingMahjongDeck();

function tile(id: string): OrdinaryHandTile {
  const result = deck.find((candidate) => candidate.id === id && candidate.category !== 'flower');
  if (!result || result.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return result;
}

function playingState(hands: readonly (readonly string[])[]): GameState {
  const state = createGame();
  const used = new Set(hands.flat());
  return {
    ...state,
    players: state.players.map((player, index) => ({
      ...player,
      hand: (hands[index] ?? []).map(tile),
    })),
    wall: deck
      .filter(
        (candidate): candidate is OrdinaryHandTile =>
          candidate.category !== 'flower' && !used.has(candidate.id),
      )
      .slice(0, 40),
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

function playDiscards(state: GameState, tileIds: readonly string[]): GameState {
  let next = state;
  for (const tileId of tileIds) {
    if (next.turnStage === 'waiting-for-draw') next = draw(next);
    next = discardAndPass(next, tileId);
  }
  return next;
}

const fillers = {
  south: [
    'tiao-1-1',
    'tiao-2-1',
    'tiao-3-1',
    'tiao-4-1',
    'tiao-5-1',
    'tiao-6-1',
    'tiao-7-1',
    'tiao-8-1',
  ],
  west: [
    'tong-1-1',
    'tong-2-1',
    'tong-3-1',
    'tong-4-1',
    'tong-5-1',
    'tong-6-1',
    'tong-7-1',
    'tong-8-1',
  ],
  north: ['wan-3-1', 'wan-4-1', 'wan-5-1', 'wan-6-1', 'wan-7-1', 'wan-8-1', 'wan-9-1', 'wan-2-1'],
} as const;

function interleavedEastDiscards(east: readonly string[]): string[] {
  return east.flatMap((tileId, index) =>
    index === east.length - 1
      ? [tileId]
      : [tileId, fillers.south[index]!, fillers.west[index]!, fillers.north[index]!],
  );
}

function withNonDealerWin(hand: GameState): GameState {
  return {
    ...hand,
    phase: 'ended',
    turnStage: 'hand-ended',
    pendingAction: { playerIndex: null, seat: null, type: 'none' },
    result: {
      type: 'win',
      source: 'discard',
      winningTile: tile('wan-9-1'),
      payerPlayerIndex: 0,
      winners: [
        {
          playerIndex: 1,
          evaluation: {
            structure: {
              type: 'standard',
              existingMeldCount: 4,
              pair: { category: 'wind', wind: 'east' },
              concealedMelds: [],
            },
            patterns: ['men-qing'],
            hardFlowerCount: 0,
            softFlowerCount: 0,
          },
        },
      ],
    },
  };
}

function matchWithHand(hand: GameState, effectiveDealerTurn = 16): MatchState {
  const base = createMatch();
  return {
    ...base,
    status: 'playing',
    effectiveDealerTurn,
    isFinalDealerTurn: effectiveDealerTurn === 16,
    currentHandStatus: 'playing',
    currentHand: hand,
  };
}

function discardAndPass(state: GameState, tileId: string): GameState {
  let next = applyAction(state, { type: 'DISCARD_TILE', tileId });
  for (const responder of next.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
  }
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function draw(state: GameState): GameState {
  return applyAction(state, { type: 'DRAW_TILE' });
}

function expectCorruptFollowDiscardNoOp(tileFace: unknown, tileId: string): void {
  const base = playingState([[], [], [], [tileId]]);
  const state = {
    ...base,
    currentPlayerIndex: 3,
    pendingAction: { playerIndex: 3, seat: 'north', type: 'discard' },
    specialDiscardTracking: {
      ...base.specialDiscardTracking,
      followDiscard: {
        initiatorPlayerIndex: 0,
        tileFace,
        expectedPlayerIndex: 3,
        followerCount: 2,
      },
    },
  } as unknown as GameState;
  const hand = state.players[3]?.hand;
  const discards = state.players[3]?.discardPile;
  const tracking = state.specialDiscardTracking;
  const events = state.pendingScoringEvents;
  const facts = state.handProgressFacts;
  const scoringHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getSpecialDiscardScoreTransfers');

  const result = applyAction(state, { type: 'DISCARD_TILE', tileId });
  const scoringHookCallCount = scoringHook.mock.calls.length;
  scoringHook.mockRestore();

  expect(result).toBe(state);
  expect(result.players[3]?.hand).toBe(hand);
  expect(result.players[3]?.discardPile).toBe(discards);
  expect(result.specialDiscardTracking).toBe(tracking);
  expect(result.pendingScoringEvents).toBe(events);
  expect(result.handProgressFacts).toBe(facts);
  expect(scoringHookCallCount).toBe(0);
}

describe('special discard RuleSet scoring', () => {
  it('creates fresh, ordered transfers for all three sources', () => {
    const follow = NANJING_OPEN_RULE_SET.getSpecialDiscardScoreTransfers({
      source: 'follow-discard',
      playerCount: 4,
      payerPlayerIndex: 0,
      triggeringPlayerIndex: 3,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    const identical = NANJING_OPEN_RULE_SET.getSpecialDiscardScoreTransfers({
      source: 'four-identical-discards',
      playerCount: 4,
      payerPlayerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    const winds = NANJING_OPEN_RULE_SET.getSpecialDiscardScoreTransfers({
      source: 'four-winds-gathered',
      playerCount: 4,
      receiverPlayerIndex: 0,
      completingWind: 'north',
    });

    expect(follow).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 3, amount: 10 },
    ]);
    expect(identical).toEqual(follow);
    expect(winds).toEqual([
      { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 },
      { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 10 },
      { fromPlayerIndex: 3, toPlayerIndex: 0, amount: 10 },
    ]);
  });
});

describe('special discard production', () => {
  it('detects a standard follow-discard cycle through public actions', () => {
    let state = playingState([['wan-1-1'], ['wan-1-2'], ['wan-1-3'], ['wan-1-4']]);
    state = draw(discardAndPass(state, 'wan-1-1'));
    state = draw(discardAndPass(state, 'wan-1-2'));
    state = draw(discardAndPass(state, 'wan-1-3'));
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-1-4' });

    expect(state.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'special-discard',
      source: 'follow-discard',
      initiatorPlayerIndex: 0,
      triggeringPlayerIndex: 3,
    });
    expect(state.handProgressFacts.followDiscardPenaltyCount).toBe(1);
  });

  it('supports a wind face and two independent follow cycles in one hand', () => {
    const faces = [
      'wind-east-1',
      'wind-east-2',
      'wind-east-3',
      'wind-east-4',
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-1-4',
    ];
    const result = playDiscards(
      playingState([
        [faces[0]!, faces[4]!],
        [faces[1]!, faces[5]!],
        [faces[2]!, faces[6]!],
        [faces[3]!, faces[7]!],
      ]),
      faces,
    );
    expect(result.handProgressFacts.followDiscardPenaltyCount).toBe(2);
  });

  it('detects four distinct same-face discards by one player', () => {
    const east = ['wan-2-1', 'wan-2-2', 'wan-2-3', 'wan-2-4'];
    const result = playDiscards(
      playingState([east, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(east),
    );

    expect(result.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'special-discard',
      source: 'four-identical-discards',
      playerIndex: 0,
      tileId: 'wan-2-4',
    });
    expect(result.handProgressFacts.fourIdenticalDiscardsPenaltyCount).toBe(1);
    expect(settlePendingScoringEvents(matchWithHand(result)).cumulativeScores).toEqual([
      970, 1010, 1010, 1010,
    ]);
  });

  it('counts historical discards after Peng or MingGang claim markers are attached', () => {
    const east = ['wan-2-1', 'wan-2-2', 'wan-2-3', 'wan-2-4'];
    let state = playDiscards(
      playingState([east, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(east).slice(0, -1),
    );
    state = draw(state);
    state = {
      ...state,
      players: state.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              discardPile: player.discardPile.map((record, recordIndex) => ({
                ...record,
                claimedByMeldId: recordIndex === 0 ? 'peng-1' : 'ming-gang-1',
              })),
            }
          : player,
      ),
    };
    const result = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-4' });
    expect(result.handProgressFacts.fourIdenticalDiscardsPenaltyCount).toBe(1);
  });

  it('tracks each player wind sequence and triggers on the fourth kind', () => {
    const east = ['wind-east-1', 'wind-south-1', 'wind-west-1', 'wind-north-1'];
    const result = playDiscards(
      playingState([east, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(east),
    );

    expect(result.pendingScoringEvents.at(-1)).toMatchObject({
      type: 'special-discard',
      source: 'four-winds-gathered',
      playerIndex: 0,
      completingWind: 'north',
    });
    expect(result.handProgressFacts.fourWindsGatheredCount).toBe(1);
    expect(result.specialDiscardTracking.windSequences[0]?.winds).toEqual([]);
    expect(settlePendingScoringEvents(matchWithHand(result)).cumulativeScores).toEqual([
      1030, 990, 990, 990,
    ]);
  });

  it('allows repeated winds and starts a fresh wind sequence after each trigger', () => {
    const east = [
      'wind-east-1',
      'wind-east-2',
      'wind-south-1',
      'wind-west-1',
      'wind-north-1',
      'wind-east-3',
      'wind-south-2',
      'wind-west-2',
      'wind-north-2',
    ];
    const result = playDiscards(
      playingState([east, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(east),
    );
    expect(result.handProgressFacts.fourWindsGatheredCount).toBe(2);
    expect(result.specialDiscardTracking.windSequences[0]?.winds).toEqual([]);
  });

  it('resets only the discarding player sequence on a non-wind and can gather again', () => {
    const state = playingState([['wan-1-1'], [], [], []]);
    const tracked: GameState = {
      ...state,
      specialDiscardTracking: {
        followDiscard: null,
        windSequences: [
          { playerIndex: 0, winds: ['east', 'south', 'west'] },
          { playerIndex: 1, winds: ['north'] },
          { playerIndex: 2, winds: [] },
          { playerIndex: 3, winds: [] },
        ],
      },
    };
    const result = applyAction(tracked, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    expect(result.specialDiscardTracking.windSequences.map((sequence) => sequence.winds)).toEqual([
      [],
      ['north'],
      [],
      [],
    ]);
  });

  it('rebuilds a failed follow candidate from the mismatching legal discard', () => {
    let state = playingState([['wan-1-1', 'wan-2-4'], ['wan-2-1'], ['wan-2-2'], ['wan-2-3']]);
    state = draw(discardAndPass(state, 'wan-1-1'));
    state = draw(discardAndPass(state, 'wan-2-1'));
    state = draw(discardAndPass(state, 'wan-2-2'));
    state = draw(discardAndPass(state, 'wan-2-3'));
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-4' });
    expect(state.pendingScoringEvents.at(-1)).toMatchObject({
      source: 'follow-discard',
      initiatorPlayerIndex: 1,
      triggeringPlayerIndex: 0,
    });
  });

  it('keeps an expected-player Peng candidate and cancels a seat-skipping Peng candidate', () => {
    const expectedState = playingState([['wan-1-1'], ['wan-1-2', 'wan-1-3', 'wan-1-4'], [], []]);
    let expected = applyAction(expectedState, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    expected = applyAction(expected, {
      type: 'SUBMIT_REACTION',
      playerIndex: 1,
      responseType: 'peng',
    });
    expected = applyAction(expected, { type: 'PASS_REACTION', playerIndex: 2 });
    expected = applyAction(expected, { type: 'PASS_REACTION', playerIndex: 3 });
    expected = applyAction(expected, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(expected.specialDiscardTracking.followDiscard?.initiatorPlayerIndex).toBe(0);

    const skippedState = playingState([['wan-2-1'], [], ['wan-2-2', 'wan-2-3', 'wan-2-4'], []]);
    let skipped = applyAction(skippedState, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
    skipped = applyAction(skipped, { type: 'PASS_REACTION', playerIndex: 1 });
    skipped = applyAction(skipped, {
      type: 'SUBMIT_REACTION',
      playerIndex: 2,
      responseType: 'peng',
    });
    skipped = applyAction(skipped, { type: 'PASS_REACTION', playerIndex: 3 });
    skipped = applyAction(skipped, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(skipped.specialDiscardTracking.followDiscard).toBeNull();
  });

  it('applies the same seat-order rule only when MingGang is formally resolved', () => {
    const resolveMingGang = (claimant: 1 | 2) => {
      const ids = ['wan-3-2', 'wan-3-3', 'wan-3-4'];
      const state = playingState([
        ['wan-3-1'],
        claimant === 1 ? ids : [],
        claimant === 2 ? ids : [],
        [],
      ]);
      let next = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-3-1' });
      for (const responder of next.reactionWindow?.responderOrder ?? []) {
        next = applyAction(next, {
          type: 'SUBMIT_REACTION',
          playerIndex: responder.playerIndex,
          responseType: responder.playerIndex === claimant ? 'ming-gang' : 'pass',
        });
      }
      return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
    };
    expect(resolveMingGang(1).specialDiscardTracking.followDiscard?.initiatorPlayerIndex).toBe(0);
    expect(resolveMingGang(2).specialDiscardTracking.followDiscard).toBeNull();
  });

  it('preserves a follow candidate across AnGang and BuGang by the current player', () => {
    const tracking = {
      followDiscard: {
        initiatorPlayerIndex: 3,
        tileFace: { category: 'number' as const, suit: 'wan' as const, rank: 1 as const },
        expectedPlayerIndex: 0,
        followerCount: 0,
      },
      windSequences: [
        { playerIndex: 0, winds: [] },
        { playerIndex: 1, winds: [] },
        { playerIndex: 2, winds: [] },
        { playerIndex: 3, winds: [] },
      ],
    };
    const anGangBase = playingState([['wan-6-1', 'wan-6-2', 'wan-6-3', 'wan-6-4'], [], [], []]);
    const afterAnGang = applyAction(
      { ...anGangBase, specialDiscardTracking: tracking },
      {
        type: 'DECLARE_AN_GANG',
        playerIndex: 0,
        tileFace: { category: 'number', suit: 'wan', rank: 6 },
      },
    );
    expect(afterAnGang.specialDiscardTracking.followDiscard).toEqual(tracking.followDiscard);

    const buGangBase = playingState([['wan-5-4'], [], [], []]);
    const peng: Meld = {
      id: 'meld-1',
      type: 'peng' as const,
      tiles: ['wan-5-1', 'wan-5-2', 'wan-5-3'].map(tile),
      claimedTileId: 'wan-5-3',
      fromPlayerIndex: 1,
    };
    let afterBuGang: GameState = {
      ...buGangBase,
      wall: buGangBase.wall.filter(
        (candidate) => !peng.tiles.some((used) => used.id === candidate.id),
      ),
      players: buGangBase.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              melds: [peng],
              buGangDrawProvenance: [{ targetMeldId: 'meld-1', tileId: 'wan-5-4' }],
            }
          : player,
      ),
      specialDiscardTracking: tracking,
    };
    afterBuGang = applyAction(afterBuGang, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 0,
      meldId: 'meld-1',
    });
    for (const responder of afterBuGang.reactionWindow?.responderOrder ?? []) {
      afterBuGang = applyAction(afterBuGang, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    afterBuGang = applyAction(afterBuGang, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(afterBuGang.specialDiscardTracking.followDiscard).toEqual(tracking.followDiscard);
  });

  it('scores a third follow on the last ordinary discard before the all-pass draw ends', () => {
    const base = playingState([[], [], [], ['wan-1-4']]);
    const state: GameState = {
      ...base,
      wall: [],
      currentPlayerIndex: 3,
      pendingAction: { playerIndex: 3, seat: 'north', type: 'discard' },
      specialDiscardTracking: {
        ...base.specialDiscardTracking,
        followDiscard: {
          initiatorPlayerIndex: 0,
          tileFace: { category: 'number', suit: 'wan', rank: 1 },
          expectedPlayerIndex: 3,
          followerCount: 2,
        },
      },
    };
    let result = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-1-4' });
    expect(result.pendingScoringEvents).toHaveLength(1);
    for (const responder of result.reactionWindow?.responderOrder ?? []) {
      result = applyAction(result, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
    }
    result = applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result.phase).toBe('ended');
    expect(result.pendingScoringEvents).toHaveLength(1);
    expect(result.handProgressFacts.followDiscardPenaltyCount).toBe(1);
  });

  it('creates multiple events in chapter order from one real discard', () => {
    const east = [
      'wind-north-1',
      'wind-north-2',
      'wind-north-3',
      'wan-1-2',
      'wind-east-1',
      'wind-south-1',
      'wind-west-1',
      'wind-north-4',
    ];
    const result = playDiscards(
      playingState([east, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(east),
    );
    expect(
      result.pendingScoringEvents.slice(-2).map((event) => 'source' in event && event.source),
    ).toEqual(['four-identical-discards', 'four-winds-gathered']);
    expect(result.handProgressFacts).toMatchObject({
      fourIdenticalDiscardsPenaltyCount: 1,
      fourWindsGatheredCount: 1,
    });
  });

  it('settles a real follow event once and keeps Match settlement generic', () => {
    let hand = playingState([['wan-1-1'], ['wan-1-2'], ['wan-1-3'], ['wan-1-4']]);
    hand = draw(discardAndPass(hand, 'wan-1-1'));
    hand = draw(discardAndPass(hand, 'wan-1-2'));
    hand = draw(discardAndPass(hand, 'wan-1-3'));
    const base = createMatch();
    const match: MatchState = {
      ...base,
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: hand,
    };
    const settled = applyGameActionToMatch(match, { type: 'DISCARD_TILE', tileId: 'wan-1-4' });
    expect(settled.cumulativeScores).toEqual([970, 1010, 1010, 1010]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
    expect(applyGameActionToMatch(settled, { type: 'DISCARD_TILE', tileId: 'wan-1-4' })).toBe(
      settled,
    );
  });
});

describe('special discard defensive boundaries', () => {
  it('rejects an extra field on a tracked number tile face transactionally', () => {
    expectCorruptFollowDiscardNoOp(
      { category: 'number', suit: 'wan', rank: 1, extra: true },
      'wan-1-4',
    );
  });

  it('rejects an extra field on a tracked wind tile face transactionally', () => {
    expectCorruptFollowDiscardNoOp({ category: 'wind', wind: 'east', extra: true }, 'wind-east-4');
  });

  it('rejects mixed number and wind fields on a tracked tile face transactionally', () => {
    expectCorruptFollowDiscardNoOp(
      { category: 'number', suit: 'wan', rank: 1, wind: 'east' },
      'wan-1-4',
    );
  });

  it.each([null, 1, {}, { followDiscard: null, windSequences: [] }])(
    'rejects corrupt tracking without changing the state: %j',
    (tracking) => {
      const state = playingState([['wan-1-1'], [], [], []]);
      const corrupt = { ...state, specialDiscardTracking: tracking } as unknown as GameState;
      expect(applyAction(corrupt, { type: 'DISCARD_TILE', tileId: 'wan-1-1' })).toBe(corrupt);
    },
  );

  it('rejects duplicate discard entity ids without triggering four-identical scoring', () => {
    const state = playingState([['wan-2-4'], [], [], []]);
    const corrupt: GameState = {
      ...state,
      players: state.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              discardPile: ['wan-2-1', 'wan-2-2', 'wan-2-2'].map((id) => ({ tile: tile(id) })),
            }
          : player,
      ),
    };
    expect(applyAction(corrupt, { type: 'DISCARD_TILE', tileId: 'wan-2-4' })).toBe(corrupt);
  });

  it('returns no transfers for corrupt scoring contexts', () => {
    const hook = NANJING_OPEN_RULE_SET.getSpecialDiscardScoreTransfers;
    expect(hook(null as unknown as Parameters<typeof hook>[0])).toEqual([]);
    expect(
      hook({ source: 'unknown', playerCount: 4 } as unknown as Parameters<typeof hook>[0]),
    ).toEqual([]);
    expect(
      hook({
        source: 'four-winds-gathered',
        playerCount: 4,
        receiverPlayerIndex: 0,
        completingWind: 'not-wind',
      } as unknown as Parameters<typeof hook>[0]),
    ).toEqual([]);
  });

  it('rejects a mixed valid-invalid scoring batch transactionally', () => {
    const valid: PendingScoringEvent = {
      type: 'special-discard',
      source: 'follow-discard',
      initiatorPlayerIndex: 0,
      triggeringPlayerIndex: 3,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
      transfers: [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
        { fromPlayerIndex: 0, toPlayerIndex: 2, amount: 10 },
        { fromPlayerIndex: 0, toPlayerIndex: 3, amount: 10 },
      ],
      status: 'pending',
    };
    const invalid = { ...valid, amount: 10 } as unknown as PendingScoringEvent;
    const base = createMatch();
    const events = [valid, invalid];
    const match: MatchState = {
      ...base,
      currentHand: { ...base.currentHand, pendingScoringEvents: events },
    };
    expect(() => settlePendingScoringEvents(match)).toThrow(/special discard metadata/);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.currentHand.pendingScoringEvents).toBe(events);
  });

  it('resets tracking when preparing the next hand', () => {
    const base = createMatch();
    const completed: MatchState = {
      ...base,
      status: 'playing',
      currentHandStatus: 'completed',
      currentHand: {
        ...base.currentHand,
        specialDiscardTracking: {
          followDiscard: {
            initiatorPlayerIndex: 0,
            tileFace: { category: 'number', suit: 'wan', rank: 1 },
            expectedPlayerIndex: 1,
            followerCount: 0,
          },
          windSequences: [
            { playerIndex: 0, winds: ['east'] },
            { playerIndex: 1, winds: [] },
            { playerIndex: 2, winds: [] },
            { playerIndex: 3, winds: [] },
          ],
        },
      },
    };
    expect(prepareNextHand(completed).currentHand.specialDiscardTracking).toEqual(
      createGame().specialDiscardTracking,
    );
  });

  it('uses production facts for the 16th-turn continuation decision', () => {
    let followHand = playingState([['wan-1-1'], ['wan-1-2'], ['wan-1-3'], ['wan-1-4']]);
    followHand = playDiscards(followHand, ['wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4']);
    const identicalTiles = ['wan-2-1', 'wan-2-2', 'wan-2-3', 'wan-2-4'];
    const identicalHand = playDiscards(
      playingState([identicalTiles, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(identicalTiles),
    );
    const windTiles = ['wind-east-1', 'wind-south-1', 'wind-west-1', 'wind-north-1'];
    const windHand = playDiscards(
      playingState([windTiles, fillers.south, fillers.west, fillers.north]),
      interleavedEastDiscards(windTiles),
    );
    for (const hand of [followHand, identicalHand, windHand]) {
      const completed = completeCurrentHand(matchWithHand(withNonDealerWin(hand)));
      expect(completed.completedHands).toHaveLength(1);
      expect(completed.completedHands[0]?.reason).toBe('final-turn-continuation');
    }
    const fifteenth = completeCurrentHand(matchWithHand(withNonDealerWin(followHand), 15));
    expect(fifteenth.completedHands[0]?.reason).toBe('normal-dealer-advance');
  });
});
