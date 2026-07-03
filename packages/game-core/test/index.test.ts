import { describe, expect, it } from 'vitest';
import {
  FLOWER_TILE_KINDS,
  NUMBER_TILE_SUITS,
  WIND_TILE_KINDS,
  createNanjingMahjongDeck,
  createNanjingMahjongTileWall,
  createTileWall,
  drawTileFromWallHead,
  drawTileFromWallTail,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  replaceFlowersForSinglePlayer,
  resolveDrawnTileWithFlowerReplacement,
  requiresFlowerReveal,
} from '../src';
import type { FlowerTile, MahjongTile, OrdinaryHandTile, TileId } from '../src';

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
