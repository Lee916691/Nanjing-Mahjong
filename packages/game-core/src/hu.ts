import type { Meld } from './meld';
import { FOUR_COPY_INDEXES, NUMBER_TILE_RANKS, NUMBER_TILE_SUITS, WIND_TILE_KINDS } from './state';
import type { OrdinaryHandTile, OrdinaryTileFace, SelfDrawSource } from './state';
import type { HandResult, HuEvaluation, HuPattern, PendingHuScoringEvent } from './state';

export interface HuStructureInput {
  readonly concealedTiles: readonly OrdinaryHandTile[];
  readonly winningTile: OrdinaryHandTile;
  readonly melds: readonly Meld[];
}

export interface HuSequence {
  readonly type: 'sequence';
  readonly tiles: readonly [OrdinaryTileFace, OrdinaryTileFace, OrdinaryTileFace];
}

export interface HuTriplet {
  readonly type: 'triplet';
  readonly tileFace: OrdinaryTileFace;
}

export type HuConcealedMeld = HuSequence | HuTriplet;

export interface StandardHuStructure {
  readonly type: 'standard';
  readonly existingMeldCount: number;
  readonly pair: OrdinaryTileFace;
  readonly concealedMelds: readonly HuConcealedMeld[];
}

export interface SevenPairsHuStructure {
  readonly type: 'seven-pairs';
  readonly pairs: readonly OrdinaryTileFace[];
}

export interface DragonSevenPairsHuStructure {
  readonly type: 'dragon-seven-pairs';
  readonly pairs: readonly OrdinaryTileFace[];
  readonly dragon: OrdinaryTileFace;
}

export type HuStructure = StandardHuStructure | SevenPairsHuStructure | DragonSevenPairsHuStructure;

const FACE_KEYS = [
  ...NUMBER_TILE_SUITS.flatMap((suit) => NUMBER_TILE_RANKS.map((rank) => `${suit}-${rank}`)),
  ...WIND_TILE_KINDS.map((wind) => `wind-${wind}`),
] as const;

export function evaluateHuStructure(input: HuStructureInput): HuStructure | null {
  if (!isValidInput(input)) return null;

  const allConcealedTiles = [...input.concealedTiles, input.winningTile];
  const counts = countFaces(allConcealedTiles);

  if (input.melds.length === 0 && allConcealedTiles.length === 14) {
    const pairs = sevenPairs(counts);
    if (pairs) {
      const winningKey = faceKey(input.winningTile);
      if (
        (counts.get(winningKey) ?? 0) === 4 &&
        countFace(input.concealedTiles, winningKey) === 3
      ) {
        return { type: 'dragon-seven-pairs', pairs, dragon: faceFromKey(winningKey) };
      }
      return { type: 'seven-pairs', pairs };
    }
  }

  const requiredConcealedMelds = 4 - input.melds.length;
  if (requiredConcealedMelds < 0 || allConcealedTiles.length !== requiredConcealedMelds * 3 + 2) {
    return null;
  }

  for (const pairKey of FACE_KEYS) {
    if ((counts.get(pairKey) ?? 0) < 2) continue;
    const remaining = new Map(counts);
    remaining.set(pairKey, (remaining.get(pairKey) ?? 0) - 2);
    const concealedMelds = decomposeMelds(remaining);
    if (concealedMelds && concealedMelds.length === requiredConcealedMelds) {
      return {
        type: 'standard',
        existingMeldCount: input.melds.length,
        pair: faceFromKey(pairKey),
        concealedMelds,
      };
    }
  }

  return null;
}

