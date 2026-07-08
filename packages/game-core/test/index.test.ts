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
  createGame,
  createNanjingMahjongDeck,
  createNanjingMahjongTileWall,
  createTileWall,
  drawTileFromWallHead,
  drawTileFromWallTail,
  gameEngine,
  getRuleSet,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  listRuleSets,
  replaceFlowersForSinglePlayer,
  resolveDrawnTileWithFlowerReplacement,
  requiresFlowerReveal,
  startGame,
} from '../src';
import type {
  FlowerTile,
  GameCreationOptions,
  GameAction,
  GameState,
  MahjongTile,
  OrdinaryHandTile,
  PlayerState,
  RuleSetOptions,
  StartGameOptions,
  TileId,
} from '../src';

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
  return {
    ruleSetId: DEFAULT_RULE_SET_ID,
    players: createInitialPlayers(),
    wall: [...wall],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    phase: 'playing',
    pendingScoringEvents: [],
  };
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
    expect(listRuleSets()).toEqual([NANJING_OPEN_RULE_SET]);
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
    expect(playingGame.pendingScoringEvents).toEqual([]);
    expect(readyGame.phase).toBe('ready');
    expect(readyGame.players.every((player) => player.hand.length === 0)).toBe(true);
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

  it('keeps reaction actions as structural placeholders without mutating state', () => {
    const state = startGame(createGame());
    const actions: GameAction[] = [{ type: 'PENG' }, { type: 'GANG' }, { type: 'HU' }];

    for (const action of actions) {
      const nextState = applyAction(state, action);

      expect(nextState).toEqual(state);
      expect(nextState).not.toBe(state);
      expect(nextState.players).not.toBe(state.players);
      expect(nextState.wall).not.toBe(state.wall);
    }
  });

  it('removes a discarded tile from the current player hand, records it, and rotates', () => {
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
    const state: GameState = {
      ruleSetId: DEFAULT_RULE_SET_ID,
      players,
      wall: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      phase: 'playing',
      pendingScoringEvents: [],
    };
    const action: GameAction = { type: 'DISCARD_TILE', tileId: discardedTile.id };
    const nextState = applyAction(state, action);

    expect(tileIds(playerAt(nextState, 0).hand)).toEqual(['wind-east-1']);
    expect(tileIds(playerAt(nextState, 0).discardPile)).toEqual(['wan-1-1']);
    expect(nextState.currentPlayerIndex).toBe(1);
    expect(nextState).not.toBe(state);
    expect(nextState.players).not.toBe(state.players);
    expect(nextState.wall).not.toBe(state.wall);
    expect(tileIds(playerAt(state, 0).hand)).toEqual(['wan-1-1', 'wind-east-1']);
    expect(playerAt(state, 0).discardPile).toEqual([]);
  });

  it('rotates four players after ordinary head draws', () => {
    const deck = createNanjingMahjongDeck();
    let state = createPlayingGameWithWall([
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
      ordinaryTileById(deck, 'wan-1-3'),
      ordinaryTileById(deck, 'wan-1-4'),
      ordinaryTileById(deck, 'wan-2-1'),
    ]);

    state = advanceTurn(state);
    expect(state.currentPlayerIndex).toBe(1);

    state = advanceTurn(state);
    expect(state.currentPlayerIndex).toBe(2);

    state = advanceTurn(state);
    expect(state.currentPlayerIndex).toBe(3);

    state = advanceTurn(state);
    expect(state.currentPlayerIndex).toBe(0);

    expect(state.players.map((player) => player.seat)).toEqual(['east', 'south', 'west', 'north']);
    expect(state.players.map((player) => tileIds(player.hand))).toEqual([
      ['wan-1-1'],
      ['wan-1-2'],
      ['wan-1-3'],
      ['wan-1-4'],
    ]);
    expect(state.players.every((player) => player.flowers.length === 0)).toBe(true);
    expect(tileIds(state.wall)).toEqual(['wan-2-1']);
    expect(state.phase).toBe('playing');
  });

  it('continues draw actions through repeated four-player cycles', () => {
    const deck = createNanjingMahjongDeck();
    const wall = [
      ordinaryTileById(deck, 'wan-1-1'),
      ordinaryTileById(deck, 'wan-1-2'),
      ordinaryTileById(deck, 'wan-1-3'),
      ordinaryTileById(deck, 'wan-1-4'),
      ordinaryTileById(deck, 'wan-2-1'),
      ordinaryTileById(deck, 'wan-2-2'),
      ordinaryTileById(deck, 'wan-2-3'),
      ordinaryTileById(deck, 'wan-2-4'),
    ];
    let state = createPlayingGameWithWall(wall);
    const currentPlayerIndexes: number[] = [];

    for (let drawCount = 0; drawCount < wall.length; drawCount += 1) {
      state = advanceTurn(state);
      currentPlayerIndexes.push(state.currentPlayerIndex);
    }

    expect(currentPlayerIndexes).toEqual([1, 2, 3, 0, 1, 2, 3, 0]);
    expect(state.players.map((player) => tileIds(player.hand))).toEqual([
      ['wan-1-1', 'wan-2-1'],
      ['wan-1-2', 'wan-2-2'],
      ['wan-1-3', 'wan-2-3'],
      ['wan-1-4', 'wan-2-4'],
    ]);
    expect(state.wall).toEqual([]);
    expect(state.phase).toBe('ended');
  });

  it('moves a drawn flower to the flower area, draws one replacement from the tail, and advances', () => {
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
    expect(nextState.currentPlayerIndex).toBe(1);
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
    expect(nextState.currentPlayerIndex).toBe(1);
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
    expect(nextState.currentPlayerIndex).toBe(1);
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
    expect(nextState.currentPlayerIndex).toBe(1);
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
