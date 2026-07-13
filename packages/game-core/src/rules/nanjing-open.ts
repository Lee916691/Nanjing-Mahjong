import type { ReactionResponseType } from '../actions';
import { evaluateHuStructure, ordinaryTileFace, ordinaryTileFaceKey } from '../hu';
import type { HuStructure } from '../hu';
import {
  FOUR_COPY_INDEXES,
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  WIND_TILE_KINDS,
  isSameOrdinaryTileFace,
} from '../state';
import type {
  GameState,
  HuEvaluation,
  HuPattern,
  OrdinaryHandTile,
  OrdinaryTileFace,
  ReactionAvailability,
  ReactionWindow,
} from '../state';
import type { HuEvaluationContext, RuleSet } from './RuleSet';

const PATTERN_POINTS: Readonly<Record<HuPattern, number>> = {
  'men-qing': 10,
  'all-pungs': 30,
  'global-single-wait': 80,
  'mixed-one-suit': 30,
  'pure-one-suit': 40,
  'seven-pairs': 50,
  'dragon-seven-pairs': 100,
  'no-flower': 30,
  'pressure-absolute': 30,
};

export const NANJING_OPEN_RULE_SET: RuleSet = {
  id: 'nanjing-open',
  displayName: '\u5357\u4eac\u9ebb\u5c06\u657e\u5f00\u5934',
  totalEffectiveDealerTurns: 16,
  validateAction: () => true,
  applyAction: (state) => state,
  getAvailableReactions: getNanjingOpenAvailableReactions,
  getMingGangScoreTransfers: ({ receiverPlayerIndex, payerPlayerIndex }) => [
    { fromPlayerIndex: payerPlayerIndex, toPlayerIndex: receiverPlayerIndex, amount: 20 },
  ],
  getAnGangScoreTransfers: ({ playerIndex, playerCount }) =>
    otherPlayers(playerIndex, playerCount).map((payerPlayerIndex) => ({
      fromPlayerIndex: payerPlayerIndex,
      toPlayerIndex: playerIndex,
      amount: 10,
    })),
  getBuGangScoreTransfers: ({ playerIndex, payerPlayerIndex }) => [
    { fromPlayerIndex: payerPlayerIndex, toPlayerIndex: playerIndex, amount: 20 },
  ],
  evaluateHu: evaluateNanjingOpenHu,
  getHuScoreTransfers: ({ source, winnerPlayerIndex, payerPlayerIndex, evaluation }) => {
    const unmultiplied =
      10 +
      evaluation.patterns.reduce((total, pattern) => total + PATTERN_POINTS[pattern], 0) +
      (evaluation.hardFlowerCount + evaluation.softFlowerCount) * 2;
    return [
      {
        fromPlayerIndex: payerPlayerIndex,
        toPlayerIndex: winnerPlayerIndex,
        amount: unmultiplied * (source === 'rob-bu-gang' ? 6 : 2),
      },
    ];
  },
  getFlowerKongScoreTransfers: ({ playerIndex, playerCount }) =>
    otherPlayers(playerIndex, playerCount).map((payerPlayerIndex) => ({
      fromPlayerIndex: payerPlayerIndex,
      toPlayerIndex: playerIndex,
      amount: 20,
    })),
};

