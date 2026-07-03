import { describe, expect, it } from 'vitest';
import {
  FLOWER_TILE_KINDS,
  NUMBER_TILE_SUITS,
  WIND_TILE_KINDS,
  createNanjingMahjongDeck,
  isFlowerTile,
  isNumberTile,
  isOrdinaryHandTile,
  isWindTile,
  requiresFlowerReveal,
} from '../src';

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