function isValidInput(input: HuStructureInput): boolean {
  if (
    !isRecord(input) ||
    !Array.isArray(input.concealedTiles) ||
    !Array.isArray(input.melds) ||
    !input.concealedTiles.every(isValidOrdinaryHandTile) ||
    !isValidOrdinaryHandTile(input.winningTile) ||
    input.melds.length > 4 ||
    !input.melds.every(isValidMeld)
  ) {
    return false;
  }

  const allTiles = [
    ...input.concealedTiles,
    input.winningTile,
    ...input.melds.flatMap((meld) => meld.tiles),
  ];
  if (new Set(input.melds.map((meld) => meld.id)).size !== input.melds.length) return false;
  if (new Set(allTiles.map((tile) => tile.id)).size !== allTiles.length) return false;
  return [...countFaces(allTiles).values()].every((count) => count <= 4);
}

export function isValidMeld(meld: Meld): boolean {
  if (
    !meld ||
    typeof meld.id !== 'string' ||
    meld.id.trim().length === 0 ||
    !Array.isArray(meld.tiles) ||
    !meld.tiles.every(isValidOrdinaryHandTile)
  ) {
    return false;
  }
  if (
    meld.type !== 'peng' &&
    meld.type !== 'ming-gang' &&
    meld.type !== 'an-gang' &&
    meld.type !== 'bu-gang'
  ) {
    return false;
  }
  const requiredTileCount = meld.type === 'peng' ? 3 : 4;
  if (meld.tiles.length !== requiredTileCount) return false;
  if (new Set(meld.tiles.map((tile) => tile.id)).size !== meld.tiles.length) return false;
  const first = meld.tiles[0];
  if (!first || !meld.tiles.every((tile) => faceKey(tile) === faceKey(first))) return false;

  if (meld.type === 'an-gang') {
    return meld.claimedTileId === undefined && meld.fromPlayerIndex === undefined;
  }
  const claimedTiles = meld.type === 'bu-gang' ? meld.tiles.slice(0, 3) : meld.tiles;
  return (
    typeof meld.claimedTileId === 'string' &&
    claimedTiles.some((tile) => tile.id === meld.claimedTileId) &&
    Number.isInteger(meld.fromPlayerIndex) &&
    (meld.fromPlayerIndex ?? -1) >= 0 &&
    (meld.fromPlayerIndex ?? 4) < 4
  );
}

export function isValidOrdinaryHandTile(tile: unknown): tile is OrdinaryHandTile {
  if (!isRecord(tile) || !FOUR_COPY_INDEXES.some((copy) => copy === tile.copy)) return false;
  if (tile.category === 'number') {
    return (
      NUMBER_TILE_SUITS.some((suit) => suit === tile.suit) &&
      NUMBER_TILE_RANKS.some((rank) => rank === tile.rank) &&
      tile.id === `${tile.suit}-${tile.rank}-${tile.copy}`
    );
  }
  return (
    tile.category === 'wind' &&
    WIND_TILE_KINDS.some((wind) => wind === tile.wind) &&
    tile.id === `wind-${tile.wind}-${tile.copy}`
  );
}

const HU_PATTERNS: readonly HuPattern[] = [
  'men-qing',
  'all-pungs',
  'global-single-wait',
  'mixed-one-suit',
  'pure-one-suit',
  'seven-pairs',
  'dragon-seven-pairs',
  'no-flower',
  'pressure-absolute',
  'tian-hu',
  'hua-kai',
  'gang-kai',
];

