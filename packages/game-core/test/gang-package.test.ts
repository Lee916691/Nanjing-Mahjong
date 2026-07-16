import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NANJING_OPEN_RULE_SET,
  applyAction,
  applyGameActionToMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  prepareNextHand,
  settlePendingScoringEvents,
  type GameState,
  type MatchState,
  type OrdinaryHandTile,
  type ScoreTransfer,
  type Tile,
  type TileId,
} from '../src';

afterEach(() => vi.restoreAllMocks());

const deck = createNanjingMahjongDeck();

function tile(id: TileId): Tile {
  const found = deck.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing tile ${id}`);
  return found;
}

function ordinary(id: TileId): OrdinaryHandTile {
  const found = tile(id);
  if (found.category === 'flower') throw new Error(`Expected ordinary tile ${id}`);
  return found;
}

function passAndResolve(state: GameState): GameState {
  let next = state;
  for (const responder of state.reactionWindow?.responderOrder ?? []) {
    next = applyAction(next, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
  }
  return applyAction(next, { type: 'RESOLVE_REACTION_WINDOW' });
}

function mingGangStart(tail: readonly Tile[] = [ordinary('tong-9-1')]): GameState {
  const base = createGame();
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 0
          ? [ordinary('wan-3-4'), ordinary('tong-1-1')]
          : index === 1
            ? [ordinary('wan-3-1'), ordinary('wan-3-2'), ordinary('wan-3-3'), ordinary('tong-2-1')]
            : [ordinary(`tong-${index + 2}-1` as TileId)],
    })),
    wall: [...tail],
    currentPlayerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
  };
}

function openMingGang(): GameState {
  let state = applyAction(mingGangStart(), { type: 'DISCARD_TILE', tileId: 'wan-3-4' });
  state = applyAction(state, {
    type: 'SUBMIT_REACTION',
    playerIndex: 1,
    responseType: 'ming-gang',
  });
  state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
  return applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });
}

function resolvedMingGang(): GameState {
  return applyAction(openMingGang(), { type: 'RESOLVE_REACTION_WINDOW' });
}

function activeState(): GameState {
  const base = createGame();
  const meld = {
    id: 'meld-7',
    type: 'ming-gang' as const,
    tiles: [1, 2, 3, 4].map((copy) => ordinary(`wan-7-${copy}` as TileId)),
    claimedTileId: 'wan-7-4' as const,
    fromPlayerIndex: 0,
  };
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      hand:
        index === 1
          ? [
              ...[1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}` as TileId)),
              ordinary('wind-east-1'),
            ]
          : [],
      melds: index === 1 ? [meld] : [],
    })),
    wall: [ordinary('tong-9-1')],
    currentPlayerIndex: 1,
    phase: 'playing',
    turnStage: 'waiting-for-discard',
    pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
    gangPackage: {
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: 'meld-7',
    },
  };
}

function matchWithHand(hand: GameState): MatchState {
  return {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: hand,
  };
}

function anGangStart(): GameState {
  const state = activeState();
  return { ...state, gangPackage: { status: 'none' } };
}

function buGangReady(): GameState {
  const state = activeState();
  const candidate: GameState = {
    ...state,
    gangPackage: { status: 'none' },
    players: state.players.map((player, index) =>
      index === 1
        ? {
            ...player,
            hand: [ordinary('wan-5-4')],
            melds: [
              {
                id: 'meld-8',
                type: 'peng',
                tiles: [ordinary('wan-5-1'), ordinary('wan-5-2'), ordinary('wan-5-3')],
                claimedTileId: 'wan-5-3',
                fromPlayerIndex: 2,
              },
            ],
            buGangDrawProvenance: [{ targetMeldId: 'meld-8', tileId: 'wan-5-4' }],
          }
        : player,
    ),
  };
  let ready = applyAction(candidate, {
    type: 'DECLARE_BU_GANG',
    playerIndex: 1,
    meldId: 'meld-8',
  });
  for (const responder of ready.reactionWindow?.responderOrder ?? []) {
    ready = applyAction(ready, { type: 'PASS_REACTION', playerIndex: responder.playerIndex });
  }
  return ready;
}

