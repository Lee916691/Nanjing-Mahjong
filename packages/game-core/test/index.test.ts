import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULE_SET_ID,
  FLOWER_TILE_KINDS,
  NUMBER_TILE_SUITS,
  SEATS,
  advanceTurn,
  applyAction,
  WIND_TILE_KINDS,
  NANJING_OPEN_RULE_SET,
  createInitialPlayers,
  createInitialGame,
  createInitialHandForMatch,
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  createNanjingMahjongTileWall,
  createTileWall,
  completeCurrentHand,
  drawTileFromWallHead,
  drawTileFromWallTail,
  gameEngine,
  getRuleSet,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  listRuleSets,
  prepareNextHand,
  replaceFlowersForSinglePlayer,
  resolveDrawnTileWithFlowerReplacement,
  requiresFlowerReveal,
  startCurrentHand,
  startGame,
  startMatch,
} from '../src';
import type {
  FlowerTile,
  GameCreationOptions,
  GameAction,
  GameState,
  MahjongTile,
  MatchState,
  Meld,
  MeldType,
  OrdinaryHandTile,
  PlayerState,
  ReactionAvailability,
  ReactionWindow,
  ReactionWindowStatus,
  ResolveReactionWindowAction,
  RuleSetOptions,
  StartGameOptions,
  TileId,
} from '../src';

describe('Meld player state model', () => {
  it('exports the reaction resolution status and action types', () => {
    const reactionWindowStatus: ReactionWindowStatus = 'awaiting-resolution';
    const resolveAction: ResolveReactionWindowAction = { type: 'RESOLVE_REACTION_WINDOW' };

    expect(reactionWindowStatus).toBe('awaiting-resolution');
    expect(resolveAction).toEqual({ type: 'RESOLVE_REACTION_WINDOW' });
  });

  it('initializes melds and preserves concrete meld tiles through a draw', () => {
    const deck = createNanjingMahjongDeck();
    const meldTypes: readonly MeldType[] = ['peng', 'ming-gang', 'an-gang', 'bu-gang'];
    const meld: Meld = {
      id: 'meld-1',
      type: 'peng',
      tiles: [
        ordinaryTileById(deck, 'wan-1-1'),
        ordinaryTileById(deck, 'wan-1-2'),
        ordinaryTileById(deck, 'wan-1-3'),
      ],
      claimedTileId: 'wan-1-3',
      fromPlayerIndex: 3,
    };
    const state = createPlayingGameWithWall([ordinaryTileById(deck, 'tiao-2-1')]);
    state.players[0] = { ...state.players[0]!, melds: [meld] };
    const nextState = applyAction(state, { type: 'DRAW_TILE' });

    expect(createInitialPlayers().every((player) => player.melds.length === 0)).toBe(true);
    expect(createGame().players.every((player) => player.melds.length === 0)).toBe(true);
    expect(startGame(createGame()).players.every((player) => player.melds.length === 0)).toBe(true);
    expect(meldTypes).toEqual(['peng', 'ming-gang', 'an-gang', 'bu-gang']);
    expect(meld.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'wan-1-2', 'wan-1-3']);
    expect(nextState.players[0]?.melds).toEqual([meld]);
    expect(nextState.players[0]?.flowers).toEqual([]);
    expect(nextState.pendingScoringEvents).toEqual(state.pendingScoringEvents);
  });

  it('starts newly prepared match hands with empty melds without changing scores', () => {
    const started = startCurrentHand(createMatch());
    const completed = completeCurrentHand(started, {
      dealerTransition: 'advance',
      reason: 'normal-dealer-advance',
    });
    const prepared = prepareNextHand(completed);
    const restarted = startCurrentHand(prepared);

    expect(prepared.currentHand.players.every((player) => player.melds.length === 0)).toBe(true);
    expect(restarted.currentHand.players.every((player) => player.melds.length === 0)).toBe(true);
    expect(restarted.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });
});
function tileById(tiles: readonly MahjongTile[], id: TileId): MahjongTile {
  const tile = tiles.find((candidate) => candidate.id === id);

  if (!tile) {
    throw new Error(`Missing tile ${id}`);
  }

  return tile;
}

function ordinaryTileById(tiles: readonly MahjongTile[], id: TileId): OrdinaryHandTile {
  const tile = tileById(tiles, id);

  if (!isOrdinaryHandTile(tile)) {
    throw new Error(`Expected ordinary hand tile ${id}`);
  }

  return tile;
}

function flowerTileById(tiles: readonly MahjongTile[], id: TileId): FlowerTile {
  const tile = tileById(tiles, id);

  if (!isFlowerTile(tile)) {
    throw new Error(`Expected flower tile ${id}`);
  }

  return tile;
}

function playerAt(state: GameState, playerIndex: number): PlayerState {
  const player = state.players[playerIndex];

  if (!player) {
    throw new Error(`Missing player ${playerIndex}`);
  }

  return player;
}

function tileIds(tiles: readonly MahjongTile[]): TileId[] {
  return tiles.map((tile) => tile.id);
}

function createPlayingGameWithWall(wall: readonly MahjongTile[]): GameState {
  const players = createInitialPlayers();

  return {
    ruleSetId: DEFAULT_RULE_SET_ID,
    players,
    wall: [...wall],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    turnStage: 'waiting-for-draw',
    pendingAction: {
      playerIndex: 0,
      seat: players[0]?.seat ?? 'east',
      type: 'draw',
    },
    pendingScoringEvents: [],
  };
}

function createWaitingForReactionState(): GameState {
  const deck = createNanjingMahjongDeck();
  let state = createPlayingGameWithWall([
    ordinaryTileById(deck, 'wan-2-1'),
    ordinaryTileById(deck, 'wan-2-2'),
  ]);

  state = advanceTurn(state);

  return applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
}
describe('Nanjing Mahjong RuleSet registry', () => {
  it('registers nanjing-open as the default RuleSet shell', () => {
    const state = createGame();
    const action: GameAction = { type: 'DRAW_TILE' };
    const ruleSet = getRuleSet(DEFAULT_RULE_SET_ID);

    expect(DEFAULT_RULE_SET_ID).toBe('nanjing-open');
    expect(ruleSet).toBe(NANJING_OPEN_RULE_SET);
    expect(ruleSet.id).toBe('nanjing-open');
    expect(ruleSet.displayName).toBe('\u5357\u4eac\u9ebb\u5c06\u657e\u5f00\u5934');
    expect(ruleSet.totalEffectiveDealerTurns).toBe(16);
    expect(ruleSet.validateAction(state, action)).toBe(true);
    expect(ruleSet.applyAction(state, action)).toBe(state);
    expect(typeof ruleSet.getAvailableReactions).toBe('function');
    expect(listRuleSets()).toEqual([NANJING_OPEN_RULE_SET]);
  });
});