export function isValidHuStructure(value: unknown): value is HuStructure {
  if (!isRecord(value)) return false;
  if (value.type === 'standard') {
    if (
      value.pairs !== undefined ||
      value.dragon !== undefined ||
      !isValidOrdinaryTileFace(value.pair) ||
      !isNonNegativeInteger(value.existingMeldCount) ||
      value.existingMeldCount > 4 ||
      !Array.isArray(value.concealedMelds) ||
      value.existingMeldCount + value.concealedMelds.length !== 4
    ) {
      return false;
    }
    const faces: OrdinaryTileFace[] = [value.pair, value.pair];
    for (const meld of value.concealedMelds) {
      if (!isRecord(meld)) return false;
      if (meld.type === 'triplet') {
        if (!isValidOrdinaryTileFace(meld.tileFace)) return false;
        faces.push(meld.tileFace, meld.tileFace, meld.tileFace);
      } else if (meld.type === 'sequence') {
        if (!Array.isArray(meld.tiles) || meld.tiles.length !== 3) return false;
        const sequence = meld.tiles;
        if (!sequence.every(isValidOrdinaryTileFace)) return false;
        const [first, second, third] = sequence;
        if (
          first?.category !== 'number' ||
          second?.category !== 'number' ||
          third?.category !== 'number' ||
          first.suit !== second.suit ||
          first.suit !== third.suit ||
          second.rank !== first.rank + 1 ||
          third.rank !== first.rank + 2
        ) {
          return false;
        }
        faces.push(first, second, third);
      } else {
        return false;
      }
    }
    return hasAtMostFourOfEachFace(faces);
  }
  if (value.type === 'seven-pairs' || value.type === 'dragon-seven-pairs') {
    if (
      value.pair !== undefined ||
      value.concealedMelds !== undefined ||
      value.existingMeldCount !== undefined ||
      !Array.isArray(value.pairs) ||
      value.pairs.length !== 7 ||
      !value.pairs.every(isValidOrdinaryTileFace) ||
      !hasAtMostFourOfEachFace(value.pairs.flatMap((face) => [face, face]))
    ) {
      return false;
    }
    if (value.type === 'seven-pairs') return value.dragon === undefined;
    const dragon = value.dragon;
    return (
      isValidOrdinaryTileFace(dragon) &&
      value.pairs.filter((face) => ordinaryTileFaceKey(face) === ordinaryTileFaceKey(dragon))
        .length === 2
    );
  }
  return false;
}

export function isValidHuEvaluation(value: unknown): value is HuEvaluation {
  if (!(
    isRecord(value) &&
    isValidHuStructure(value.structure) &&
    isValidHuPatterns(value.patterns) &&
    isNonNegativeInteger(value.hardFlowerCount) &&
    isNonNegativeInteger(value.softFlowerCount) &&
    value.amount === undefined &&
    value.multiplier === undefined &&
    value.isBiXiaHu === undefined
  ))
    return false;
  return (
    !value.patterns.includes('tian-hu') ||
    (value.patterns.length === 1 && value.hardFlowerCount === 0 && value.softFlowerCount === 0)
  );
}

export function isValidHandResult(value: unknown, playerCount: number): value is HandResult {
  if (!isRecord(value) || !Number.isInteger(playerCount) || playerCount <= 0) return false;
  if (value.type === 'draw') {
    return (
      value.reason === 'wall-exhausted' &&
      value.source === undefined &&
      value.winningTile === undefined &&
      value.payerPlayerIndex === undefined &&
      value.winners === undefined &&
      value.winner === undefined &&
      value.drawSource === undefined &&
      value.formedFlowerKongDuringReplacement === undefined &&
      value.transfers === undefined
    );
  }
  if (
    value.type !== 'win' ||
    value.reason !== undefined ||
    !isValidOrdinaryHandTile(value.winningTile) ||
    value.transfers !== undefined ||
    value.selfDrawProvenance !== undefined ||
    value.amount !== undefined ||
    value.multiplier !== undefined ||
    value.isBiXiaHu !== undefined
  ) {
    return false;
  }
  if (value.source === 'self-draw') {
    return (
      value.payerPlayerIndex === undefined &&
      value.winners === undefined &&
      value.selfDrawProvenance === undefined &&
      isRecord(value.winner) &&
      isPlayerIndex(value.winner.playerIndex, playerCount) &&
      isValidHuEvaluation(value.winner.evaluation) &&
      value.winner.transfers === undefined &&
      isValidSelfDrawSourceSummary(value)
    );
  }
  if (
    (value.source !== 'discard' && value.source !== 'rob-bu-gang') ||
    value.winner !== undefined ||
    value.drawSource !== undefined ||
    value.formedFlowerKongDuringReplacement !== undefined ||
    !isPlayerIndex(value.payerPlayerIndex, playerCount) ||
    !Array.isArray(value.winners) ||
    value.winners.length === 0
  )
    return false;
  const payerPlayerIndex = value.payerPlayerIndex;
  const indexes: number[] = [];
  for (const winner of value.winners) {
    if (
      !isRecord(winner) ||
      !isPlayerIndex(winner.playerIndex, playerCount) ||
      winner.playerIndex === payerPlayerIndex ||
      !isValidHuEvaluation(winner.evaluation) ||
      winner.transfers !== undefined
    ) {
      return false;
    }
    indexes.push(winner.playerIndex);
  }
  if (new Set(indexes).size !== indexes.length) return false;
  return indexes.every(
    (index, position) =>
      position === 0 ||
      clockwiseDistance(payerPlayerIndex, indexes[position - 1]!, playerCount) <
        clockwiseDistance(payerPlayerIndex, index, playerCount),
  );
}