function getNanjingOpenAvailableReactions(
  state: GameState,
  reactionWindow: ReactionWindow,
): ReactionAvailability[] {
  if (reactionWindow.source !== 'discard' && reactionWindow.source !== 'bu-gang') return [];
  return reactionWindow.responderOrder.map((responder) => {
    const player = state.players[responder.playerIndex];
    if (!player) throw new Error(`Invalid reaction responder index ${responder.playerIndex}`);
    const responseTypes: ReactionResponseType[] = ['pass'];
    const targetTile =
      reactionWindow.source === 'discard'
        ? reactionWindow.discardedTile.category === 'flower'
          ? null
          : reactionWindow.discardedTile
        : reactionWindow.intent.tile;
    const payerPlayerIndex =
      reactionWindow.source === 'discard'
        ? reactionWindow.fromPlayerIndex
        : reactionWindow.intent.declarerPlayerIndex;

    if (
      targetTile &&
      player.passHu === false &&
      evaluateNanjingOpenHu({
        source: reactionWindow.source === 'discard' ? 'discard' : 'rob-bu-gang',
        winnerPlayerIndex: responder.playerIndex,
        payerPlayerIndex,
        playerCount: state.players.length,
        winningTile: targetTile,
        concealedTiles: player.hand,
        melds: player.melds,
        flowers: player.flowers,
        allMelds: state.players.flatMap((candidate) => candidate.melds),
      })
    ) {
      responseTypes.push('hu');
    }

    if (reactionWindow.source === 'discard' && targetTile) {
      const matchingTileCount = player.hand.filter((tile) =>
        isSameOrdinaryTileFace(tile, targetTile),
      ).length;
      if (matchingTileCount >= 2) responseTypes.push('peng');
      if (matchingTileCount >= 3) responseTypes.push('ming-gang');
    }

    return { playerIndex: responder.playerIndex, seat: responder.seat, responseTypes };
  });
}

function evaluateNanjingOpenHu(context: HuEvaluationContext): HuEvaluation | null {
  const structure = evaluateHuStructure({
    concealedTiles: context.concealedTiles,
    winningTile: context.winningTile,
    melds: context.melds,
  });
  if (!structure) return null;

  const patterns: HuPattern[] = [];
  const menQing = context.melds.every((meld) => meld.type !== 'peng');
  const allPungs =
    structure.type === 'standard' &&
    structure.concealedMelds.every((meld) => meld.type === 'triplet');
  const globalSingleWait =
    structure.type === 'standard' &&
    context.melds.length === 4 &&
    context.concealedTiles.length === 1;
  const allTiles = [
    ...context.concealedTiles,
    context.winningTile,
    ...context.melds.flatMap((meld) => meld.tiles),
  ];
  const numberSuits = new Set(
    allTiles.filter((tile) => tile.category === 'number').map((tile) => tile.suit),
  );
  const hasWinds = allTiles.some((tile) => tile.category === 'wind');
  const pureOneSuit = numberSuits.size === 1 && !hasWinds;
  const mixedOneSuit = numberSuits.size === 1 && hasWinds;
  const uniqueWait = isUniqueStructuralWait(context);
  const pressureAbsolute =
    uniqueWait &&
    context.allMelds.some(
      (meld) =>
        (meld.type === 'peng' || meld.type === 'bu-gang') &&
        meld.tiles[0] &&
        ordinaryTileFaceKey(ordinaryTileFace(meld.tiles[0])) ===
          ordinaryTileFaceKey(ordinaryTileFace(context.winningTile)),
    );

  if (menQing) patterns.push('men-qing');
  if (globalSingleWait) patterns.push('global-single-wait');
  else if (allPungs) patterns.push('all-pungs');
  if (mixedOneSuit) patterns.push('mixed-one-suit');
  if (pureOneSuit) patterns.push('pure-one-suit');
  if (structure.type === 'seven-pairs') patterns.push('seven-pairs');
  if (structure.type === 'dragon-seven-pairs') patterns.push('dragon-seven-pairs');
  if (context.flowers.length === 0) patterns.push('no-flower');
  if (pressureAbsolute) patterns.push('pressure-absolute');

  const qualifiesWithoutHardFlowers =
    menQing ||
    allPungs ||
    globalSingleWait ||
    mixedOneSuit ||
    pureOneSuit ||
    structure.type === 'seven-pairs' ||
    structure.type === 'dragon-seven-pairs';
  if (!qualifiesWithoutHardFlowers && context.flowers.length < 4) return null;

  return {
    structure,
    patterns,
    hardFlowerCount: context.flowers.length,
    softFlowerCount: softFlowerCount(context, structure, patterns, uniqueWait),
  };
}