function flowerKongStart(): GameState {
  const state = activeState();
  return {
    ...state,
    gangPackage: { status: 'none' },
    players: state.players.map((player, index) =>
      index === 1
        ? {
            ...player,
            hand: [ordinary('wind-east-1')],
            flowers: [
              tile('flower-red-center-1'),
              tile('flower-red-center-2'),
              tile('flower-red-center-3'),
            ].filter(
              (candidate): candidate is Extract<Tile, { category: 'flower' }> =>
                candidate.category === 'flower',
            ),
          }
        : player,
    ),
    wall: [tile('flower-red-center-4'), ordinary('tong-8-1')],
    turnStage: 'waiting-for-draw',
    pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
  };
}

function mockedTransfers(transfers: readonly (ScoreTransfer | Record<string, unknown>)[]) {
  return transfers as readonly ScoreTransfer[];
}

describe('gang package establishment and lifetime', () => {
  it('starts each hand with no package', () => {
    expect(createGame().gangPackage).toEqual({ status: 'none' });
  });

  it('does not establish during reaction submission', () => {
    expect(openMingGang().gangPackage).toEqual({ status: 'none' });
  });

  it('establishes a MingGang package only after successful resolution', () => {
    const state = resolvedMingGang();
    expect(state.gangPackage).toEqual({
      status: 'active',
      payerPlayerIndex: 0,
      beneficiaryPlayerIndex: 1,
      source: 'ming-gang',
      establishedByMeldId: 'meld-1',
    });
    expect(state.pendingScoringEvents[0]?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
    ]);
  });

  it('keeps the package through Match settlement and repeated resolution', () => {
    const raw = resolvedMingGang();
    const settled = applyGameActionToMatch(matchWithHand(raw), {
      type: 'RESOLVE_REACTION_WINDOW',
    });
    expect(settled.currentHand.gangPackage).toEqual(raw.gangPackage);
    expect(settled.cumulativeScores).toEqual([980, 1020, 1000, 1000]);
    expect(applyAction(raw, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(raw);
  });

  it('does not establish a package for AnGang and redirects all three shares when active', () => {
    const inactive = { ...activeState(), gangPackage: { status: 'none' as const } };
    const plain = applyAction(inactive, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    expect(plain.gangPackage).toEqual({ status: 'none' });

    const active = applyAction(activeState(), {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    expect(active.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
    ]);
    expect(active.gangPackage).toEqual(activeState().gangPackage);
    expect(active.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it('redirects a runtime FlowerKong without creating or replacing a package', () => {
    const state = activeState();
    const withFlowers: GameState = {
      ...state,
      players: state.players.map((player, index) =>
        index === 1
          ? {
              ...player,
              hand: [ordinary('wind-east-1')],
              flowers: [
                tile('flower-red-center-1'),
                tile('flower-red-center-2'),
                tile('flower-red-center-3'),
              ].filter(
                (candidate): candidate is Extract<Tile, { category: 'flower' }> =>
                  candidate.category === 'flower',
              ),
            }
          : player,
      ),
      wall: [tile('flower-red-center-4'), ordinary('tong-8-1')],
      turnStage: 'waiting-for-draw',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'draw' },
    };
    const result = applyAction(withFlowers, { type: 'DRAW_TILE' });
    expect(result.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
    ]);
    expect(result.gangPackage).toEqual(state.gangPackage);
  });

  it('redirects a later BuGang but preserves the first active package', () => {
    const state = activeState();
    const originalPackage = state.gangPackage;
    const candidate: GameState = {
      ...state,
      players: state.players.map((player, index) =>
        index === 1
          ? {
              ...player,
              hand: [ordinary('wan-5-4')],
              melds: [
                ...player.melds,
                {
                  id: 'meld-8',
                  type: 'peng',
                  tiles: [ordinary('wan-5-1'), ordinary('wan-5-2'), ordinary('wan-5-3')],
                  claimedTileId: 'wan-5-3',
                  fromPlayerIndex: 2,
                },
              ],
              buGangDrawProvenance: [{ targetMeldId: 'meld-8', tileId: 'wan-5-4' }],
            }
          : player,
      ),
    };
    const declared = applyAction(candidate, {
      type: 'DECLARE_BU_GANG',
      playerIndex: 1,
      meldId: 'meld-8',
    });
    expect(declared.gangPackage).toEqual(originalPackage);
    const resolved = passAndResolve(declared);
    expect(resolved.gangPackage).toEqual(originalPackage);
    expect(resolved.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
    ]);
    expect(resolved.players[1]?.melds.at(-1)?.type).toBe('bu-gang');
  });

  it('snapshots ending-discard income before clearing the package', () => {
    const state = activeState();
    const tracked: GameState = {
      ...state,
      players: state.players.map((player, index) =>
        index === 1 ? { ...player, hand: [ordinary('wind-north-1')] } : player,
      ),
      specialDiscardTracking: {
        ...state.specialDiscardTracking,
        windSequences: state.specialDiscardTracking.windSequences.map((sequence, index) =>
          index === 1 ? { playerIndex: 1, winds: ['east', 'south', 'west'] } : sequence,
        ),
      },
    };
    const result = applyAction(tracked, { type: 'DISCARD_TILE', tileId: 'wind-north-1' });
    expect(result.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
      { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
    ]);
    expect(result.gangPackage).toEqual({ status: 'none' });
    expect(result.handProgressFacts.packageSettlementCount).toBe(0);
  });

  it('clears on a normal legal beneficiary discard but not an illegal discard', () => {
    const state = activeState();
    expect(applyAction(state, { type: 'DISCARD_TILE', tileId: 'missing' })).toBe(state);
    const result = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-1' });
    expect(result.gangPackage).toEqual({ status: 'none' });
    expect(result.reactionWindow?.source).toBe('discard');
  });

  it('does not redirect beneficiary penalties or transfers to other receivers', () => {
    const state = activeState();
    const penalized: GameState = {
      ...state,
      players: state.players.map((player, index) =>
        index === 1
          ? {
              ...player,
              hand: [ordinary('wan-2-4')],
              discardPile: [1, 2, 3].map((copy) => ({
                tile: ordinary(`wan-2-${copy}` as TileId),
              })),
            }
          : player,
      ),
    };
    const result = applyAction(penalized, { type: 'DISCARD_TILE', tileId: 'wan-2-4' });
    expect(result.pendingScoringEvents.at(-1)?.transfers).toEqual([
      { fromPlayerIndex: 1, toPlayerIndex: 0, amount: 10 },
      { fromPlayerIndex: 1, toPlayerIndex: 2, amount: 10 },
      { fromPlayerIndex: 1, toPlayerIndex: 3, amount: 10 },
    ]);
  });

  it('allows duplicate transfer directions in transactional Match settlement', () => {
    const hand: GameState = {
      ...activeState(),
      pendingScoringEvents: [
        {
          type: 'an-gang-created',
          playerIndex: 1,
          meldId: 'meld-8',
          status: 'pending',
          transfers: [
            { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
            { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
            { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
          ],
        },
      ],
    };
    const settled = settlePendingScoringEvents(matchWithHand(hand));
    expect(settled.cumulativeScores).toEqual([970, 1030, 1000, 1000]);
    expect(settled.currentHand.pendingScoringEvents).toEqual([]);
  });

  it('resets the package when preparing the next hand', () => {
    const hand: GameState = {
      ...activeState(),
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      result: { type: 'draw', reason: 'wall-exhausted' },
    };
    const match = { ...matchWithHand(hand), currentHandStatus: 'completed' as const };
    expect(prepareNextHand(match).currentHand.gangPackage).toEqual({ status: 'none' });
  });
});

describe('corrupt gang package defense', () => {
  const corruptValues: readonly unknown[] = [
    null,
    1,
    [],
    { status: 'unknown' },
    { status: 'none', extra: true },
    { status: 'active' },
    { ...activeState().gangPackage, payerPlayerIndex: Number.NaN },
    { ...activeState().gangPackage, payerPlayerIndex: Number.POSITIVE_INFINITY },
    { ...activeState().gangPackage, payerPlayerIndex: 0.5 },
    { ...activeState().gangPackage, payerPlayerIndex: 1 },
    { ...activeState().gangPackage, source: 'an-gang' },
    { ...activeState().gangPackage, establishedByMeldId: '' },
    { ...activeState().gangPackage, establishedByMeldId: 'missing' },
  ];

  it.each(corruptValues)('rejects corrupt package %j transactionally', (gangPackage) => {
    const base = activeState();
    const state = { ...base, gangPackage } as unknown as GameState;
    expect(applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-1' })).toBe(state);
  });
});

describe('corrupt live-scoring RuleSet transfers', () => {
  it.each([
    ['empty', []],
    ['wrong payer', [{ fromPlayerIndex: 2, toPlayerIndex: 1, amount: 20 }]],
    [
      'more than one',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 20 },
      ],
    ],
  ] as const)('rejects MingGang %s transfers before committing', (_, transfers) => {
    const state = openMingGang();
    const hook = vi
      .spyOn(NANJING_OPEN_RULE_SET, 'getMingGangScoreTransfers')
      .mockReturnValue(mockedTransfers(transfers));
    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result).not.toBe(state);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.players[1]?.melds).toHaveLength(0);
    expect(result.players[0]?.discardPile.at(-1)?.claimedByMeldId).toBeUndefined();
    expect(result.pendingScoringEvents).toHaveLength(0);
    expect(result.gangPackage).toEqual({ status: 'none' });
    expect(result.wall).toEqual(state.wall);
    expect(result.handProgressFacts).toEqual(state.handProgressFacts);
    expect(result.reactionWindow?.status).toBe('closed');
    expect(result.pendingAction.type).toBe('draw');
    expect(applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(result);
  });

  it.each([
    ['empty', []],
    [
      'fewer than three',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
        { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 10 },
      ],
    ],
    [
      'duplicate payer',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
        { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 10 },
      ],
    ],
    [
      'wrong receiver',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 10 },
        { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 10 },
        { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 10 },
      ],
    ],
  ] as const)('rejects AnGang %s transfers as an original-reference no-op', (_, transfers) => {
    const state = anGangStart();
    const hook = vi
      .spyOn(NANJING_OPEN_RULE_SET, 'getAnGangScoreTransfers')
      .mockReturnValue(mockedTransfers(transfers));
    const result = applyAction(state, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 1,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    expect(result).toBe(state);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.pendingScoringEvents).toHaveLength(0);
    expect(result.players[1]?.melds).toEqual(state.players[1]?.melds);
    expect(result.wall).toBe(state.wall);
    expect(result.gangPackage).toEqual({ status: 'none' });
  });

  it.each([
    ['empty', []],
    ['wrong original Peng payer', [{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 }]],
    [
      'more than one',
      [
        { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
      ],
    ],
  ] as const)('rejects BuGang %s transfers before finalize', (_, transfers) => {
    const state = buGangReady();
    const hook = vi
      .spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers')
      .mockReturnValue(mockedTransfers(transfers));
    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(result).not.toBe(state);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.players[1]?.melds[0]?.type).toBe('peng');
    expect(result.players[1]?.hand.some((tile) => tile.id === 'wan-5-4')).toBe(true);
    expect(result.pendingScoringEvents).toHaveLength(0);
    expect(result.gangPackage).toEqual({ status: 'none' });
    expect(result.wall).toBe(state.wall);
    expect(result.reactionWindow?.status).toBe('closed');
    expect(result.pendingAction).toMatchObject({ playerIndex: 1, type: 'discard' });
    expect(applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(result);
  });

  it.each([
    ['empty', []],
    [
      'fewer than three',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 2, toPlayerIndex: 1, amount: 20 },
      ],
    ],
    [
      'duplicate payer',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 20 },
      ],
    ],
    [
      'wrong receiver',
      [
        { fromPlayerIndex: 0, toPlayerIndex: 1, amount: 20 },
        { fromPlayerIndex: 2, toPlayerIndex: 0, amount: 20 },
        { fromPlayerIndex: 3, toPlayerIndex: 1, amount: 20 },
      ],
    ],
  ] as const)('rejects FlowerKong %s transfers atomically', (_, transfers) => {
    const state = flowerKongStart();
    const hook = vi
      .spyOn(NANJING_OPEN_RULE_SET, 'getFlowerKongScoreTransfers')
      .mockReturnValue(mockedTransfers(transfers));
    const result = applyAction(state, { type: 'DRAW_TILE' });
    expect(result).toBe(state);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(result.players[1]?.flowers).toEqual(state.players[1]?.flowers);
    expect(result.wall).toBe(state.wall);
    expect(result.pendingScoringEvents).toHaveLength(0);
    expect(result.handProgressFacts).toBe(state.handProgressFacts);
    expect(result.gangPackage).toEqual({ status: 'none' });
  });
});