export function isValidPendingHuScoringEvent(
  value: unknown,
  playerCount: number,
): value is PendingHuScoringEvent {
  if (
    !isRecord(value) ||
    value.type !== 'hu-resolved' ||
    value.status !== 'pending' ||
    !isPlayerIndex(value.winnerPlayerIndex, playerCount) ||
    !isValidOrdinaryHandTile(value.winningTile) ||
    !isValidHuEvaluation(value.evaluation)
  )
    return false;
  if (value.source === 'self-draw') {
    return (
      value.payerPlayerIndex === undefined &&
      value.winner === undefined &&
      value.winners === undefined &&
      value.amount === undefined &&
      value.multiplier === undefined &&
      isValidSelfDrawSourceSummary(value)
    );
  }
  return (
    (value.source === 'discard' || value.source === 'rob-bu-gang') &&
    value.drawSource === undefined &&
    value.formedFlowerKongDuringReplacement === undefined &&
    value.winner === undefined &&
    value.winners === undefined &&
    isPlayerIndex(value.payerPlayerIndex, playerCount) &&
    value.winnerPlayerIndex !== value.payerPlayerIndex
  );
}

const SELF_DRAW_SOURCES: readonly SelfDrawSource[] = [
  'initial-dealer',
  'wall-head',
  'flower-replacement',
  'ming-gang-tail',
  'an-gang-tail',
  'bu-gang-tail',
];

function isValidSelfDrawSourceSummary(value: Record<string, unknown>): boolean {
  if (!SELF_DRAW_SOURCES.some((source) => source === value.drawSource)) return false;
  return value.drawSource === 'flower-replacement'
    ? typeof value.formedFlowerKongDuringReplacement === 'boolean'
    : value.formedFlowerKongDuringReplacement === undefined;
}

function isValidHuPatterns(value: unknown): value is readonly HuPattern[] {
  if (!Array.isArray(value)) return false;
  let previous = -1;
  for (const pattern of value) {
    const index = HU_PATTERNS.findIndex((candidate) => candidate === pattern);
    if (index < 0 || index <= previous) return false;
    previous = index;
  }
  return (
    !(value.includes('hua-kai') && value.includes('gang-kai')) &&
    (!value.includes('tian-hu') || value.length === 1)
  );
}

function isValidOrdinaryTileFace(value: unknown): value is OrdinaryTileFace {
  if (!isRecord(value)) return false;
  return value.category === 'number'
    ? NUMBER_TILE_SUITS.some((suit) => suit === value.suit) &&
        NUMBER_TILE_RANKS.some((rank) => rank === value.rank)
    : value.category === 'wind' && WIND_TILE_KINDS.some((wind) => wind === value.wind);
}