function softFlowerCount(
  context: HuEvaluationContext,
  structure: HuStructure,
  patterns: readonly HuPattern[],
  uniqueWait: boolean,
): number {
  const allTiles = [
    ...context.concealedTiles,
    context.winningTile,
    ...context.melds.flatMap((meld) => meld.tiles),
  ];
  const numberSuitCount = new Set(
    allTiles.filter((tile) => tile.category === 'number').map((tile) => tile.suit),
  ).size;
  let count =
    !patterns.includes('mixed-one-suit') &&
    !patterns.includes('pure-one-suit') &&
    numberSuitCount === 2
      ? 1
      : 0;

  for (const meld of context.melds) {
    if (meld.type === 'ming-gang' || meld.type === 'bu-gang') count += 1;
    if (meld.type === 'an-gang') count += 2;
    if (meld.tiles[0]?.category === 'wind') count += 1;
  }
  if (structure.type === 'standard') {
    count += structure.concealedMelds.filter(
      (meld) => meld.type === 'triplet' && meld.tileFace.category === 'wind',
    ).length;
  }

  if (
    uniqueWait &&
    !patterns.some((pattern) =>
      [
        'all-pungs',
        'global-single-wait',
        'seven-pairs',
        'dragon-seven-pairs',
        'pressure-absolute',
      ].includes(pattern),
    ) &&
    isSoftWait(structure, context)
  ) {
    count += 1;
  }
  return count;
}

function isSoftWait(structure: HuStructure, context: HuEvaluationContext): boolean {
  if (structure.type !== 'standard') return false;
  const winningFace = ordinaryTileFace(context.winningTile);
  const winningKey = ordinaryTileFaceKey(winningFace);
  if (
    ordinaryTileFaceKey(structure.pair) === winningKey &&
    context.concealedTiles.filter(
      (tile) => ordinaryTileFaceKey(ordinaryTileFace(tile)) === winningKey,
    ).length === 1
  ) {
    return true;
  }
  if (winningFace.category !== 'number') return false;
  return structure.concealedMelds.some((meld) => {
    if (meld.type !== 'sequence') return false;
    const ranks = meld.tiles.map((tile) => (tile.category === 'number' ? tile.rank : 0));
    const winningIndex = meld.tiles.findIndex((tile) => ordinaryTileFaceKey(tile) === winningKey);
    return (
      winningIndex === 1 ||
      (ranks[0] === 1 && winningIndex === 2) ||
      (ranks[0] === 7 && winningIndex === 0)
    );
  });
}

function isUniqueStructuralWait(context: HuEvaluationContext): boolean {
  let winningFaceCount = 0;
  for (const face of allOrdinaryFaces()) {
    const candidate = candidateTile(face, context);
    if (
      candidate &&
      evaluateHuStructure({
        concealedTiles: context.concealedTiles,
        winningTile: candidate,
        melds: context.melds,
      })
    ) {
      winningFaceCount += 1;
      if (winningFaceCount > 1) return false;
    }
  }
  return winningFaceCount === 1;
}

function candidateTile(
  face: OrdinaryTileFace,
  context: HuEvaluationContext,
): OrdinaryHandTile | null {
  const usedIds = new Set<string>([
    ...context.concealedTiles.map((tile) => tile.id),
    ...context.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)),
  ]);
  const copy = FOUR_COPY_INDEXES.find((candidate) => {
    const id =
      face.category === 'number'
        ? `${face.suit}-${face.rank}-${candidate}`
        : `wind-${face.wind}-${candidate}`;
    return !usedIds.has(id);
  });
  if (!copy) return null;
  return face.category === 'number'
    ? {
        category: 'number',
        suit: face.suit,
        rank: face.rank,
        copy,
        id: `${face.suit}-${face.rank}-${copy}`,
      }
    : { category: 'wind', wind: face.wind, copy, id: `wind-${face.wind}-${copy}` };
}

function allOrdinaryFaces(): OrdinaryTileFace[] {
  return [
    ...NUMBER_TILE_SUITS.flatMap((suit) =>
      NUMBER_TILE_RANKS.map((rank): OrdinaryTileFace => ({ category: 'number', suit, rank })),
    ),
    ...WIND_TILE_KINDS.map((wind): OrdinaryTileFace => ({ category: 'wind', wind })),
  ];
}

function otherPlayers(playerIndex: number, playerCount: number): number[] {
  return Array.from({ length: playerCount }, (_, index) => index).filter(
    (index) => index !== playerIndex,
  );
}