describe('Nanjing Mahjong match state', () => {
  it('creates a default nanjing-open match shell with 16 dealer turns and initial scores', () => {
    const match: MatchState = createMatch();

    expect(match.ruleSetId).toBe('nanjing-open');
    expect(match.status).toBe('waiting');
    expect(match.totalEffectiveDealerTurns).toBe(16);
    expect(match.effectiveDealerTurn).toBe(1);
    expect(match.dealerIndex).toBe(0);
    expect(match.currentHandIndex).toBe(0);
    expect(match.currentHandStatus).toBe('not-started');
    expect(match.currentHand.ruleSetId).toBe('nanjing-open');
    expect(match.currentHand.phase).toBe('ready');
    expect(match.currentHand.dealerIndex).toBe(match.dealerIndex);
    expect(match.currentHand.currentPlayerIndex).toBe(match.dealerIndex);
    expect(match.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(match.completedHands).toEqual([]);
    expect(match.isFinalDealerTurn).toBe(false);
  });

  it('creates the first ready hand for a match without starting legacy game flow', () => {
    const match = createMatch({ dealerSeat: 'north' });
    const hand = createInitialHandForMatch(match);

    expect(hand.ruleSetId).toBe('nanjing-open');
    expect(hand.phase).toBe('ready');
    expect(hand.dealerIndex).toBe(3);
    expect(hand.currentPlayerIndex).toBe(3);
    expect(hand.players.map((player) => player.hand.length)).toEqual([0, 0, 0, 0]);
  });

  it('starts a match by creating the current hand and dealing from the existing game state', () => {
    const match = createMatch();
    const startedMatch = startMatch(match);

    expect(startedMatch).not.toBe(match);
    expect(startedMatch.status).toBe('playing');
    expect(startedMatch.currentHandStatus).toBe('playing');
    expect(startedMatch.currentHand.ruleSetId).toBe('nanjing-open');
    expect(startedMatch.currentHand.phase).toBe('playing');
    expect(startedMatch.currentHand.dealerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.currentPlayerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      14, 13, 13, 13,
    ]);
    expect(
      startedMatch.currentHand.players.every((player) => player.hand.every(isOrdinaryHandTile)),
    ).toBe(true);
    expect(startedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('supports dealerSeat and dealerIndex when creating or starting matches', () => {
    const southDealerMatch = createMatch({ dealerSeat: 'south' });
    const westDealerMatch = startMatch(createMatch(), { dealerIndex: 2 });

    expect(southDealerMatch.dealerIndex).toBe(1);
    expect(southDealerMatch.currentHand.dealerIndex).toBe(1);
    expect(westDealerMatch.dealerIndex).toBe(2);
    expect(westDealerMatch.currentHand.dealerIndex).toBe(2);
    expect(westDealerMatch.currentHand.currentPlayerIndex).toBe(2);
    expect(westDealerMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      13, 13, 14, 13,
    ]);
  });

  it('keeps initial flower kong scoring events pending without changing match scores', () => {
    const deck = createNanjingMahjongDeck();
    const redCenters = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-red-center-2'),
      flowerTileById(deck, 'flower-red-center-3'),
      flowerTileById(deck, 'flower-red-center-4'),
    ];
    const ordinaryTiles = deck.filter(isOrdinaryHandTile);
    const rawOrdinaryTiles = [...ordinaryTiles.slice(0, 49)];
    const replacementTiles = ordinaryTiles.slice(49, 53);
    const leftoverTile = ordinaryTiles[53];
    const fallbackOrdinaryTile = ordinaryTiles[0];
    const [
      firstReplacementTile,
      secondReplacementTile,
      thirdReplacementTile,
      fourthReplacementTile,
    ] = replacementTiles;
    const rawTiles: MahjongTile[] = [];
    const redCenterPositions = new Set([0, 4, 8, 12]);

    if (
      !leftoverTile ||
      !fallbackOrdinaryTile ||
      !firstReplacementTile ||
      !secondReplacementTile ||
      !thirdReplacementTile ||
      !fourthReplacementTile
    ) {
      throw new Error('Missing ordinary tiles for match flower kong test');
    }

    for (let index = 0; index < 53; index += 1) {
      rawTiles.push(
        redCenterPositions.has(index)
          ? (redCenters.shift() ?? rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile)
          : (rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile),
      );
    }

    const readyHand = {
      ...createGame(),
      wall: [
        ...rawTiles,
        leftoverTile,
        fourthReplacementTile,
        thirdReplacementTile,
        secondReplacementTile,
        firstReplacementTile,
      ],
    };
    const match = {
      ...createMatch(),
      currentHand: readyHand,
    };
    const startedMatch = startMatch(match);

    expect(startedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(startedMatch.currentHand.pendingScoringEvents).toEqual([
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'initial-deal',
        status: 'pending',
      },
    ]);
    expect('score' in playerAt(startedMatch.currentHand, 0)).toBe(false);

    const completedMatch = completeCurrentHand(startedMatch, {
      dealerTransition: 'stay',
      reason: 'draw',
    });

    expect(completedMatch.currentHand.pendingScoringEvents).toEqual(
      startedMatch.currentHand.pendingScoringEvents,
    );
    expect(completedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('completes a hand with dealer advance without settling scores', () => {
    const startedMatch = startMatch(createMatch());
    const completedMatch = completeCurrentHand(startedMatch, {
      dealerTransition: 'advance',
      reason: 'normal-dealer-advance',
    });

    expect(completedMatch.completedHands).toEqual([
      {
        handIndex: 0,
        dealerIndex: 0,
        effectiveDealerTurn: 1,
        result: 'not-scored-yet',
        dealerTransition: 'advance',
        reason: 'normal-dealer-advance',
        pendingScoringEventCount: 0,
      },
    ]);
    expect(completedMatch.dealerIndex).toBe(1);
    expect(completedMatch.effectiveDealerTurn).toBe(2);
    expect(completedMatch.currentHandStatus).toBe('completed');
    expect(completedMatch.status).toBe('playing');
    expect(completedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
    expect(completedMatch.currentHand.dealerIndex).toBe(completedMatch.dealerIndex);
    expect(completedMatch.currentHand.players.map((player) => player.isDealer)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('completes a hand with dealer stay without advancing effective dealer turn', () => {
    const startedMatch = startMatch(createMatch({ dealerIndex: 2 }));
    const completedMatch = completeCurrentHand(startedMatch, {
      dealerTransition: 'stay',
      reason: 'dealer-win',
    });

    expect(completedMatch.completedHands).toEqual([
      {
        handIndex: 0,
        dealerIndex: 2,
        effectiveDealerTurn: 1,
        result: 'not-scored-yet',
        dealerTransition: 'stay',
        reason: 'dealer-win',
        pendingScoringEventCount: 0,
      },
    ]);
    expect(completedMatch.dealerIndex).toBe(2);
    expect(completedMatch.effectiveDealerTurn).toBe(1);
    expect(completedMatch.currentHandStatus).toBe('completed');
    expect(completedMatch.status).toBe('playing');
    expect(completedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });

  it('handles the 16th effective dealer turn from caller-provided completion', () => {
    const finalAdvanceMatch = {
      ...startMatch(createMatch()),
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
    };
    const finalStayMatch = {
      ...startMatch(createMatch()),
      effectiveDealerTurn: 16,
      isFinalDealerTurn: true,
    };

    const advanced = completeCurrentHand(finalAdvanceMatch, {
      dealerTransition: 'advance',
      reason: 'normal-dealer-advance',
    });
    const stayed = completeCurrentHand(finalStayMatch, {
      dealerTransition: 'stay',
      reason: 'final-turn-continuation',
    });

    expect(advanced.status).toBe('completed');
    expect(advanced.effectiveDealerTurn).toBe(16);
    expect(advanced.dealerIndex).toBe(1);
    expect(advanced.currentHandStatus).toBe('completed');
    expect(stayed.status).toBe('playing');
    expect(stayed.effectiveDealerTurn).toBe(16);
    expect(stayed.dealerIndex).toBe(0);
    expect(stayed.currentHandStatus).toBe('completed');
  });

  it('prepares the next ready hand after a completed hand', () => {
    const completedMatch = completeCurrentHand(startMatch(createMatch({ dealerIndex: 3 })), {
      dealerTransition: 'advance',
      reason: 'normal-dealer-advance',
    });
    const nextHandMatch = prepareNextHand(completedMatch);

    expect(nextHandMatch.status).toBe('playing');
    expect(nextHandMatch.currentHandStatus).toBe('not-started');
    expect(nextHandMatch.currentHandIndex).toBe(1);
    expect(nextHandMatch.dealerIndex).toBe(0);
    expect(nextHandMatch.currentHand.phase).toBe('ready');
    expect(nextHandMatch.currentHand.dealerIndex).toBe(nextHandMatch.dealerIndex);
    expect(nextHandMatch.currentHand.currentPlayerIndex).toBe(nextHandMatch.dealerIndex);
    expect(nextHandMatch.currentHand.players.map((player) => player.isDealer)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(nextHandMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('starts the prepared current hand without changing cumulative scores', () => {
    const completedMatch = completeCurrentHand(startMatch(createMatch()), {
      dealerTransition: 'stay',
      reason: 'dealer-win',
    });
    const readyMatch = prepareNextHand(completedMatch);
    const startedMatch = startCurrentHand(readyMatch);

    expect(startedMatch.status).toBe('playing');
    expect(startedMatch.currentHandStatus).toBe('playing');
    expect(startedMatch.currentHand.phase).toBe('playing');
    expect(startedMatch.currentHand.dealerIndex).toBe(startedMatch.dealerIndex);
    expect(startedMatch.currentHand.players.map((player) => player.hand.length)).toEqual([
      14, 13, 13, 13,
    ]);
    expect(
      startedMatch.currentHand.players.every((player) => player.hand.every(isOrdinaryHandTile)),
    ).toBe(true);
    expect(startedMatch.cumulativeScores).toEqual([1000, 1000, 1000, 1000]);
  });
});
describe('Nanjing Mahjong player state', () => {
  it('defines the four seats in canonical action order', () => {
    expect(SEATS).toEqual(['east', 'south', 'west', 'north']);
  });

  it('creates four empty players with stable ids, seats, and east as dealer', () => {
    const players = createInitialPlayers();

    expect(players).toHaveLength(4);
    expect(players.map((player) => player.id)).toEqual([0, 1, 2, 3]);
    expect(players.map((player) => player.seat)).toEqual(['east', 'south', 'west', 'north']);
    expect(players.map((player) => player.isDealer)).toEqual([true, false, false, false]);

    for (const player of players) {
      expect(player.hand).toEqual([]);
      expect(player.flowers).toEqual([]);
      expect(player.discardPile).toEqual([]);
    }
  });

  it('returns fresh player, hand, and flower arrays each time', () => {
    const firstPlayers = createInitialPlayers();
    const secondPlayers = createInitialPlayers();

    expect(firstPlayers).not.toBe(secondPlayers);
    expect(firstPlayers).toEqual(secondPlayers);

    for (let index = 0; index < firstPlayers.length; index += 1) {
      expect(firstPlayers[index]).not.toBe(secondPlayers[index]);
      expect(firstPlayers[index]?.hand).not.toBe(secondPlayers[index]?.hand);
      expect(firstPlayers[index]?.flowers).not.toBe(secondPlayers[index]?.flowers);
      expect(firstPlayers[index]?.discardPile).not.toBe(secondPlayers[index]?.discardPile);
    }
  });
});

describe('Nanjing Mahjong game state and turn advancement', () => {
  it('creates a fresh ready game with initial players, a full wall, and east dealer', () => {
    const firstGame = createInitialGame();
    const secondGame = createInitialGame();

    expect(firstGame).not.toBe(secondGame);
    expect(firstGame.players).not.toBe(secondGame.players);
    expect(firstGame.wall).not.toBe(secondGame.wall);
    expect(firstGame.players).toEqual(createInitialPlayers());
    expect(firstGame.ruleSetId).toBe('nanjing-open');
    expect(firstGame.wall.map((tile) => tile.id)).toEqual(
      createNanjingMahjongDeck().map((tile) => tile.id),
    );
    expect(firstGame.currentPlayerIndex).toBe(0);
    expect(firstGame.dealerIndex).toBe(0);
    expect(firstGame.phase).toBe('ready');
    expect(firstGame.turnStage).toBe('waiting-for-draw');
    expect(firstGame.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'draw',
    });
    expect(firstGame.pendingScoringEvents).toEqual([]);
  });

  it('starts a ready game by dealing complete ordinary opening hands', () => {
    const readyGame = createInitialGame();
    const playingGame = startGame(readyGame);

    expect(playingGame).not.toBe(readyGame);
    expect(playingGame.phase).toBe('playing');
    expect(playingGame.ruleSetId).toBe('nanjing-open');
    expect(playingGame.players.map((player) => player.hand)).not.toEqual(
      readyGame.players.map((player) => player.hand),
    );
    expect(playingGame.players.map((player) => player.hand.length)).toEqual([14, 13, 13, 13]);
    expect(playingGame.players.every((player) => player.hand.every(isOrdinaryHandTile))).toBe(true);
    expect(playingGame.players.every((player) => player.flowers.length === 0)).toBe(true);
    expect(playingGame.wall).toHaveLength(91);
    expect(playingGame.currentPlayerIndex).toBe(0);
    expect(playingGame.dealerIndex).toBe(0);
    expect(playingGame.turnStage).toBe('waiting-for-discard');
    expect(playingGame.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(playingGame.pendingScoringEvents).toEqual([]);
    expect(readyGame.phase).toBe('ready');
    expect(readyGame.players.every((player) => player.hand.length === 0)).toBe(true);
  });

  it('lets the dealer discard first after startGame and opens a reaction window', () => {
    const playingGame = startGame(createGame());
    const dealerTile = playerAt(playingGame, playingGame.dealerIndex).hand[0];

    if (!dealerTile) {
      throw new Error('Expected dealer to have a tile to discard');
    }

    const nextState = applyAction(playingGame, {
      type: 'DISCARD_TILE',
      tileId: dealerTile.id,
    });

    expect(playingGame.turnStage).toBe('waiting-for-discard');
    expect(playingGame.pendingAction.type).toBe('discard');
    expect(tileIds(playerAt(nextState, 0).discardPile)).toEqual([dealerTile.id]);
    expect(nextState.currentPlayerIndex).toBe(1);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'reaction',
    });
    expect(nextState.lastDiscard).toEqual({
      tile: dealerTile,
      tileId: dealerTile.id,
      fromPlayerIndex: 0,
      fromSeat: 'east',
    });
    expect(nextState.reactionWindow).toMatchObject({
      discardedTile: dealerTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      responses: [],
      status: 'open',
    });
  });
  it('moves flowers from the initial deal into the flower area and replaces from the tail', () => {
    const deck = createNanjingMahjongDeck();
    const dealtFlower = flowerTileById(deck, 'flower-red-center-1');
    const replacementTile = ordinaryTileById(deck, 'wind-north-1');
    const leftoverTile = ordinaryTileById(deck, 'wind-north-2');
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => tile.id !== replacementTile.id && tile.id !== leftoverTile.id)
      .slice(0, 52);
    const readyGame = {
      ...createGame(),
      wall: [dealtFlower, ...rawOrdinaryTiles, leftoverTile, replacementTile],
    };
    const playingGame = startGame(readyGame);
    const dealer = playerAt(playingGame, 0);

    expect(tileIds(dealer.flowers)).toEqual(['flower-red-center-1']);
    expect(dealer.hand).toHaveLength(14);
    expect(dealer.hand.every(isOrdinaryHandTile)).toBe(true);
    expect(tileIds(dealer.hand)).toContain('wind-north-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-north-2']);
    expect(playingGame.phase).toBe('playing');
  });

  it('runs initial flower replacement in dealer, next, opposite, upper order', () => {
    const deck = createNanjingMahjongDeck();
    const firstFourRawTiles = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'flower-white-board-1'),
      flowerTileById(deck, 'season-spring-1'),
    ];
    const eastReplacementTile = ordinaryTileById(deck, 'wind-east-1');
    const southReplacementTile = ordinaryTileById(deck, 'wind-south-1');
    const westReplacementTile = ordinaryTileById(deck, 'wind-west-1');
    const northReplacementTile = ordinaryTileById(deck, 'wind-north-1');
    const replacementTiles = [
      eastReplacementTile,
      southReplacementTile,
      westReplacementTile,
      northReplacementTile,
    ];
    const leftoverTile = ordinaryTileById(deck, 'wind-east-2');
    const excludedIds = new Set<TileId>([
      ...replacementTiles.map((tile) => tile.id),
      leftoverTile.id,
    ]);
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => !excludedIds.has(tile.id))
      .slice(0, 49);
    const readyGame = {
      ...createGame(),
      wall: [
        ...firstFourRawTiles,
        ...rawOrdinaryTiles,
        leftoverTile,
        northReplacementTile,
        westReplacementTile,
        southReplacementTile,
        eastReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame);

    expect(tileIds(playerAt(playingGame, 0).hand)).toContain('wind-east-1');
    expect(tileIds(playerAt(playingGame, 1).hand)).toContain('wind-south-1');
    expect(tileIds(playerAt(playingGame, 2).hand)).toContain('wind-west-1');
    expect(tileIds(playerAt(playingGame, 3).hand)).toContain('wind-north-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-east-2']);
  });

  it('runs initial flower replacement from a south dealer in logical seat order', () => {
    const deck = createNanjingMahjongDeck();
    const firstFourRawTiles = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'flower-white-board-1'),
      flowerTileById(deck, 'season-spring-1'),
    ];
    const southReplacementTile = ordinaryTileById(deck, 'wind-south-1');
    const westReplacementTile = ordinaryTileById(deck, 'wind-west-1');
    const northReplacementTile = ordinaryTileById(deck, 'wind-north-1');
    const eastReplacementTile = ordinaryTileById(deck, 'wind-east-1');
    const replacementTiles = [
      southReplacementTile,
      westReplacementTile,
      northReplacementTile,
      eastReplacementTile,
    ];
    const leftoverTile = ordinaryTileById(deck, 'wind-east-2');
    const excludedIds = new Set<TileId>([
      ...replacementTiles.map((tile) => tile.id),
      leftoverTile.id,
    ]);
    const rawOrdinaryTiles = deck
      .filter(isOrdinaryHandTile)
      .filter((tile) => !excludedIds.has(tile.id))
      .slice(0, 49);
    const readyGame = {
      ...createGame(),
      wall: [
        ...firstFourRawTiles,
        ...rawOrdinaryTiles,
        leftoverTile,
        eastReplacementTile,
        northReplacementTile,
        westReplacementTile,
        southReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame, { dealerSeat: 'south' });

    expect(playingGame.dealerIndex).toBe(1);
    expect(playingGame.currentPlayerIndex).toBe(1);
    expect(tileIds(playerAt(playingGame, 1).hand)).toContain('wind-south-1');
    expect(tileIds(playerAt(playingGame, 2).hand)).toContain('wind-west-1');
    expect(tileIds(playerAt(playingGame, 3).hand)).toContain('wind-north-1');
    expect(tileIds(playerAt(playingGame, 0).hand)).toContain('wind-east-1');
    expect(tileIds(playingGame.wall)).toEqual(['wind-east-2']);
  });
  it('keeps east as the default dealer for legacy startGame calls', () => {
    const playingGame = startGame(createGame());

    expect(playingGame.dealerIndex).toBe(0);
    expect(playingGame.currentPlayerIndex).toBe(0);
    expect(playingGame.players.map((player) => player.isDealer)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('supports explicit dealerSeat and dealerIndex options', () => {
    const westDealerGame = startGame(createGame(), { dealerSeat: 'west' });
    const northDealerGame = startGame(createGame(), { dealerIndex: 3 });

    expect(westDealerGame.dealerIndex).toBe(2);
    expect(westDealerGame.currentPlayerIndex).toBe(2);
    expect(westDealerGame.players.map((player) => player.hand.length)).toEqual([13, 13, 14, 13]);
    expect(westDealerGame.players.map((player) => player.isDealer)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(northDealerGame.dealerIndex).toBe(3);
    expect(northDealerGame.currentPlayerIndex).toBe(3);
    expect(northDealerGame.players.map((player) => player.hand.length)).toEqual([13, 13, 13, 14]);
  });

  it('accepts matching dealerSeat and dealerIndex options', () => {
    const playingGame = startGame(createGame(), { dealerSeat: 'west', dealerIndex: 2 });

    expect(playingGame.dealerIndex).toBe(2);
    expect(playingGame.currentPlayerIndex).toBe(2);
    expect(playingGame.players.map((player) => player.isDealer)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('rejects conflicting dealerSeat and dealerIndex options', () => {
    expect(() => startGame(createGame(), { dealerSeat: 'west', dealerIndex: 1 })).toThrow(
      'dealerIndex and dealerSeat must refer to the same player',
    );
  });
  it('records initial flower kong events as pending scoring without changing scores', () => {
    const deck = createNanjingMahjongDeck();
    const redCenters = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-red-center-2'),
      flowerTileById(deck, 'flower-red-center-3'),
      flowerTileById(deck, 'flower-red-center-4'),
    ];
    const ordinaryTiles = deck.filter(isOrdinaryHandTile);
    const rawOrdinaryTiles = [...ordinaryTiles.slice(0, 49)];
    const replacementTiles = ordinaryTiles.slice(49, 53);
    const leftoverTile = ordinaryTiles[53];
    const fallbackOrdinaryTile = ordinaryTiles[0];
    const [
      firstReplacementTile,
      secondReplacementTile,
      thirdReplacementTile,
      fourthReplacementTile,
    ] = replacementTiles;
    const rawTiles: MahjongTile[] = [];
    const redCenterPositions = new Set([0, 4, 8, 12]);

    if (
      !leftoverTile ||
      !fallbackOrdinaryTile ||
      !firstReplacementTile ||
      !secondReplacementTile ||
      !thirdReplacementTile ||
      !fourthReplacementTile
    ) {
      throw new Error('Missing ordinary tiles for flower kong test');
    }

    for (let index = 0; index < 53; index += 1) {
      rawTiles.push(
        redCenterPositions.has(index)
          ? (redCenters.shift() ?? rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile)
          : (rawOrdinaryTiles.shift() ?? fallbackOrdinaryTile),
      );
    }

    const readyGame = {
      ...createGame(),
      wall: [
        ...rawTiles,
        leftoverTile,
        fourthReplacementTile,
        thirdReplacementTile,
        secondReplacementTile,
        firstReplacementTile,
      ],
    };
    const playingGame = startGame(readyGame);

    expect(playingGame.pendingScoringEvents).toEqual([
      {
        type: 'flower-kong-created',
        playerIndex: 0,
        seat: 'east',
        kind: 'red-center',
        createdDuring: 'initial-deal',
        status: 'pending',
      },
    ]);
    expect(tileIds(playerAt(playingGame, 0).flowers)).toEqual([
      'flower-red-center-1',
      'flower-red-center-2',
      'flower-red-center-3',
      'flower-red-center-4',
    ]);
    expect('score' in playerAt(playingGame, 0)).toBe(false);
  });

  it('exposes the engine as the public game state control layer', () => {
    const createOptions: GameCreationOptions = {};
    const startOptions: StartGameOptions = {};
    const legacyOptions: RuleSetOptions = createOptions;
    const createdGame = gameEngine.createGame(legacyOptions);

    expect(createdGame).toEqual(createGame());
    expect(gameEngine.startGame(createdGame, startOptions).phase).toBe('playing');
  });

  it('applies DRAW_TILE through the same engine turn advancement path', () => {
    const state = startGame(createGame());
    const action: GameAction = { type: 'DRAW_TILE' };

    expect(applyAction(state, action)).toEqual(advanceTurn(state));
    expect(gameEngine.applyAction(state, action)).toEqual(advanceTurn(state));
  });

  it('keeps PENG, GANG, and HU as structural placeholders during a reaction window', () => {
    const playingGame = startGame(createGame());
    const dealerTile = playerAt(playingGame, playingGame.dealerIndex).hand[0];

    if (!dealerTile) {
      throw new Error('Expected dealer to have a tile to discard');
    }

    const state = applyAction(playingGame, { type: 'DISCARD_TILE', tileId: dealerTile.id });
    const actions: GameAction[] = [{ type: 'PENG' }, { type: 'GANG' }, { type: 'HU' }];

    for (const action of actions) {
      const nextState = applyAction(state, action);

      expect(nextState).toEqual(state);
      expect(nextState).not.toBe(state);
      expect(nextState.players).not.toBe(state.players);
      expect(nextState.wall).not.toBe(state.wall);
    }
  });

  it('removes a discarded tile, records lastDiscard, and opens a reaction window', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-1-1');
    const keptTile = ordinaryTileById(deck, 'wind-east-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];

    if (!eastPlayer) {
      throw new Error('Missing east player');
    }

    players[0] = {
      ...eastPlayer,
      hand: [discardedTile, keptTile],
    };
    const pendingScoringEvents = [
      {
        type: 'flower-kong-created' as const,
        playerIndex: 0,
        seat: 'east' as const,
        kind: 'red-center' as const,
        createdDuring: 'initial-deal' as const,
        status: 'pending' as const,
      },
    ];
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: {
        playerIndex: 0,
        seat: 'east',
        type: 'discard',
      },
      pendingScoringEvents,
    };
    const action: GameAction = { type: 'DISCARD_TILE', tileId: discardedTile.id };
    const nextState = applyAction(state, action);

    expect(tileIds(playerAt(nextState, 0).hand)).toEqual(['wind-east-1']);
    expect(tileIds(playerAt(nextState, 0).discardPile)).toEqual(['wan-1-1']);
    expect(nextState.lastDiscard).toEqual({
      tile: discardedTile,
      tileId: discardedTile.id,
      fromPlayerIndex: 0,
      fromSeat: 'east',
    });
    expect(nextState.reactionWindow).toEqual({
      discardedTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      availableReactions: [
        { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
        { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
        { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
      ],
      responses: [],
      status: 'open',
    });
    expect(nextState.currentPlayerIndex).toBe(1);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'reaction',
    });
    expect(nextState.pendingScoringEvents).toEqual(pendingScoringEvents);
    expect(nextState).not.toBe(state);
    expect(nextState.players).not.toBe(state.players);
    expect(nextState.wall).not.toBe(state.wall);
    expect(tileIds(playerAt(state, 0).hand)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(playerAt(state, 0).discardPile).toEqual([]);
  });

  it('adds availableReactions in responder order with pass and peng for two matching ordinary tiles', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-3-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for reaction availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [ordinaryTileById(deck, 'wan-3-2'), ordinaryTileById(deck, 'wan-3-3')],
    };
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions).toEqual([
      { playerIndex: 1, seat: 'south', responseTypes: ['pass', 'peng'] },
      { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
      { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
    ] satisfies ReactionAvailability[]);
    expect(
      nextState.reactionWindow?.availableReactions.map((availability) => availability.playerIndex),
    ).toEqual(nextState.reactionWindow?.responderOrder.map((responder) => responder.playerIndex));
    expect(
      nextState.reactionWindow?.availableReactions.every((availability) =>
        availability.responseTypes.includes('pass'),
      ),
    ).toBe(true);
    expect(
      nextState.reactionWindow?.availableReactions.some((availability) =>
        availability.responseTypes.includes('hu'),
      ),
    ).toBe(false);
    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).not.toContain(
      'ming-gang',
    );
  });

  it('offers peng and ming-gang for three matching ordinary tiles without executing either', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'tong-6-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for ming-gang availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [
        ordinaryTileById(deck, 'tong-6-2'),
        ordinaryTileById(deck, 'tong-6-3'),
        ordinaryTileById(deck, 'tong-6-4'),
      ],
    };
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
      'pass',
      'peng',
      'ming-gang',
    ]);
    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).not.toContain('hu');
    expect(playerAt(nextState, 1).hand).toEqual(playerAt(state, 1).hand);
    expect(playerAt(nextState, 1).discardPile).toEqual([]);
    expect('cumulativeScores' in nextState).toBe(false);
  });

  it('treats wind tiles as ordinary tiles for reaction availability', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wind-east-1');
    const players = createInitialPlayers();
    const eastPlayer = players[0];
    const southPlayer = players[1];

    if (!eastPlayer || !southPlayer) {
      throw new Error('Missing players for wind availability test');
    }

    players[0] = { ...eastPlayer, hand: [discardedTile] };
    players[1] = {
      ...southPlayer,
      hand: [
        ordinaryTileById(deck, 'wind-east-2'),
        ordinaryTileById(deck, 'wind-east-3'),
        ordinaryTileById(deck, 'wind-east-4'),
      ],
    };
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
      pendingScoringEvents: [],
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.availableReactions[0]?.responseTypes).toEqual([
      'pass',
      'peng',
      'ming-gang',
    ]);
  });

  it.each([
    'flower-red-center-1',
    'flower-fortune-1',
    'flower-white-board-1',
    'season-spring-1',
  ] as const)('does not expose peng or ming-gang for flower discard %s', (tileId) => {
    const deck = createNanjingMahjongDeck();
    const players = createInitialPlayers();
    const discardedTile = flowerTileById(deck, tileId);
    const reactionWindow: ReactionWindow = {
      discardedTile,
      fromPlayerIndex: 0,
      fromSeat: 'east',
      responderOrder: [
        { playerIndex: 1, seat: 'south' },
        { playerIndex: 2, seat: 'west' },
        { playerIndex: 3, seat: 'north' },
      ],
      availableReactions: [],
      responses: [],
      status: 'open',
    };
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 1,
      dealerIndex: 0,
      phase: 'playing',
      turnStage: 'waiting-for-reaction',
      pendingAction: { playerIndex: 1, seat: 'south', type: 'reaction' },
      reactionWindow,
      pendingScoringEvents: [],
    };

    expect(NANJING_OPEN_RULE_SET.getAvailableReactions(state, reactionWindow)).toEqual([
      { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
      { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
      { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
    ]);
  });

  it('keeps the same player waiting to discard after an ordinary head draw', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
      ordinaryTileById(deck, 'wan-1-3'),
      ordinaryTileById(deck, 'wan-1-4'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const nextState = advanceTurn(state);

    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.players.map((player) => player.seat)).toEqual([
      'east',
      'south',
      'west',
      'north',
    ]);
    expect(nextState.players.map((player) => tileIds(player.hand))).toEqual([
      ['wan-1-1'],
      [],
      [],
      [],
    ]);
    expect(nextState.players.every((player) => player.flowers.length === 0)).toBe(true);
    expect(tileIds(nextState.wall)).toEqual(['wan-1-2', 'wan-1-3', 'wan-1-4', 'wan-2-1']);
    expect(nextState.phase).toBe('playing');
  });

  it('orders responders from a south discard as west, north, east', () => {
    const deck = createNanjingMahjongDeck();
    const discardedTile = ordinaryTileById(deck, 'wan-2-1');
    const players = createInitialPlayers(1);
    const southPlayer = players[1];

    if (!southPlayer) {
      throw new Error('Missing south player');
    }

    players[1] = {
      ...southPlayer,
      hand: [discardedTile],
    };
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 1,
      dealerIndex: 1,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: {
        playerIndex: 1,
        seat: 'south',
        type: 'discard',
      },
      pendingScoringEvents: [],
    };
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(nextState.reactionWindow?.responderOrder).toEqual([
      { playerIndex: 2, seat: 'west' },
      { playerIndex: 3, seat: 'north' },
      { playerIndex: 0, seat: 'east' },
    ]);
    expect(nextState.currentPlayerIndex).toBe(2);
    expect(nextState.pendingAction).toEqual({
      playerIndex: 2,
      seat: 'west',
      type: 'reaction',
    });
  });

  it('records a current responder PASS_REACTION and advances to the next responder', () => {
    const state = createWaitingForReactionState();
    const afterPass = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });

    expect(afterPass.reactionWindow?.responses).toEqual([
      { playerIndex: 1, seat: 'south', type: 'pass' },
    ]);
    expect(afterPass.currentPlayerIndex).toBe(2);
    expect(afterPass.pendingAction).toEqual({
      playerIndex: 2,
      seat: 'west',
      type: 'reaction',
    });
  });

  it('treats SUBMIT_REACTION pass the same as PASS_REACTION', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'pass' }),
    ).toEqual(applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 }));
  });

  it('ignores a non-current responder and a retried pass from the previous responder', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 2, responseType: 'pass' }),
    ).toBe(state);

    const afterPass = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });

    expect(applyAction(afterPass, { type: 'PASS_REACTION', playerIndex: 1 })).toBe(afterPass);
  });

  it.each([
    { playerIndex: -1, actionType: 'SUBMIT_REACTION' as const },
    { playerIndex: 4, actionType: 'PASS_REACTION' as const },
    { playerIndex: 1.5, actionType: 'SUBMIT_REACTION' as const },
  ])(
    'ignores runtime-invalid $actionType playerIndex $playerIndex',
    ({ playerIndex, actionType }) => {
      const state = createWaitingForReactionState();
      const responseCount = state.reactionWindow?.responses.length;
      const pendingAction = state.pendingAction;
      const currentPlayerIndex = state.currentPlayerIndex;
      const action: GameAction =
        actionType === 'PASS_REACTION'
          ? { type: actionType, playerIndex }
          : { type: actionType, playerIndex, responseType: 'pass' };

      const result = applyAction(state, action);

      expect(result).toBe(state);
      expect(result.reactionWindow?.responses).toHaveLength(responseCount ?? 0);
      expect(result.pendingAction).toBe(pendingAction);
      expect(result.currentPlayerIndex).toBe(currentPlayerIndex);
    },
  );
  it('accepts peng but rejects ming-gang with two matching tiles', () => {
    const deck = createNanjingMahjongDeck();
    const players = createInitialPlayers();
    const discardedTile = ordinaryTileById(deck, 'wan-3-1');
    players[0] = {
      ...playerAt({ ...createWaitingForReactionState(), players }, 0),
      hand: [discardedTile],
    };
    players[1] = {
      ...playerAt({ ...createWaitingForReactionState(), players }, 1),
      hand: [ordinaryTileById(deck, 'wan-3-2'), ordinaryTileById(deck, 'wan-3-3')],
    };
    const base: GameState = {
      ...createPlayingGameWithWall([]),
      players,
      turnStage: 'waiting-for-discard',
      pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
    };
    const state = applyAction(base, { type: 'DISCARD_TILE', tileId: discardedTile.id });

    expect(
      applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(state);
    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' })
        .reactionWindow?.responses,
    ).toEqual([{ playerIndex: 1, seat: 'south', type: 'peng' }]);
  });

  it.each(['peng', 'ming-gang'] as const)(
    'accepts %s with three matching tiles without executing the claim',
    (responseType) => {
      const deck = createNanjingMahjongDeck();
      const players = createInitialPlayers();
      const discardedTile = ordinaryTileById(deck, 'tong-6-1');
      const eastPlayer = players[0];
      const southPlayer = players[1];

      if (!eastPlayer || !southPlayer) {
        throw new Error('Missing claim test players');
      }

      players[0] = { ...eastPlayer, hand: [discardedTile] };
      players[1] = {
        ...southPlayer,
        hand: [
          ordinaryTileById(deck, 'tong-6-2'),
          ordinaryTileById(deck, 'tong-6-3'),
          ordinaryTileById(deck, 'tong-6-4'),
        ],
      };
      const pendingScoringEvents: GameState['pendingScoringEvents'] = [
        {
          type: 'flower-kong-created',
          playerIndex: 0,
          seat: 'east',
          kind: 'red-center',
          createdDuring: 'initial-deal',
          status: 'pending',
        },
      ];
      const base: GameState = {
        ...createPlayingGameWithWall([]),
        players,
        turnStage: 'waiting-for-discard',
        pendingAction: { playerIndex: 0, seat: 'east', type: 'discard' },
        pendingScoringEvents,
      };
      const state = applyAction(base, { type: 'DISCARD_TILE', tileId: discardedTile.id });
      const handsBefore = state.players.map((player) => tileIds(player.hand));

      const nextState = applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType,
      });

      expect(nextState.reactionWindow?.responses).toEqual([
        { playerIndex: 1, seat: 'south', type: responseType },
      ]);
      expect(nextState.reactionWindow?.status).toBe('open');
      expect(nextState.currentPlayerIndex).toBe(2);
      expect(nextState.pendingAction).toEqual({
        playerIndex: 2,
        seat: 'west',
        type: 'reaction',
      });
      expect(nextState.players.map((player) => tileIds(player.hand))).toEqual(handsBefore);
      expect(nextState.players.every((player) => player.melds.length === 0)).toBe(true);
      expect(nextState.pendingScoringEvents).toEqual(pendingScoringEvents);
      expect('cumulativeScores' in nextState).toBe(false);
      expect(
        applyAction(nextState, {
          type: 'SUBMIT_REACTION',
          playerIndex: 1,
          responseType: 'pass',
        }),
      ).toBe(nextState);

      const afterSecondResponse = applyAction(nextState, {
        type: 'PASS_REACTION',
        playerIndex: 2,
      });
      const afterThirdResponse = applyAction(afterSecondResponse, {
        type: 'PASS_REACTION',
        playerIndex: 3,
      });

      expect(afterThirdResponse.reactionWindow?.status).toBe('awaiting-resolution');
      expect(afterThirdResponse.pendingAction.type).toBe('none');
      expect(afterThirdResponse.players.map((player) => player.melds)).toEqual(
        state.players.map((player) => player.melds),
      );
      expect(applyAction(afterThirdResponse, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(
        afterThirdResponse,
      );
    },
  );

  it.each([
    'flower-red-center-1',
    'flower-fortune-1',
    'flower-white-board-1',
    'season-spring-1',
  ] as const)('rejects peng and ming-gang for flower discard %s', (tileId) => {
    const deck = createNanjingMahjongDeck();
    const base = createWaitingForReactionState();
    const state: GameState = {
      ...base,
      reactionWindow: {
        ...base.reactionWindow!,
        discardedTile: flowerTileById(deck, tileId),
        availableReactions: [
          { playerIndex: 1, seat: 'south', responseTypes: ['pass'] },
          { playerIndex: 2, seat: 'west', responseTypes: ['pass'] },
          { playerIndex: 3, seat: 'north', responseTypes: ['pass'] },
        ],
      },
    };

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'peng' }),
    ).toBe(state);
    expect(
      applyAction(state, {
        type: 'SUBMIT_REACTION',
        playerIndex: 1,
        responseType: 'ming-gang',
      }),
    ).toBe(state);
  });

  it('rejects hu because it is absent from availableReactions', () => {
    const state = createWaitingForReactionState();

    expect(
      applyAction(state, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType: 'hu' }),
    ).toBe(state);
  });

  it('ignores submissions with no window, a closed window, or a non-reaction state', () => {
    const noWindow = createPlayingGameWithWall([]);
    const open = createWaitingForReactionState();
    const closed: GameState = {
      ...open,
      reactionWindow: { ...open.reactionWindow!, status: 'closed' },
    };
    const notReaction: GameState = {
      ...open,
      turnStage: 'waiting-for-draw',
    };
    const action = {
      type: 'SUBMIT_REACTION' as const,
      playerIndex: 1,
      responseType: 'pass' as const,
    };

    expect(applyAction(noWindow, action)).toBe(noWindow);
    expect(applyAction(closed, action)).toBe(closed);
    expect(applyAction(notReaction, action)).toBe(notReaction);
  });
  it('ignores DISCARD_TILE while waiting for a reaction response', () => {
    const state = createWaitingForReactionState();
    const nextState = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-2' });

    expect(nextState).toEqual(state);
    expect(nextState.turnStage).toBe('waiting-for-reaction');
    expect(nextState.pendingAction.type).toBe('reaction');
  });
  it('awaits resolution after three passes, then resolves to the discarder next player draw', () => {
    const deck = createNanjingMahjongDeck();
    let state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-2-1'),
      ordinaryTileById(deck, 'wan-2-2'),
    ]);

    state = advanceTurn(state);
    state = applyAction(state, { type: 'DISCARD_TILE', tileId: 'wan-2-1' });
    const drawDuringReaction = advanceTurn(state);
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 1 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 2 });
    state = applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 });

    const awaitingResolution = state;

    expect(applyAction(drawDuringReaction, { type: 'DRAW_TILE' })).toEqual(drawDuringReaction);
    expect(state.reactionWindow?.responses).toEqual([
      { playerIndex: 1, seat: 'south', type: 'pass' },
      { playerIndex: 2, seat: 'west', type: 'pass' },
      { playerIndex: 3, seat: 'north', type: 'pass' },
    ]);
    expect(state.reactionWindow?.status).toBe('awaiting-resolution');
    expect(state.currentPlayerIndex).toBe(3);
    expect(state.turnStage).toBe('waiting-for-reaction');
    expect(state.pendingAction).toEqual({ playerIndex: null, seat: null, type: 'none' });
    expect(applyAction(state, { type: 'PASS_REACTION', playerIndex: 3 })).toBe(state);
    expect(applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' })).not.toBe(state);

    state = applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' });

    expect(state.reactionWindow?.status).toBe('closed');
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.turnStage).toBe('waiting-for-draw');
    expect(state.pendingAction).toEqual({
      playerIndex: 1,
      seat: 'south',
      type: 'draw',
    });
    expect(state.reactionWindow?.responses).toEqual(awaitingResolution.reactionWindow?.responses);
    expect(state.lastDiscard).toEqual(awaitingResolution.lastDiscard);
    expect(applyAction(state, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(state);
    expect(state.players.map((player) => tileIds(player.hand))).toEqual([[], [], [], []]);
    expect(tileIds(playerAt(state, 0).discardPile)).toEqual(['wan-2-1']);
  });

  it('ignores early resolution and draw or discard while awaiting reaction resolution', () => {
    const open = createWaitingForReactionState();

    expect(applyAction(open, { type: 'RESOLVE_REACTION_WINDOW' })).toBe(open);

    let awaiting = applyAction(open, { type: 'PASS_REACTION', playerIndex: 1 });
    awaiting = applyAction(awaiting, { type: 'PASS_REACTION', playerIndex: 2 });
    awaiting = applyAction(awaiting, { type: 'PASS_REACTION', playerIndex: 3 });

    expect(applyAction(awaiting, { type: 'DRAW_TILE' })).toBe(awaiting);
    expect(applyAction(awaiting, { type: 'DISCARD_TILE', tileId: 'wan-2-2' })).toBe(awaiting);
  });

  it('ignores draw actions until the pending player is waiting to draw', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
    ]);
    const waitingForDiscard = advanceTurn(state);
    const afterSecondDrawIntent = advanceTurn(waitingForDiscard);

    expect(afterSecondDrawIntent).toBe(waitingForDiscard);
  });

  it('moves a drawn flower to the flower area, draws one replacement from the tail, and waits for discard', () => {
    const deck = createNanjingMahjongDeck();
    const initialState = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const nextState = advanceTurn(initialState);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1']);
    expect(tileIds(currentPlayer.hand)).toEqual(['wan-2-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
    expect(playerAt(initialState, 0).hand).toEqual([]);
    expect(playerAt(initialState, 0).flowers).toEqual([]);
    expect(tileIds(initialState.wall)).toEqual(['flower-red-center-1', 'tiao-2-1', 'wan-2-1']);
  });

  it('keeps replacing when a tail replacement is also a flower', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1', 'season-summer-1']);
    expect(tileIds(currentPlayer.hand)).toEqual(['tong-3-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
  });

  it('records consecutive tail flowers before the ordinary replacement tile', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(tileIds(currentPlayer.flowers)).toEqual([
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(tileIds(currentPlayer.hand)).toEqual(['tong-3-1']);
    expect(tileIds(nextState.wall)).toEqual(['tiao-2-1']);
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.turnStage).toBe('waiting-for-discard');
    expect(nextState.pendingAction).toEqual({
      playerIndex: 0,
      seat: 'east',
      type: 'discard',
    });
    expect(nextState.phase).toBe('playing');
  });

  it('ends the game when the wall cannot provide a legal draw or replacement', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const nextState = advanceTurn(state);
    const currentPlayer = playerAt(nextState, 0);

    expect(nextState.phase).toBe('ended');
    expect(nextState.turnStage).toBe('hand-ended');
    expect(nextState.pendingAction).toEqual({
      playerIndex: null,
      seat: null,
      type: 'none',
    });
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.wall).toEqual([]);
    expect(currentPlayer.hand).toEqual([]);
    expect(tileIds(currentPlayer.flowers)).toEqual(['flower-red-center-1', 'flower-fortune-1']);
  });

  it('ends the game when the final ordinary head draw exhausts the wall', () => {
    const deck = createNanjingMahjongDeck();
    const state = createPlayingGameWithWall([ordinaryTileById(deck, 'wan-1-1')]);

    const nextState = advanceTurn(state);

    expect(nextState.phase).toBe('ended');
    expect(nextState.turnStage).toBe('hand-ended');
    expect(nextState.pendingAction).toEqual({
      playerIndex: null,
      seat: null,
      type: 'none',
    });
    expect(nextState.currentPlayerIndex).toBe(0);
    expect(nextState.wall).toEqual([]);
    expect(tileIds(playerAt(nextState, 0).hand)).toEqual(['wan-1-1']);
    expect(playerAt(state, 0).hand).toEqual([]);
    expect(tileIds(state.wall)).toEqual(['wan-1-1']);
  });
});
describe('Nanjing Mahjong tile deck', () => {
  it('creates the complete 144-tile deck with stable unique ids', () => {
    const deck = createNanjingMahjongDeck();
    const ids = deck.map((tile) => tile.id);

    expect(deck).toHaveLength(144);
    expect(new Set(ids).size).toBe(144);
    expect(ids.slice(0, 4)).toEqual(['wan-1-1', 'wan-1-2', 'wan-1-3', 'wan-1-4']);
    expect(ids.at(-1)).toBe('season-winter-1');
  });

  it('returns a fresh deck array with stable tile contents and fresh tile objects each time', () => {
    const firstDeck = createNanjingMahjongDeck();
    const secondDeck = createNanjingMahjongDeck();

    expect(firstDeck).not.toBe(secondDeck);
    expect(firstDeck).toEqual(secondDeck);

    for (let index = 0; index < firstDeck.length; index += 1) {
      expect(firstDeck[index]).not.toBe(secondDeck[index]);
    }
  });

  it('keeps generated deck order independent from mutations to previous returned arrays', () => {
    const firstDeck = createNanjingMahjongDeck();
    const secondDeck = createNanjingMahjongDeck();
    const stableIds = secondDeck.map((tile) => tile.id);

    firstDeck.pop();
    firstDeck.reverse();
    firstDeck.splice(0, 3);

    expect(secondDeck).toHaveLength(144);
    expect(secondDeck.map((tile) => tile.id)).toEqual(stableIds);

    const freshDeck = createNanjingMahjongDeck();

    expect(freshDeck).toHaveLength(144);
    expect(freshDeck.map((tile) => tile.id)).toEqual(stableIds);
    expect(freshDeck.slice(0, 4).map((tile) => tile.id)).toEqual([
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-1-4',
    ]);
    expect(freshDeck.at(-1)?.id).toBe('season-winter-1');
  });

  it('contains four copies of every suited number tile', () => {
    const deck = createNanjingMahjongDeck();
    const numberTiles = deck.filter(isNumberTile);

    expect(numberTiles).toHaveLength(108);

    for (const suit of NUMBER_TILE_SUITS) {
      for (let rank = 1; rank <= 9; rank += 1) {
        const copies = numberTiles.filter((tile) => tile.suit === suit && tile.rank === rank);

        expect(copies.map((tile) => tile.copy)).toEqual([1, 2, 3, 4]);
        expect(copies.map((tile) => tile.id)).toEqual([
          `${suit}-${rank}-1`,
          `${suit}-${rank}-2`,
          `${suit}-${rank}-3`,
          `${suit}-${rank}-4`,
        ]);
      }
    }
  });

  it('contains four copies of every wind tile', () => {
    const deck = createNanjingMahjongDeck();
    const windTiles = deck.filter(isWindTile);

    expect(windTiles).toHaveLength(16);

    for (const wind of WIND_TILE_KINDS) {
      const copies = windTiles.filter((tile) => tile.wind === wind);

      expect(copies.map((tile) => tile.copy)).toEqual([1, 2, 3, 4]);
      expect(copies.map((tile) => tile.id)).toEqual([
        `wind-${wind}-1`,
        `wind-${wind}-2`,
        `wind-${wind}-3`,
        `wind-${wind}-4`,
      ]);
    }
  });

  it('contains exactly 124 ordinary hand tiles split into 108 number tiles and 16 wind tiles', () => {
    const deck = createNanjingMahjongDeck();
    const ordinaryHandTiles = deck.filter(isOrdinaryHandTile);

    expect(ordinaryHandTiles).toHaveLength(124);
    expect(ordinaryHandTiles.filter(isNumberTile)).toHaveLength(108);
    expect(ordinaryHandTiles.filter(isWindTile)).toHaveLength(16);
    expect(ordinaryHandTiles.every(isOrdinaryHandTile)).toBe(true);
    expect(ordinaryHandTiles.every((tile) => !requiresFlowerReveal(tile))).toBe(true);
  });

  it('models red center, fortune, white board, plants, and seasons as flower tiles', () => {
    const deck = createNanjingMahjongDeck();
    const flowerTiles = deck.filter(isFlowerTile);

    expect(flowerTiles).toHaveLength(20);

    for (const flower of FLOWER_TILE_KINDS) {
      const copies = flowerTiles.filter((tile) => tile.flower === flower);
      const expectedCopies =
        flower === 'red-center' || flower === 'fortune' || flower === 'white-board' ? 4 : 1;

      expect(copies).toHaveLength(expectedCopies);
      expect(copies.every(requiresFlowerReveal)).toBe(true);
      expect(copies.every(isOrdinaryHandTile)).toBe(false);
    }

    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-red-center-1');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-fortune-4');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-white-board-4');
    expect(flowerTiles.map((tile) => tile.id)).toContain('flower-plum-1');
    expect(flowerTiles.map((tile) => tile.id)).toContain('season-spring-1');
  });

  it('classifies all 20 flower tiles as reveal-only non-hand tiles', () => {
    const deck = createNanjingMahjongDeck();
    const flowerTiles = deck.filter(isFlowerTile);

    expect(flowerTiles).toHaveLength(20);
    expect(flowerTiles.every(isFlowerTile)).toBe(true);
    expect(flowerTiles.every(isOrdinaryHandTile)).toBe(false);
    expect(flowerTiles.every(requiresFlowerReveal)).toBe(true);
  });

  it('distinguishes ordinary hand tiles from tiles that must be revealed for flower replacement', () => {
    const deck = createNanjingMahjongDeck();
    const [wanOne] = deck.filter((tile) => tile.id === 'wan-1-1');
    const [eastWind] = deck.filter((tile) => tile.id === 'wind-east-1');
    const [redCenter] = deck.filter((tile) => tile.id === 'flower-red-center-1');

    expect(wanOne).toBeDefined();
    expect(eastWind).toBeDefined();
    expect(redCenter).toBeDefined();

    expect(wanOne && isOrdinaryHandTile(wanOne)).toBe(true);
    expect(eastWind && isOrdinaryHandTile(eastWind)).toBe(true);
    expect(redCenter && isOrdinaryHandTile(redCenter)).toBe(false);

    expect(wanOne && requiresFlowerReveal(wanOne)).toBe(false);
    expect(eastWind && requiresFlowerReveal(eastWind)).toBe(false);
    expect(redCenter && requiresFlowerReveal(redCenter)).toBe(true);
  });

  it('places every tile in exactly one primary tile category', () => {
    const deck = createNanjingMahjongDeck();

    expect(deck).toHaveLength(144);

    for (const tile of deck) {
      const matchingCategories = [isNumberTile(tile), isWindTile(tile), isFlowerTile(tile)].filter(
        Boolean,
      );

      expect(matchingCategories).toHaveLength(1);
    }
  });
});
describe('Nanjing Mahjong tile wall and flower replacement', () => {
  it('creates a 144-tile wall from the current fixed deck order without shuffling', () => {
    const deck = createNanjingMahjongDeck();
    const wall = createNanjingMahjongTileWall();

    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(deck.map((tile) => tile.id));
    expect(wall.tiles).not.toBe(deck);
  });

  it('creates fresh wall objects and tile arrays from the same tile sequence', () => {
    const deck = createNanjingMahjongDeck();
    const tiles = [ordinaryTileById(deck, 'wan-1-1'), flowerTileById(deck, 'season-spring-1')];
    const firstWall = createTileWall(tiles);
    const secondWall = createTileWall(tiles);

    expect(firstWall).not.toBe(secondWall);
    expect(firstWall.tiles).not.toBe(secondWall.tiles);
    expect(firstWall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'season-spring-1']);
    expect(secondWall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'season-spring-1']);
  });

  it('keeps a created wall independent from later mutations to the source tile array', () => {
    const deck = createNanjingMahjongDeck();
    const sourceTiles: MahjongTile[] = [
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wind-east-1'),
    ];
    const wall = createTileWall(sourceTiles);

    sourceTiles.reverse();
    sourceTiles.pop();
    sourceTiles.push(flowerTileById(deck, 'flower-red-center-1'));

    expect(sourceTiles.map((tile) => tile.id)).toEqual(['wind-east-1', 'flower-red-center-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
  });

  it('draws a normal tile from the head of the wall without mutating the input wall', () => {
    const wall = createNanjingMahjongTileWall();
    const result = drawTileFromWallHead(wall);

    expect(result.status).toBe('drawn');

    if (result.status !== 'drawn') {
      throw new Error('Expected a head draw to succeed');
    }

    expect(result.tile.id).toBe('wan-1-1');
    expect(result.wall.tiles).toHaveLength(143);
    expect(result.wall.tiles[0]?.id).toBe('wan-1-2');
    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles[0]?.id).toBe('wan-1-1');
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('draws a replacement tile from the tail of the wall without mutating the input wall', () => {
    const wall = createNanjingMahjongTileWall();
    const result = drawTileFromWallTail(wall);

    expect(result.status).toBe('drawn');

    if (result.status !== 'drawn') {
      throw new Error('Expected a tail draw to succeed');
    }

    expect(result.tile.id).toBe('season-winter-1');
    expect(result.wall.tiles).toHaveLength(143);
    expect(result.wall.tiles.at(-1)?.id).toBe('season-autumn-1');
    expect(wall.tiles).toHaveLength(144);
    expect(wall.tiles.at(-1)?.id).toBe('season-winter-1');
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('returns a clear exhausted result when drawing from an empty wall', () => {
    const wall = createTileWall([]);
    const headResult = drawTileFromWallHead(wall);
    const tailResult = drawTileFromWallTail(wall);

    expect(headResult.status).toBe('wall-exhausted');
    expect(tailResult.status).toBe('wall-exhausted');
    expect(headResult.wall.tiles).toEqual([]);
    expect(tailResult.wall.tiles).toEqual([]);
    expect(headResult.wall).not.toBe(wall);
    expect(tailResult.wall).not.toBe(wall);
    expect(headResult.wall.tiles).not.toBe(wall.tiles);
    expect(tailResult.wall.tiles).not.toBe(wall.tiles);
  });

  it('does not draw from the tail when an initial hand has no flowers', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [ordinaryTileById(deck, 'wan-1-1'), ordinaryTileById(deck, 'wind-east-1')];
    const existingFlowers = [flowerTileById(deck, 'season-spring-1')];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: existingFlowers,
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(result.newlyRevealedFlowers).toEqual([]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.wall.tiles).toHaveLength(2);
    expect(initialHand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(existingFlowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
  });

  it('replaces two initial flowers and records replacement and tail flower order', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'wind-east-1'),
      flowerTileById(deck, 'flower-white-board-1'),
    ];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
      flowerTileById(deck, 'flower-fortune-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wind-east-1', 'wan-2-1', 'tong-3-1']);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.newlyRevealedFlowers.slice(2).map((tile) => tile.id)).toEqual([
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1', 'tong-3-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual([
      'tiao-2-1',
      'tong-3-1',
      'season-summer-1',
      'flower-fortune-1',
      'wan-2-1',
    ]);
  });

  it('reveals flowers from one player hand and keeps drawing from the tail until ordinary tiles replace them', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      ordinaryTileById(deck, 'wan-1-1'),
      flowerTileById(deck, 'flower-red-center-1'),
      ordinaryTileById(deck, 'wind-east-1'),
    ];
    const existingFlowers = [flowerTileById(deck, 'season-spring-1')];
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: existingFlowers,
    });

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1', 'tiao-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(result.wall.tiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual([
      'wan-1-1',
      'flower-red-center-1',
      'wind-east-1',
    ]);
    expect(existingFlowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.hand).not.toBe(initialHand);
    expect(result.flowers).not.toBe(existingFlowers);
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
  });

  it('fails flower replacement with an exhausted result when the final available replacement tile is also a flower', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [flowerTileById(deck, 'flower-red-center-1')];
    const wall = createTileWall([flowerTileById(deck, 'flower-fortune-1')]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand).toEqual([]);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.wall.tiles).toEqual([]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual(['flower-red-center-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1']);
  });

  it('keeps partial initial flower replacement records when the wall exhausts after a normal replacement', () => {
    const deck = createNanjingMahjongDeck();
    const initialHand = [
      flowerTileById(deck, 'flower-red-center-1'),
      flowerTileById(deck, 'flower-white-board-1'),
    ];
    const wall = createTileWall([
      flowerTileById(deck, 'flower-fortune-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = replaceFlowersForSinglePlayer({
      wall,
      hand: initialHand,
      flowers: [],
    });

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.wall.tiles).toEqual([]);
    expect(initialHand.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-white-board-1',
    ]);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1', 'wan-2-1']);
  });

  it('adds a single drawn ordinary tile to the hand without consuming the wall', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = ordinaryTileById(deck, 'wind-east-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(result.newlyRevealedFlowers).toEqual([]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
    expect(result.wall).not.toBe(wall);
    expect(result.wall.tiles).not.toBe(wall.tiles);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'flower-fortune-1']);
  });

  it('reveals a single drawn flower and replaces it with a tail ordinary tile', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'wan-2-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual(['flower-red-center-1']);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['wan-2-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1', 'wan-2-1']);
  });

  it('continues revealing tail flowers after a drawn flower until a normal replacement tile appears', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      ordinaryTileById(deck, 'tiao-2-1'),
      ordinaryTileById(deck, 'tong-3-1'),
      flowerTileById(deck, 'season-summer-1'),
      flowerTileById(deck, 'flower-fortune-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('complete');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1', 'tong-3-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'flower-fortune-1',
      'season-summer-1',
    ]);
    expect(result.replacementTiles.map((tile) => tile.id)).toEqual(['tong-3-1']);
    expect(result.wall.tiles.map((tile) => tile.id)).toEqual(['tiao-2-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual([
      'tiao-2-1',
      'tong-3-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
  });

  it('returns wall-exhausted after a drawn flower when only tail flowers remain', () => {
    const deck = createNanjingMahjongDeck();
    const hand = [ordinaryTileById(deck, 'wan-1-1')];
    const flowers = [flowerTileById(deck, 'season-spring-1')];
    const drawnTile = flowerTileById(deck, 'flower-red-center-1');
    const wall = createTileWall([
      flowerTileById(deck, 'flower-fortune-1'),
      flowerTileById(deck, 'season-summer-1'),
    ]);

    const result = resolveDrawnTileWithFlowerReplacement(hand, flowers, drawnTile, wall);

    expect(result.status).toBe('wall-exhausted');
    expect(result.hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(result.flowers.map((tile) => tile.id)).toEqual([
      'season-spring-1',
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(result.newlyRevealedFlowers.map((tile) => tile.id)).toEqual([
      'flower-red-center-1',
      'season-summer-1',
      'flower-fortune-1',
    ]);
    expect(result.replacementTiles).toEqual([]);
    expect(result.wall.tiles).toEqual([]);
    expect(hand.map((tile) => tile.id)).toEqual(['wan-1-1']);
    expect(flowers.map((tile) => tile.id)).toEqual(['season-spring-1']);
    expect(wall.tiles.map((tile) => tile.id)).toEqual(['flower-fortune-1', 'season-summer-1']);
  });
});
