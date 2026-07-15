import { describe, expect, it, vi } from 'vitest';

import {
  applyAction,
  applyGameActionToMatch,
  completeCurrentHand,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  evaluateHuStructure,
  getAvailableDiHuDecision,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  getWinningTileFaces,
  NANJING_OPEN_RULE_SET,
  prepareNextHand,
  startCurrentHand,
  startGame,
  type GameAction,
  type GameState,
  type Meld,
  type MatchState,
  type MahjongTile,
  type OrdinaryHandTile,
  type OrdinaryTileFace,
  type TileId,
} from '../src';

const deck = createNanjingMahjongDeck();

function mahjongTile(id: TileId): MahjongTile {
  const found = deck.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing tile ${id}`);
  return found;
}

function tile(id: TileId): OrdinaryHandTile {
  const found = mahjongTile(id);
  if (!found || found.category === 'flower') throw new Error(`Missing ordinary tile ${id}`);
  return found;
}

function tiles(...ids: TileId[]): OrdinaryHandTile[] {
  return ids.map(tile);
}

const standardWait = tiles(
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
);

const eastFace = { category: 'wind', wind: 'east' } as const;

const WAIT_PREFIXES = [
  'wan-1',
  'wan-2',
  'wan-3',
  'wan-4',
  'wan-5',
  'wan-6',
  'tiao-1',
  'tiao-2',
  'tiao-3',
  'tong-1',
  'tong-2',
  'tong-3',
  'wind-east',
] as const;

const NON_WAIT_PREFIXES = [
  [
    'wan-7',
    'wan-7',
    'wan-7',
    'wan-7',
    'wan-8',
    'wan-8',
    'wan-8',
    'wan-8',
    'tiao-4',
    'tiao-5',
    'tong-6',
    'wind-south',
    'wind-west',
  ],
  [
    'tong-7',
    'tong-7',
    'tong-7',
    'tong-7',
    'tong-8',
    'tong-8',
    'tong-8',
    'tong-8',
    'tiao-1',
    'tiao-2',
    'wan-6',
    'wind-north',
    'wind-south',
  ],
  [
    'tiao-7',
    'tiao-7',
    'tiao-7',
    'tiao-7',
    'tiao-8',
    'tiao-8',
    'tiao-8',
    'tiao-8',
    'wan-4',
    'wan-5',
    'tong-6',
    'wind-north',
    'wind-west',
  ],
  [
    'wan-9',
    'wan-9',
    'wan-9',
    'wan-9',
    'tong-9',
    'tong-9',
    'tong-9',
    'tong-9',
    'tiao-9',
    'wind-east',
    'wind-south',
    'wind-west',
    'wind-north',
  ],
] as const;

function takeOrdinaryTiles(prefixes: readonly string[], used: Set<TileId>): OrdinaryHandTile[] {
  return prefixes.map((prefix) => {
    const found = deck.find(
      (candidate): candidate is OrdinaryHandTile =>
        candidate.category !== 'flower' &&
        candidate.id.startsWith(`${prefix}-`) &&
        !used.has(candidate.id),
    );
    if (!found) throw new Error(`No unused ordinary tile for ${prefix}`);
    used.add(found.id);
    return found;
  });
}

function deterministicWall(
  dealerIndex: number,
  rawHands: readonly (readonly MahjongTile[])[],
  tailDrawOrder: readonly MahjongTile[] = [],
): MahjongTile[] {
  const targets = rawHands.map((hand, index) => (index === dealerIndex ? 14 : 13));
  expect(rawHands.map((hand) => hand.length)).toEqual(targets);
  const head: MahjongTile[] = [];
  const positions = rawHands.map(() => 0);
  while (positions.some((position, index) => position < targets[index]!)) {
    for (let offset = 0; offset < 4; offset += 1) {
      const playerIndex = (dealerIndex + offset) % 4;
      const position = positions[playerIndex]!;
      if (position >= targets[playerIndex]!) continue;
      head.push(rawHands[playerIndex]![position]!);
      positions[playerIndex] = position + 1;
    }
  }
  const reserved = new Set([...head, ...tailDrawOrder].map((candidate) => candidate.id));
  expect(reserved.size).toBe(head.length + tailDrawOrder.length);
  const middle = deck.filter((candidate) => !reserved.has(candidate.id));
  const wall = [...head, ...middle, ...[...tailDrawOrder].reverse()];
  expect(wall).toHaveLength(144);
  expect(new Set(wall.map((candidate) => candidate.id)).size).toBe(144);
  return wall;
}

function openingHands(
  eligiblePlayerIndices: readonly number[],
  dealerIndex = 0,
): { readonly hands: OrdinaryHandTile[][]; readonly used: Set<TileId> } {
  const used = new Set<TileId>();
  const hands = [0, 1, 2, 3].map((playerIndex) =>
    eligiblePlayerIndices.includes(playerIndex)
      ? takeOrdinaryTiles(WAIT_PREFIXES, used)
      : takeOrdinaryTiles(NON_WAIT_PREFIXES[playerIndex]!, used),
  );
  hands[dealerIndex] = [...hands[dealerIndex]!, ...takeOrdinaryTiles(['tong-6'], used)];
  return { hands, used };
}

function realOpening(eligiblePlayerIndices: readonly number[], dealerIndex = 0): GameState {
  const { hands } = openingHands(eligiblePlayerIndices, dealerIndex);
  const ready = { ...createGame({ dealerIndex }), wall: deterministicWall(dealerIndex, hands) };
  return startGame(ready, { dealerIndex });
}

describe('real opening Di Hu production chain', () => {
  it('opens directly on the dealer when no non-dealer is listening', () => {
    const state = realOpening([]);
    expect(state.phase).toBe('playing');
    expect(state.turnStage).toBe('waiting-for-discard');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(state.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
    expect(state.selfDrawProvenance).toEqual({
      playerIndex: 0,
      tileId: state.players[0]!.hand.at(-1)!.id,
      source: 'initial-dealer',
    });
    for (let playerIndex = 0; playerIndex < 4; playerIndex += 1) {
      expect(getAvailableDiHuDecision(state, playerIndex)).toBeNull();
    }
    expect(
      applyAction(state, { type: 'DISCARD_TILE', tileId: state.players[0]!.hand[0]!.id }),
    ).not.toBe(state);
  });

  it('queues only one listening non-dealer and supports declare and pass', () => {
    const state = realOpening([2]);
    const provenance = state.selfDrawProvenance;
    expect(state.diHuDeclarations).toEqual({
      status: 'collecting',
      pendingPlayerIndices: [2],
      declarations: [],
    });
    expect(state.currentPlayerIndex).toBe(0);
    expect(getAvailableDiHuDecision(state, 2)).toEqual({
      playerIndex: 2,
      decisions: ['declare', 'pass'],
    });
    expect(getAvailableDiHuDecision(state, 1)).toBeNull();
    expect(getAvailableDiHuDecision(state, 3)).toBeNull();

    const declared = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 2,
      decision: 'declare',
    });
    expect(declared.diHuDeclarations).toEqual({
      status: 'closed',
      declarations: [{ playerIndex: 2, winningTileFaces: [eastFace] }],
    });
    expect(declared.selfDrawProvenance).toBe(provenance);
    expect(declared.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });

    const passed = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 2,
      decision: 'pass',
    });
    expect(passed.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
  });

  it('orders two listeners by seat and skips the non-listening middle player', () => {
    let state = realOpening([1, 3]);
    const provenance = state.selfDrawProvenance;
    expect(state.diHuDeclarations).toEqual({
      status: 'collecting',
      pendingPlayerIndices: [1, 3],
      declarations: [],
    });
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
    expect(state.pendingAction).toEqual({ playerIndex: 3, seat: 'north', type: 'di-hu-decision' });
    expect(getAvailableDiHuDecision(state, 2)).toBeNull();
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 3,
      decision: 'pass',
    });
    expect(state.diHuDeclarations).toEqual({
      status: 'closed',
      declarations: [{ playerIndex: 1, winningTileFaces: [eastFace] }],
    });
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.selfDrawProvenance).toBe(provenance);
    expect(
      applyAction(state, { type: 'DISCARD_TILE', tileId: state.players[0]!.hand[0]!.id }),
    ).not.toBe(state);
  });

  it('processes all three listeners in order and rejects early, dealer, repeated, and corrupt actions', () => {
    let state = realOpening([1, 2, 3]);
    const opening = structuredClone({
      players: state.players,
      wall: state.wall,
      facts: state.handProgressFacts,
      events: state.pendingScoringEvents,
    });
    const provenance = state.selfDrawProvenance;
    expect(state.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [1, 2, 3] });
    for (const action of [
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 2, decision: 'declare' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 0, decision: 'declare' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 1.5, decision: 'declare' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: Number.NaN, decision: 'declare' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: Number.POSITIVE_INFINITY, decision: 'declare' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 1, decision: 'unknown' },
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 1, decision: 'declare', extra: true },
    ]) {
      expect(applyAction(state, action as unknown as GameAction)).toBe(state);
    }
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
    const afterFirst = state;
    expect(
      applyAction(state, {
        type: 'SUBMIT_DI_HU_DECISION',
        playerIndex: 1,
        decision: 'pass',
      }),
    ).toBe(state);
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 2,
      decision: 'pass',
    });
    expect(state.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [3] });
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 3,
      decision: 'declare',
    });
    expect(state.diHuDeclarations).toEqual({
      status: 'closed',
      declarations: [
        { playerIndex: 1, winningTileFaces: [eastFace] },
        { playerIndex: 3, winningTileFaces: [eastFace] },
      ],
    });
    expect(afterFirst.currentPlayerIndex).toBe(0);
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.selfDrawProvenance).toBe(provenance);
    expect({
      players: state.players,
      wall: state.wall,
      facts: state.handProgressFacts,
      events: state.pendingScoringEvents,
    }).toEqual(opening);
  });

  it('excludes a listening dealer and preserves Tian Hu after the non-dealer decides', () => {
    const used = new Set<TileId>();
    const dealerHand = [
      ...takeOrdinaryTiles(WAIT_PREFIXES, used),
      ...takeOrdinaryTiles(['wind-east'], used),
    ];
    const hands = [
      dealerHand,
      takeOrdinaryTiles(WAIT_PREFIXES, used),
      takeOrdinaryTiles(NON_WAIT_PREFIXES[2]!, used),
      takeOrdinaryTiles(NON_WAIT_PREFIXES[3]!, used),
    ];
    let state = startGame({ ...createGame(), wall: deterministicWall(0, hands) });
    expect(state.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [1] });
    expect(getAvailableDiHuDecision(state, 0)).toBeNull();
    const provenance = state.selfDrawProvenance;
    state = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'pass',
    });
    expect(state.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
    expect(state.selfDrawProvenance).toBe(provenance);
    expect(getAvailableSelfDrawHu(state, 0)?.evaluation.patterns).toEqual(['tian-hu']);
    expect(
      applyAction(state, {
        type: 'SUBMIT_DI_HU_DECISION',
        playerIndex: 0,
        decision: 'declare',
      }),
    ).toBe(state);
  });
});

describe('real initial flower replacement and settlement', () => {
  it('computes eligibility only after a flower and a consecutive flower are fully replaced', () => {
    const { hands } = openingHands([1]);
    const east = hands[1]!.at(-1)!;
    expect(east).toMatchObject({ category: 'wind', wind: 'east' });
    const firstFlower = mahjongTile('flower-red-center-1');
    const chainedFlower = mahjongTile('flower-red-center-2');
    hands[1] = [...hands[1]!.slice(0, -1), firstFlower] as OrdinaryHandTile[];
    const wall = deterministicWall(0, hands, [chainedFlower, east]);
    const state = startGame({ ...createGame(), wall });

    expect(state.players[1]!.flowers.map((flower) => flower.id)).toEqual([
      firstFlower.id,
      chainedFlower.id,
    ]);
    expect(state.players[1]!.hand).toContainEqual(east);
    expect(state.diHuDeclarations).toEqual({
      status: 'collecting',
      pendingPlayerIndices: [1],
      declarations: [],
    });
    expect(state.selfDrawProvenance).toMatchObject({
      playerIndex: 0,
      source: 'initial-dealer',
    });
    const declared = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
    expect(declared.diHuDeclarations).toEqual({
      status: 'closed',
      declarations: [{ playerIndex: 1, winningTileFaces: [eastFace] }],
    });
  });

  it('finishes multiple players replacement in seat order before exposing decisions', () => {
    const { hands } = openingHands([1]);
    const playerOneReplacement = hands[1]!.at(-1)!;
    const playerTwoReplacement = hands[2]!.at(-1)!;
    hands[1] = [...hands[1]!.slice(0, -1), mahjongTile('flower-fortune-1')] as OrdinaryHandTile[];
    hands[2] = [
      ...hands[2]!.slice(0, -1),
      mahjongTile('flower-white-board-1'),
    ] as OrdinaryHandTile[];
    const state = startGame({
      ...createGame(),
      wall: deterministicWall(0, hands, [playerOneReplacement, playerTwoReplacement]),
    });
    expect(state.players[1]!.hand).toContainEqual(playerOneReplacement);
    expect(state.players[2]!.hand).toContainEqual(playerTwoReplacement);
    expect(state.players[1]!.flowers).toHaveLength(1);
    expect(state.players[2]!.flowers).toHaveLength(1);
    expect(state.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [1] });
  });

  it('settles a real initial flower kong without clearing the Di Hu queue', () => {
    const { hands } = openingHands([1]);
    const replacements = hands[2]!.slice(-4);
    hands[2] = [
      ...hands[2]!.slice(0, -4),
      mahjongTile('flower-red-center-1'),
      mahjongTile('flower-red-center-2'),
      mahjongTile('flower-red-center-3'),
      mahjongTile('flower-red-center-4'),
    ] as OrdinaryHandTile[];
    const readyHand = {
      ...createGame(),
      wall: deterministicWall(0, hands, replacements),
    };
    let match: MatchState = { ...createMatch(), currentHand: readyHand };
    match = startCurrentHand(match);

    expect(match.cumulativeScores).toEqual([980, 980, 1060, 980]);
    expect(match.currentHand.pendingScoringEvents).toEqual([]);
    expect(match.currentHand.handProgressFacts.flowerKongCount).toBe(1);
    expect(match.currentHand.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [1] });
    expect(match.currentHand.currentPlayerIndex).toBe(0);
    expect(match.currentHand.selfDrawProvenance).toMatchObject({
      playerIndex: 0,
      source: 'initial-dealer',
    });
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
    expect(match.currentHand.diHuDeclarations).toMatchObject({ status: 'closed' });
  });

  it('ends a real initial replacement when the wall has no replacement tile', () => {
    const { hands } = openingHands([]);
    hands[1] = [...hands[1]!.slice(0, -1), mahjongTile('flower-fortune-1')] as OrdinaryHandTile[];
    const fullWall = deterministicWall(0, hands);
    const state = startGame({ ...createGame(), wall: fullWall.slice(0, 53) });
    expect(state.phase).toBe('ended');
    expect(state.turnStage).toBe('hand-ended');
    expect(state.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(state.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
    expect(state.pendingAction.type).toBe('none');
    for (let playerIndex = 0; playerIndex < 4; playerIndex += 1) {
      expect(getAvailableDiHuDecision(state, playerIndex)).toBeNull();
    }
    expect(
      applyAction(state, {
        type: 'SUBMIT_DI_HU_DECISION',
        playerIndex: 1,
        decision: 'declare',
      }),
    ).toBe(state);
  });
});

describe('real draw and next-hand lifecycle', () => {
  it('keeps a declaration scoreless on draw and resets it for a differently eligible next hand', () => {
    const firstOpening = realOpening([1]);
    let match: MatchState = {
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      currentHand: firstOpening,
    };
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
    const oldDeclaration = match.currentHand.diHuDeclarations;
    const oldWaitFaces =
      oldDeclaration?.status === 'closed'
        ? oldDeclaration.declarations[0]!.winningTileFaces
        : undefined;
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    match = { ...match, currentHand: { ...match.currentHand, wall: [] } };
    match = applyGameActionToMatch(match, {
      type: 'DISCARD_TILE',
      tileId: match.currentHand.players[0]!.hand[0]!.id,
    });
    for (const responder of match.currentHand.reactionWindow?.responderOrder ?? []) {
      match = applyGameActionToMatch(match, {
        type: 'PASS_REACTION',
        playerIndex: responder.playerIndex,
      });
    }
    match = applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' });
    expect(match.currentHand.phase).toBe('ended');
    expect(match.currentHand.result).toEqual({ type: 'draw', reason: 'wall-exhausted' });
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(applyGameActionToMatch(match, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(match);

    match = completeCurrentHand(match);
    expect(match.completedHands).toHaveLength(1);
    expect(match.effectiveDealerTurn).toBe(1);
    expect(() => completeCurrentHand(match)).toThrow(/must be playing/i);
    match = prepareNextHand(match);
    expect(match.currentHand.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
    expect(match.currentHand.specialDiscardTracking.followDiscard).toBeNull();
    expect(
      match.currentHand.specialDiscardTracking.windSequences.every(
        (entry) => entry.winds.length === 0,
      ),
    ).toBe(true);
    expect(match.currentHand.handProgressFacts).toEqual(createGame().handProgressFacts);
    expect(
      match.currentHand.players.every(
        (player) => !player.passHu && player.buGangDrawProvenance.length === 0,
      ),
    ).toBe(true);

    const { hands } = openingHands([3]);
    match = startCurrentHand({
      ...match,
      currentHand: { ...match.currentHand, wall: deterministicWall(0, hands) },
    });
    expect(match.currentHand.diHuDeclarations).toMatchObject({ pendingPlayerIndices: [3] });
    match = applyGameActionToMatch(match, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 3,
      decision: 'declare',
    });
    expect(match.currentHand.diHuDeclarations).not.toBe(oldDeclaration);
    const nextDeclaration = match.currentHand.diHuDeclarations;
    expect(nextDeclaration).toEqual({
      status: 'closed',
      declarations: [{ playerIndex: 3, winningTileFaces: [eastFace] }],
    });
    expect(
      nextDeclaration?.status === 'closed'
        ? nextDeclaration.declarations[0]!.winningTileFaces
        : undefined,
    ).not.toBe(oldWaitFaces);
    expect(match.currentHand.selfDrawProvenance).toMatchObject({
      playerIndex: 0,
      source: 'initial-dealer',
    });
  });
});

describe('pure winning-tile face query', () => {
  it('returns a standard single wait without mutating input', () => {
    const input = { concealedTiles: standardWait, melds: [] };
    const before = structuredClone(input);

    expect(getWinningTileFaces(input)).toEqual([eastFace]);
    expect(input).toEqual(before);
  });

  it('returns stable multi-waits in wan, tiao, tong, then wind order', () => {
    const waits = getWinningTileFaces({
      concealedTiles: tiles(
        'wan-1-1',
        'wan-1-2',
        'wan-2-1',
        'wan-2-2',
        'wan-3-1',
        'wan-3-2',
        'tiao-4-1',
        'tiao-4-2',
        'tong-5-1',
        'tong-5-2',
        'wind-east-1',
        'wind-east-2',
        'wind-north-1',
      ),
      melds: [],
    });

    expect(waits).toEqual([{ category: 'wind', wind: 'north' }]);
  });

  it('returns the complete canonical order for a genuine two-face wait', () => {
    const hand = tiles(
      'wan-1-1',
      'wan-2-1',
      'wan-3-1',
      'wan-4-1',
      'wan-5-1',
      'wan-6-1',
      'wan-7-1',
      'wan-8-1',
      'wan-9-1',
      'wan-2-2',
      'wan-2-3',
      'wan-3-2',
      'wan-4-2',
    );
    const before = structuredClone(hand);
    expect(getWinningTileFaces({ concealedTiles: hand, melds: [] })).toEqual([
      { category: 'number', suit: 'wan', rank: 2 },
      { category: 'number', suit: 'wan', rank: 5 },
    ]);
    expect(hand).toEqual(before);
  });

  it('supports an existing Meld', () => {
    const meld: Meld = {
      id: 'meld-1',
      type: 'peng',
      tiles: tiles('wan-9-1', 'wan-9-2', 'wan-9-3'),
      claimedTileId: 'wan-9-3',
      fromPlayerIndex: 2,
    };
    expect(
      getWinningTileFaces({
        concealedTiles: tiles(
          'wan-1-1',
          'wan-2-1',
          'wan-3-1',
          'tiao-1-1',
          'tiao-2-1',
          'tiao-3-1',
          'tong-1-1',
          'tong-2-1',
          'tong-3-1',
          'wind-east-1',
        ),
        melds: [meld],
      }),
    ).toEqual([eastFace]);
  });

  it('supports multiple existing Melds with the reduced concealed count', () => {
    const melds: Meld[] = [
      {
        id: 'meld-1',
        type: 'peng',
        tiles: tiles('wan-9-1', 'wan-9-2', 'wan-9-3'),
        claimedTileId: 'wan-9-3',
        fromPlayerIndex: 2,
      },
      {
        id: 'meld-2',
        type: 'an-gang',
        tiles: tiles('wind-north-1', 'wind-north-2', 'wind-north-3', 'wind-north-4'),
      },
    ];
    expect(
      getWinningTileFaces({
        concealedTiles: tiles(
          'wan-1-1',
          'wan-2-1',
          'wan-3-1',
          'tiao-1-1',
          'tiao-2-1',
          'tiao-3-1',
          'wind-east-1',
        ),
        melds,
      }),
    ).toEqual([eastFace]);
  });

  it('supports seven pairs and dragon-seven-pairs waits', () => {
    const hand = tiles(
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
    );
    expect(getWinningTileFaces({ concealedTiles: hand, melds: [] })).toEqual([eastFace]);
    const result = evaluateHuStructure({
      concealedTiles: hand,
      winningTile: tile('wind-east-2'),
      melds: [],
    });
    expect(result?.type).toBe('seven-pairs');

    const dragonHand = [...hand.slice(0, 2), tile('wan-1-3'), ...hand.slice(2, -1)];
    expect(getWinningTileFaces({ concealedTiles: dragonHand, melds: [] })).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 1,
    });
  });

  it('skips a face already represented by four real entities', () => {
    const hand = [
      ...standardWait.slice(0, 9),
      ...tiles('wind-east-1', 'wind-east-2', 'wind-east-3', 'wind-east-4'),
    ];
    expect(getWinningTileFaces({ concealedTiles: hand, melds: [] })).not.toContainEqual(eastFace);
  });

  it('skips a candidate when concealed tiles plus Meld already contain all four entities', () => {
    const meld: Meld = {
      id: 'meld-east',
      type: 'peng',
      tiles: tiles('wind-east-1', 'wind-east-2', 'wind-east-3'),
      claimedTileId: 'wind-east-3',
      fromPlayerIndex: 2,
    };
    const hand = tiles(
      'wan-1-1',
      'wan-2-1',
      'wan-3-1',
      'tiao-1-1',
      'tiao-2-1',
      'tiao-3-1',
      'tong-1-1',
      'tong-2-1',
      'tong-3-1',
      'wind-east-4',
    );
    expect(getWinningTileFaces({ concealedTiles: hand, melds: [meld] })).not.toContainEqual(
      eastFace,
    );
  });

  it('never returns flowers and rejects a corrupt concealed flower', () => {
    const result = getWinningTileFaces({ concealedTiles: standardWait, melds: [] });
    expect(result?.every((face) => face.category === 'number' || face.category === 'wind')).toBe(
      true,
    );
    const flower = deck.find((candidate) => candidate.category === 'flower')!;
    expect(
      getWinningTileFaces({
        concealedTiles: [...standardWait.slice(0, -1), flower] as unknown as OrdinaryHandTile[],
        melds: [],
      }),
    ).toBeNull();
  });

  it('rejects a fifth physical entity of one face', () => {
    const fifth = { ...tile('wan-1-1'), id: 'wan-1-5' } as unknown as OrdinaryHandTile;
    expect(
      getWinningTileFaces({
        concealedTiles: [
          ...tiles('wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4'),
          fifth,
          ...standardWait.slice(5, 13),
        ],
        melds: [],
      }),
    ).toBeNull();
  });

  it('identifies an unambiguous dragon-seven-pairs winning structure', () => {
    const concealed = tiles(
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-2-1',
      'wan-2-2',
      'wan-4-1',
      'wan-4-2',
      'wan-6-1',
      'wan-6-2',
      'tiao-2-1',
      'tiao-2-2',
      'tong-5-1',
      'tong-5-2',
    );
    expect(getWinningTileFaces({ concealedTiles: concealed, melds: [] })).toContainEqual({
      category: 'number',
      suit: 'wan',
      rank: 1,
    });
    expect(
      evaluateHuStructure({ concealedTiles: concealed, winningTile: tile('wan-1-4'), melds: [] }),
    ).toMatchObject({
      type: 'dragon-seven-pairs',
      dragon: { category: 'number', suit: 'wan', rank: 1 },
    });
  });

  it('returns [] for a valid non-listening structure', () => {
    expect(
      getWinningTileFaces({
        concealedTiles: tiles(
          'wan-1-1',
          'wan-1-2',
          'wan-1-3',
          'wan-1-4',
          'wan-2-1',
          'wan-2-2',
          'wan-2-3',
          'wan-2-4',
          'tiao-1-1',
          'tiao-2-1',
          'tong-4-1',
          'wind-south-1',
          'wind-west-1',
        ),
        melds: [],
      }),
    ).toEqual([]);
  });

  it.each([null, 1, {}, { concealedTiles: null, melds: [] }, { concealedTiles: [], melds: null }])(
    'returns null for corrupt input %j',
    (input) => {
      expect(() =>
        getWinningTileFaces(input as unknown as Parameters<typeof getWinningTileFaces>[0]),
      ).not.toThrow();
      expect(
        getWinningTileFaces(input as unknown as Parameters<typeof getWinningTileFaces>[0]),
      ).toBeNull();
    },
  );

  it('rejects duplicate tile ids, corrupt Melds, and impossible concealed counts', () => {
    const duplicate = [...standardWait.slice(0, -1), standardWait[0]!];
    expect(getWinningTileFaces({ concealedTiles: duplicate, melds: [] })).toBeNull();
    expect(
      getWinningTileFaces({
        concealedTiles: standardWait,
        melds: [
          {
            id: 'bad',
            type: 'peng',
            tiles: tiles('wan-9-1', 'wan-8-1', 'wan-9-2'),
            claimedTileId: 'wan-9-2',
            fromPlayerIndex: 2,
          },
        ],
      }),
    ).toBeNull();
    expect(
      getWinningTileFaces({ concealedTiles: standardWait.slice(0, 12), melds: [] }),
    ).toBeNull();
  });

  it('is deterministic across repeated queries', () => {
    const input = { concealedTiles: standardWait, melds: [] };
    expect(getWinningTileFaces(input)).toEqual(getWinningTileFaces(input));
    expect(getWinningTileFaces(input)).not.toBe(getWinningTileFaces(input));
  });
});

function collectingState(): GameState {
  const state = createGame();
  return {
    ...state,
    players: state.players.map((player, index) =>
      index === 1 ? { ...player, hand: [...standardWait] } : player,
    ),
    phase: 'playing',
    currentPlayerIndex: 0,
    dealerIndex: 0,
    turnStage: 'waiting-for-di-hu-decision',
    pendingAction: { playerIndex: 1, seat: 'south', type: 'di-hu-decision' },
    diHuDeclarations: { status: 'collecting', pendingPlayerIndices: [1], declarations: [] },
    selfDrawProvenance: { playerIndex: 0, tileId: 'wan-9-4', source: 'initial-dealer' },
  };
}

describe('Di Hu decision state', () => {
  it('exposes only declare/pass to the queue head without wait faces', () => {
    const state = collectingState();
    expect(getAvailableDiHuDecision(state, 1)).toEqual({
      playerIndex: 1,
      decisions: ['declare', 'pass'],
    });
    expect(getAvailableDiHuDecision(state, 0)).toBeNull();
    expect(getAvailableDiHuDecision(state, 2)).toBeNull();
    expect(getAvailableDiHuDecision(state, 1)).not.toHaveProperty('winningTileFaces');
  });

  it('declares using a server-computed snapshot and restores the dealer turn', () => {
    const state = collectingState();
    const result = applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });

    expect(result.diHuDeclarations).toEqual({
      status: 'closed',
      declarations: [{ playerIndex: 1, winningTileFaces: [eastFace] }],
    });
    expect(result.currentPlayerIndex).toBe(0);
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 0, seat: 'east', type: 'discard' });
    expect(result.selfDrawProvenance).toBe(state.selfDrawProvenance);
    expect(result.pendingScoringEvents).toBe(state.pendingScoringEvents);
  });

  it('passes without storing eligibility or a passed-player list', () => {
    const result = applyAction(collectingState(), {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'pass',
    });
    expect(result.diHuDeclarations).toEqual({ status: 'closed', declarations: [] });
    expect(result.diHuDeclarations).not.toHaveProperty('passedPlayerIndices');
    expect(result.diHuDeclarations).not.toHaveProperty('eligiblePlayerIndices');
  });

  it.each([
    { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 0, decision: 'declare' },
    { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 2, decision: 'pass' },
    { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 1.5, decision: 'declare' },
    { type: 'SUBMIT_DI_HU_DECISION', playerIndex: Number.NaN, decision: 'declare' },
    { type: 'SUBMIT_DI_HU_DECISION', playerIndex: 1, decision: 'future' },
  ])('returns the original reference for invalid action %#', (action) => {
    const state = collectingState();
    expect(applyAction(state, action as unknown as GameAction)).toBe(state);
  });

  it('returns null and does not throw for corrupt declaration state', () => {
    const state = collectingState();
    for (const diHuDeclarations of [null, 1, { status: 'collecting', pendingPlayerIndices: [0] }]) {
      const corrupt = { ...state, diHuDeclarations } as unknown as GameState;
      expect(() => getAvailableDiHuDecision(corrupt, 1)).not.toThrow();
      expect(getAvailableDiHuDecision(corrupt, 1)).toBeNull();
      expect(
        applyAction(corrupt, {
          type: 'SUBMIT_DI_HU_DECISION',
          playerIndex: 1,
          decision: 'declare',
        }),
      ).toBe(corrupt);
    }
  });

  it.each([
    { status: 'collecting', pendingPlayerIndices: [1, 1], declarations: [] },
    { status: 'collecting', pendingPlayerIndices: [0], declarations: [] },
    {
      status: 'closed',
      declarations: [{ playerIndex: 1, winningTileFaces: [eastFace, eastFace] }],
    },
    {
      status: 'closed',
      declarations: [
        {
          playerIndex: 1,
          winningTileFaces: [{ category: 'wind', wind: 'east', hidden: true }],
        },
      ],
    },
  ])('rejects malformed queue or wait snapshots %#', (diHuDeclarations) => {
    const state = { ...collectingState(), diHuDeclarations } as unknown as GameState;
    expect(getAvailableDiHuDecision(state, 1)).toBeNull();
  });

  it('rejects client-supplied wait faces on the decision action', () => {
    const state = collectingState();
    expect(
      applyAction(state, {
        type: 'SUBMIT_DI_HU_DECISION',
        playerIndex: 1,
        decision: 'declare',
        winningTileFaces: [eastFace],
      } as unknown as GameAction),
    ).toBe(state);
  });
});

describe('declared Di Hu restrictions', () => {
  function declaredState(): GameState {
    const state = collectingState();
    return applyAction(state, {
      type: 'SUBMIT_DI_HU_DECISION',
      playerIndex: 1,
      decision: 'declare',
    });
  }

  it('requires the exact current draw entity for a declared player discard', () => {
    const base = declaredState();
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, hand: [...player.hand, tile('wind-east-2')] } : player,
      ),
      currentPlayerIndex: 1,
      pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
      selfDrawProvenance: { playerIndex: 1, tileId: 'wind-east-2', source: 'wall-head' },
    };
    expect(applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-1-1' })).toBe(state);
    expect(applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-2' })).not.toBe(state);
  });

  it('keeps the declaration after a legal draw-discard and pass-Hu clearing', () => {
    const base = declaredState();
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1
          ? { ...player, hand: [...player.hand, tile('wind-east-2')], passHu: true }
          : player,
      ),
      currentPlayerIndex: 1,
      pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
      selfDrawProvenance: { playerIndex: 1, tileId: 'wind-east-2', source: 'wall-head' },
    };
    const result = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wind-east-2' });
    expect(result.diHuDeclarations).toEqual(base.diHuDeclarations);
    expect(result.players[1]?.passHu).toBe(false);
  });

  it('adds di-hu to a legal non-dealer Hu evaluation and scores +30 before doubling', () => {
    const evaluation = getRuleEvaluationWithDiHu('discard');
    expect(evaluation?.patterns).toContain('di-hu');
  });

  function staleBuGangWindow(responseType: 'pass' | 'hu'): GameState {
    const base = declaredState();
    const meld = {
      id: 'meld-7',
      type: 'peng' as const,
      tiles: tiles('wan-7-1', 'wan-7-2', 'wan-7-3'),
      claimedTileId: 'wan-7-3' as const,
      fromPlayerIndex: 0,
    };
    const fourth = tile('wan-7-4');
    const responderOrder = [2, 3, 0].map((playerIndex) => ({
      playerIndex,
      seat: base.players[playerIndex]!.seat,
    }));
    return {
      ...base,
      players: base.players.map((player, index) =>
        index === 1
          ? {
              ...player,
              hand: [...standardWait, fourth],
              melds: [meld],
              buGangDrawProvenance: [{ targetMeldId: meld.id, tileId: fourth.id }],
            }
          : player,
      ),
      wall: [tile('tong-9-1')],
      currentPlayerIndex: 1,
      turnStage: 'waiting-for-reaction',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      reactionWindow: {
        source: 'bu-gang',
        intent: {
          declarerPlayerIndex: 1,
          declarerSeat: 'south',
          targetMeldId: meld.id,
          tile: fourth,
        },
        responderOrder,
        availableReactions: responderOrder.map(({ playerIndex, seat }) => ({
          playerIndex,
          seat,
          responseTypes: ['pass', 'hu'],
        })),
        responses: responderOrder.map(({ playerIndex, seat }, index) => ({
          playerIndex,
          seat,
          type: index === 0 ? responseType : 'pass',
        })),
        status: 'awaiting-resolution',
      },
      selfDrawProvenance: { playerIndex: 1, tileId: fourth.id, source: 'wall-head' },
    } as unknown as GameState;
  }

  it('cancels a declared player stale all-pass BuGang window without changing tiles or scoring', () => {
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const state = staleBuGangWindow('pass');
    const beforePlayer = structuredClone(state.players[1]);
    const wall = structuredClone(state.wall);
    const declaration = structuredClone(state.diHuDeclarations);
    const provenance = structuredClone(state.selfDrawProvenance);

    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result.phase).toBe('playing');
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.currentPlayerIndex).toBe(1);
    expect(result.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(result.reactionWindow?.status).toBe('closed');
    expect(result.players[1]).toEqual(beforePlayer);
    expect(result.players[1]?.melds[0]?.type).toBe('peng');
    expect(result.players[1]?.hand).toContainEqual(tile('wan-7-4'));
    expect(result.wall).toEqual(wall);
    expect(result.diHuDeclarations).toEqual(declaration);
    expect(result.selfDrawProvenance).toEqual(provenance);
    expect(result.pendingScoringEvents).toEqual(state.pendingScoringEvents);
    expect(hook).not.toHaveBeenCalled();
    expect(applyAction(result, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(result);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it('cancels a declared player stale Rob-BuGang Hu before Hu or BuGang scoring', () => {
    const huHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');
    const buGangHook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getBuGangScoreTransfers');
    const state = staleBuGangWindow('hu');

    const result = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(result.phase).toBe('playing');
    expect(result.result).toBeUndefined();
    expect(result.turnStage).toBe('waiting-for-discard');
    expect(result.pendingAction).toEqual({ playerIndex: 1, seat: 'south', type: 'discard' });
    expect(result.reactionWindow?.status).toBe('closed');
    expect(result.pendingScoringEvents).toEqual(state.pendingScoringEvents);
    expect(huHook).not.toHaveBeenCalled();
    expect(buGangHook).not.toHaveBeenCalled();
    huHook.mockRestore();
    buGangHook.mockRestore();
  });
});

describe('Di Hu RuleSet integration', () => {
  const declaration = { playerIndex: 1, winningTileFaces: [eastFace] } as const;

  function evaluation(
    source:
      | { source: 'discard'; payerPlayerIndex: number }
      | { source: 'rob-bu-gang'; payerPlayerIndex: number }
      | { source: 'self-draw'; drawSource: 'wall-head' },
  ) {
    return NANJING_OPEN_RULE_SET.evaluateHu({
      ...source,
      winnerPlayerIndex: 1,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: standardWait,
      melds: [],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
      diHuDeclaration: declaration,
    });
  }

  it.each([
    { source: 'discard', payerPlayerIndex: 0 } as const,
    { source: 'rob-bu-gang', payerPlayerIndex: 2 } as const,
    { source: 'self-draw', drawSource: 'wall-head' } as const,
  ])('adds di-hu for $source Hu', (source) => {
    expect(evaluation(source)?.patterns).toEqual(['men-qing', 'no-flower', 'di-hu']);
  });

  it.each([
    { drawSource: 'wall-head' } as const,
    {
      drawSource: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    } as const,
    { drawSource: 'ming-gang-tail' } as const,
    { drawSource: 'an-gang-tail' } as const,
  ])('allows declared self-draw Di Hu from $drawSource', (source) => {
    const result = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'self-draw',
      ...source,
      winnerPlayerIndex: 1,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: standardWait,
      melds: [],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
      diHuDeclaration: declaration,
    });
    expect(result?.patterns).toContain('di-hu');
  });

  it.each([
    { drawSource: 'initial-dealer' },
    { drawSource: 'bu-gang-tail' },
    { drawSource: 'future-tail' },
    { drawSource: 'wall-head', formedFlowerKongDuringReplacement: false },
    { drawSource: 'flower-replacement' },
  ])('rejects declared self-draw Di Hu from invalid source metadata %#', (source) => {
    expect(
      NANJING_OPEN_RULE_SET.evaluateHu({
        source: 'self-draw',
        ...source,
        winnerPlayerIndex: 1,
        playerCount: 4,
        winningTile: tile('wind-east-2'),
        concealedTiles: standardWait,
        melds: [],
        flowers: [],
        allMelds: [],
        dealerIndex: 0,
        diHuDeclaration: declaration,
      } as unknown as Parameters<typeof NANJING_OPEN_RULE_SET.evaluateHu>[0]),
    ).toBeNull();
  });

  it('blocks a declared player corrupt bu-gang-tail self-draw at availability and execution', () => {
    const base = collectingState();
    const state: GameState = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, hand: [...standardWait, tile('wind-east-2')] } : player,
      ),
      currentPlayerIndex: 1,
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
      diHuDeclarations: { status: 'closed', declarations: [declaration] },
      selfDrawProvenance: {
        playerIndex: 1,
        tileId: 'wind-east-2',
        source: 'bu-gang-tail',
      },
    };
    const hook = vi.spyOn(NANJING_OPEN_RULE_SET, 'getHuScoreTransfers');

    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
  });

  it.each([
    { playerIndex: 1, tileId: 'wind-east-2', source: 'bu-gang-tail', hidden: true },
    { playerIndex: 1, source: 'bu-gang-tail' },
  ])('rejects malformed bu-gang-tail provenance %#', (selfDrawProvenance) => {
    const base = collectingState();
    const state = {
      ...base,
      players: base.players.map((player, index) =>
        index === 1 ? { ...player, hand: [...standardWait, tile('wind-east-2')] } : player,
      ),
      currentPlayerIndex: 1,
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
      diHuDeclarations: { status: 'closed', declarations: [] },
      selfDrawProvenance,
    } as unknown as GameState;
    expect(getAvailableSelfDrawHu(state, 1)).toBeNull();
    expect(applyAction(state, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 })).toBe(state);
  });

  it('adds 30 before the open-head multiplier without changing payer topology', () => {
    const withDiHu = evaluation({ source: 'discard', payerPlayerIndex: 0 })!;
    const ordinary = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: standardWait,
      melds: [],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
    })!;
    expect(
      NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'discard',
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        playerCount: 4,
        evaluation: ordinary,
      }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 104 }]);
    expect(
      NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'discard',
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        playerCount: 4,
        evaluation: withDiHu,
      }),
    ).toEqual([{ fromPlayerIndex: 0, toPlayerIndex: 1, amount: 164 }]);
  });

  it('stacks with Hua Kai and Gang Kai in stable order', () => {
    const common = {
      winnerPlayerIndex: 1,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: standardWait,
      melds: [],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
      diHuDeclaration: declaration,
    } as const;
    const hua = NANJING_OPEN_RULE_SET.evaluateHu({
      ...common,
      source: 'self-draw',
      drawSource: 'flower-replacement',
      formedFlowerKongDuringReplacement: false,
    })!;
    const gang = NANJING_OPEN_RULE_SET.evaluateHu({
      ...common,
      source: 'self-draw',
      drawSource: 'an-gang-tail',
    })!;
    expect(hua.patterns).toEqual(['men-qing', 'no-flower', 'di-hu', 'hua-kai']);
    expect(gang.patterns).toEqual(['men-qing', 'no-flower', 'di-hu', 'gang-kai']);
    expect(
      NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'self-draw',
        winnerPlayerIndex: 1,
        playerCount: 4,
        evaluation: hua,
        drawSource: 'flower-replacement',
        formedFlowerKongDuringReplacement: false,
      }).map((transfer) => transfer.amount),
    ).toEqual([184, 184, 184]);
    expect(
      NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'self-draw',
        winnerPlayerIndex: 1,
        playerCount: 4,
        evaluation: gang,
        drawSource: 'an-gang-tail',
      }).map((transfer) => transfer.amount),
    ).toEqual([204, 204, 204]);
  });

  it('rejects dealer and corrupt declaration attempts', () => {
    const base = {
      source: 'discard',
      winnerPlayerIndex: 0,
      payerPlayerIndex: 1,
      playerCount: 4,
      winningTile: tile('wind-east-2'),
      concealedTiles: standardWait,
      melds: [],
      flowers: [],
      allMelds: [],
      dealerIndex: 0,
    } as const;
    expect(
      NANJING_OPEN_RULE_SET.evaluateHu({
        ...base,
        diHuDeclaration: { playerIndex: 0, winningTileFaces: [eastFace] },
      }),
    ).toBeNull();
    expect(
      NANJING_OPEN_RULE_SET.evaluateHu({
        ...base,
        winnerPlayerIndex: 1,
        diHuDeclaration: { playerIndex: 1, winningTileFaces: [] },
      }),
    ).toBeNull();
  });

  it('forbids Peng and permits only wait-preserving MingGang', () => {
    const concealedTiles = [
      ...tiles(
        'wan-1-1',
        'wan-2-1',
        'wan-3-1',
        'tiao-1-1',
        'tiao-2-1',
        'tiao-3-1',
        'tong-1-1',
        'tong-2-1',
        'tong-3-1',
        'wind-east-1',
      ),
      ...tiles('wan-9-1', 'wan-9-2', 'wan-9-3'),
    ];
    const common = {
      source: 'discard',
      playerCount: 4,
      responderPlayerIndex: 1,
      responderSeat: 'south',
      responderConcealedTiles: concealedTiles,
      responderMelds: [],
      responderFlowers: [],
      responderPassHu: false,
      allMelds: [],
      dealerIndex: 0,
      fromPlayerIndex: 0,
      discardedTile: tile('wan-9-4'),
      canDrawFromWallTail: true,
    } as const;
    expect(
      NANJING_OPEN_RULE_SET.getAvailableReactions({
        ...common,
        responderDiHuDeclaration: declaration,
      }).responseTypes,
    ).toEqual(['pass', 'ming-gang']);
    expect(
      NANJING_OPEN_RULE_SET.getAvailableReactions({
        ...common,
        responderDiHuDeclaration: {
          playerIndex: 1,
          winningTileFaces: [{ category: 'wind', wind: 'north' }],
        },
      }).responseTypes,
    ).toEqual(['pass']);
  });

  it('forbids BuGang for a declared player', () => {
    const state = {
      ...collectingState(),
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'discard' },
      currentPlayerIndex: 1,
      diHuDeclarations: { status: 'closed', declarations: [declaration] },
    } as GameState;
    expect(getAvailableBuGangs(state, 1)).toEqual([]);
  });

  it.each([
    { effectiveDealerTurn: 15, expectedDealerIndex: 1, expectedTurn: 16 },
    { effectiveDealerTurn: 16, expectedDealerIndex: 0, expectedTurn: 16 },
  ])(
    'applies the effective dealer-turn rule at turn $effectiveDealerTurn',
    ({ effectiveDealerTurn, expectedDealerIndex, expectedTurn }) => {
      const diHuEvaluation = evaluation({ source: 'discard', payerPlayerIndex: 0 })!;
      const hand: GameState = {
        ...createGame(),
        phase: 'ended',
        turnStage: 'hand-ended',
        pendingAction: { playerIndex: null, seat: null, type: 'none' },
        result: {
          type: 'win',
          source: 'discard',
          payerPlayerIndex: 0,
          winningTile: tile('wind-east-2'),
          winners: [{ playerIndex: 1, evaluation: diHuEvaluation }],
        },
      };
      const match: MatchState = {
        ...createMatch(),
        status: 'playing',
        currentHandStatus: 'playing',
        effectiveDealerTurn,
        currentHand: hand,
      };
      const completed = completeCurrentHand(match);
      expect(completed.dealerIndex).toBe(expectedDealerIndex);
      expect(completed.effectiveDealerTurn).toBe(expectedTurn);
      expect(completed.completedHands).toHaveLength(1);
      expect(() => completeCurrentHand(completed)).toThrow(/must be playing/i);
      expect(completed.completedHands).toHaveLength(1);
    },
  );

  it('makes one continuation decision when turn-16 Di Hu is also self-draw', () => {
    const diHuEvaluation = evaluation({ source: 'self-draw', drawSource: 'wall-head' })!;
    const hand: GameState = {
      ...createGame(),
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { playerIndex: null, seat: null, type: 'none' },
      handProgressFacts: { ...createGame().handProgressFacts, selfDrawCount: 1 },
      result: {
        type: 'win',
        source: 'self-draw',
        winningTile: tile('wind-east-2'),
        winner: { playerIndex: 1, evaluation: diHuEvaluation },
        drawSource: 'wall-head',
      },
    };
    const completed = completeCurrentHand({
      ...createMatch(),
      status: 'playing',
      currentHandStatus: 'playing',
      effectiveDealerTurn: 16,
      currentHand: hand,
    });
    expect(completed.dealerIndex).toBe(0);
    expect(completed.effectiveDealerTurn).toBe(16);
    expect(completed.completedHands).toHaveLength(1);
  });
});

function getRuleEvaluationWithDiHu(source: 'discard') {
  const state = collectingState();
  const declaration = {
    playerIndex: 1,
    winningTileFaces: [eastFace] satisfies readonly OrdinaryTileFace[],
  };
  return createGame().ruleSetId === 'nanjing-open'
    ? // The context carries only the winner's current-hand declaration summary.
      NANJING_OPEN_RULE_SET.evaluateHu({
        source,
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        playerCount: 4,
        winningTile: tile('wind-east-2'),
        concealedTiles: standardWait,
        melds: [],
        flowers: [],
        allMelds: [],
        diHuDeclaration: declaration,
        dealerIndex: state.dealerIndex,
      })
    : null;
}