function hasAtMostFourOfEachFace(faces: readonly OrdinaryTileFace[]): boolean {
  const counts = new Map<string, number>();
  for (const face of faces) {
    const key = ordinaryTileFaceKey(face);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].every((count) => count <= 4);
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function isPlayerIndex(value: unknown, playerCount: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < playerCount;
}

function clockwiseDistance(from: number, to: number, playerCount: number): number {
  return (to - from + playerCount) % playerCount;
}

function sevenPairs(counts: ReadonlyMap<string, number>): OrdinaryTileFace[] | null {
  if ([...counts.values()].some((count) => count !== 2 && count !== 4)) return null;
  const pairs = FACE_KEYS.flatMap((key) =>
    Array.from({ length: (counts.get(key) ?? 0) / 2 }, () => faceFromKey(key)),
  );
  return pairs.length === 7 ? pairs : null;
}

function decomposeMelds(counts: ReadonlyMap<string, number>): HuConcealedMeld[] | null {
  const firstKey = FACE_KEYS.find((key) => (counts.get(key) ?? 0) > 0);
  if (!firstKey) return [];

  if ((counts.get(firstKey) ?? 0) >= 3) {
    const remaining = new Map(counts);
    remaining.set(firstKey, (remaining.get(firstKey) ?? 0) - 3);
    const rest = decomposeMelds(remaining);
    if (rest) return [{ type: 'triplet', tileFace: faceFromKey(firstKey) }, ...rest];
  }

  const face = faceFromKey(firstKey);
  if (face.category === 'number' && face.rank <= 7) {
    const secondKey = `${face.suit}-${face.rank + 1}`;
    const thirdKey = `${face.suit}-${face.rank + 2}`;
    if ((counts.get(secondKey) ?? 0) > 0 && (counts.get(thirdKey) ?? 0) > 0) {
      const remaining = new Map(counts);
      for (const key of [firstKey, secondKey, thirdKey]) {
        remaining.set(key, (remaining.get(key) ?? 0) - 1);
      }
      const rest = decomposeMelds(remaining);
      if (rest) {
        return [
          {
            type: 'sequence',
            tiles: [face, faceFromKey(secondKey), faceFromKey(thirdKey)],
          },
          ...rest,
        ];
      }
    }
  }

  return null;
}

function countFaces(tiles: readonly OrdinaryHandTile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) counts.set(faceKey(tile), (counts.get(faceKey(tile)) ?? 0) + 1);
  return counts;
}

function countFace(tiles: readonly OrdinaryHandTile[], key: string): number {
  return tiles.filter((tile) => faceKey(tile) === key).length;
}

export function ordinaryTileFace(tile: OrdinaryHandTile): OrdinaryTileFace {
  return tile.category === 'number'
    ? { category: 'number', suit: tile.suit, rank: tile.rank }
    : { category: 'wind', wind: tile.wind };
}

export function ordinaryTileFaceKey(tileFace: OrdinaryTileFace): string {
  return tileFace.category === 'number'
    ? `${tileFace.suit}-${tileFace.rank}`
    : `wind-${tileFace.wind}`;
}

function faceKey(tile: OrdinaryHandTile): string {
  return ordinaryTileFaceKey(ordinaryTileFace(tile));
}

function faceFromKey(key: string): OrdinaryTileFace {
  if (key.startsWith('wind-')) {
    const wind = WIND_TILE_KINDS.find((candidate) => `wind-${candidate}` === key);
    if (!wind) throw new Error(`Invalid wind face key ${key}`);
    return { category: 'wind', wind };
  }
  const [suitValue, rankValue] = key.split('-');
  const suit = NUMBER_TILE_SUITS.find((candidate) => candidate === suitValue);
  const rank = NUMBER_TILE_RANKS.find((candidate) => candidate === Number(rankValue));
  if (!suit || !rank) throw new Error(`Invalid number face key ${key}`);
  return { category: 'number', suit, rank };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
