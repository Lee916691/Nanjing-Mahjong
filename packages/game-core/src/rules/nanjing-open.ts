import type { ReactionResponseType } from '../actions';
import {
  evaluateHuStructure,
  getWinningTileFaces,
  isValidMeld,
  isValidOrdinaryHandTile,
  isValidOrdinaryTileFace,
  ordinaryTileFace,
  ordinaryTileFaceKey,
} from '../hu';
import type { HuStructure } from '../hu';
import {
  NUMBER_TILE_RANKS,
  NUMBER_TILE_SUITS,
  FOUR_COPY_FLOWER_KINDS,
  FOUR_COPY_INDEXES,
  PLANT_FLOWER_KINDS,
  SEASON_FLOWER_KINDS,
  WIND_TILE_KINDS,
  isSameOrdinaryTileFace,
} from '../state';
import type {
  HuEvaluation,
  HuPattern,
  OrdinaryHandTile,
  OrdinaryTileFace,
  ReactionAvailability,
} from '../state';
import type {
  HuEvaluationContext,
  ReactionAvailabilityContext,
  RuleSet,
  SpecialDiscardScoringContext,
  ThreeMouthForcedHuContext,
  ThreeMouthForcedHuResolution,
} from './RuleSet';

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
  'di-hu': 30,
  'tian-hu': 0,
  'hua-kai': 10,
  'gang-kai': 20,
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
  getSpecialDiscardScoreTransfers: getSpecialDiscardScoreTransfers,
  evaluateHu: evaluateNanjingOpenHu,
  getHuScoreTransfers: (context) => {
    const { source, winnerPlayerIndex, evaluation } = context;
    if (source === 'self-draw' && context.drawSource === 'initial-dealer') {
      return otherPlayers(winnerPlayerIndex, context.playerCount).map((payerPlayerIndex) => ({
        fromPlayerIndex: payerPlayerIndex,
        toPlayerIndex: winnerPlayerIndex,
        amount: 1000,
      }));
    }
    const unmultiplied =
      10 +
      evaluation.patterns.reduce((total, pattern) => total + PATTERN_POINTS[pattern], 0) +
      (evaluation.hardFlowerCount + evaluation.softFlowerCount) * 2;
    if (source === 'self-draw') {
      return otherPlayers(winnerPlayerIndex, context.playerCount).map((payerPlayerIndex) => ({
        fromPlayerIndex: payerPlayerIndex,
        toPlayerIndex: winnerPlayerIndex,
        amount: unmultiplied * 2,
      }));
    }
    return [
      {
        fromPlayerIndex: context.payerPlayerIndex,
        toPlayerIndex: winnerPlayerIndex,
        amount: unmultiplied * (source === 'rob-bu-gang' ? 6 : 2),
      },
    ];
  },
  getThreeMouthForcedHuResolution: getThreeMouthForcedHuResolution,
  getFlowerKongScoreTransfers: ({ playerIndex, playerCount }) =>
    otherPlayers(playerIndex, playerCount).map((payerPlayerIndex) => ({
      fromPlayerIndex: payerPlayerIndex,
      toPlayerIndex: playerIndex,
      amount: 20,
    })),
};

function getThreeMouthForcedHuResolution(
  context: ThreeMouthForcedHuContext,
): ThreeMouthForcedHuResolution | null {
  if (!isValidThreeMouthForcedHuContext(context)) return null;
  const allTiles = [
    ...context.concealedTiles,
    context.winningTile,
    ...context.melds.flatMap((meld) => meld.tiles),
  ];
  const numberSuits = new Set(
    allTiles.filter((tile) => tile.category === 'number').map((tile) => tile.suit),
  );
  const hasWinds = allTiles.some((tile) => tile.category === 'wind');
  const patterns: HuPattern[] = [];
  if (context.melds.every((meld) => meld.type !== 'peng')) patterns.push('men-qing');
  patterns.push(context.forcedBasePattern);
  if (numberSuits.size === 1 && hasWinds) patterns.push('mixed-one-suit');
  if (numberSuits.size === 1 && !hasWinds) patterns.push('pure-one-suit');
  if (context.flowers.length === 0) patterns.push('no-flower');
  if (isApplicableThreeMouthDiHu(context)) patterns.push('di-hu');
  if (context.source === 'self-draw') {
    if (
      context.drawSource === 'ming-gang-tail' ||
      context.drawSource === 'an-gang-tail' ||
      context.drawSource === 'bu-gang-tail' ||
      (context.drawSource === 'flower-replacement' && context.formedFlowerKongDuringReplacement)
    ) {
      patterns.push('gang-kai');
    } else if (context.drawSource === 'flower-replacement') {
      patterns.push('hua-kai');
    }
  }
  const evaluation: HuEvaluation = {
    structure: { type: 'three-mouth-forced', trigger: context.trigger },
    patterns,
    hardFlowerCount: context.flowers.length,
    softFlowerCount: forcedSoftFlowerCount(context, patterns, numberSuits.size),
  };
  const unmultiplied =
    10 +
    patterns.reduce((total, pattern) => total + PATTERN_POINTS[pattern], 0) +
    (evaluation.hardFlowerCount + evaluation.softFlowerCount) * 2;
  const threeMouthResolution = {
    triggerSource: context.trigger,
    triggerPlayerIndex:
      context.source === 'discard' ? context.discarderPlayerIndex : context.winnerPlayerIndex,
    settlementMode: 'self-draw' as const,
    forcedBasePattern: context.forcedBasePattern,
    payerPlayerIndex: context.payerPlayerIndex,
  };
  return {
    evaluation,
    transfers: Array.from({ length: context.playerCount - 1 }, () => ({
      fromPlayerIndex: context.payerPlayerIndex,
      toPlayerIndex: context.winnerPlayerIndex,
      amount: unmultiplied * 2,
    })),
    threeMouthResolution,
  };
}

function isValidThreeMouthForcedHuContext(value: unknown): value is ThreeMouthForcedHuContext {
  if (
    !isRecord(value) ||
    value.playerCount !== 4 ||
    !isPlayerIndex(value.winnerPlayerIndex) ||
    !isPlayerIndex(value.payerPlayerIndex) ||
    value.winnerPlayerIndex === value.payerPlayerIndex ||
    !isValidOrdinaryHandTile(value.winningTile) ||
    !Array.isArray(value.concealedTiles) ||
    !value.concealedTiles.every(isValidOrdinaryHandTile) ||
    !Array.isArray(value.melds) ||
    !value.melds.every(isValidMeld) ||
    !Array.isArray(value.flowers) ||
    !value.flowers.every(isValidFlowerTile) ||
    !Array.isArray(value.allMelds) ||
    !value.allMelds.every(isValidMeld) ||
    (value.forcedBasePattern !== 'all-pungs' && value.forcedBasePattern !== 'global-single-wait')
  ) {
    return false;
  }
  const allowedKeys = [
    'source',
    'winnerPlayerIndex',
    'payerPlayerIndex',
    'playerCount',
    'winningTile',
    'concealedTiles',
    'melds',
    'flowers',
    'allMelds',
    'dealerIndex',
    'diHuDeclaration',
    'trigger',
    'forcedBasePattern',
    'discarderPlayerIndex',
    'drawSource',
    'formedFlowerKongDuringReplacement',
  ];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return false;
  if (value.dealerIndex !== undefined && !isPlayerIndex(value.dealerIndex)) return false;
  if (value.diHuDeclaration !== undefined && !isValidDiHuDeclaration(value.diHuDeclaration)) {
    return false;
  }
  const ordinaryEntities = [
    value.winningTile,
    ...value.concealedTiles,
    ...value.melds.flatMap((meld) => meld.tiles),
  ] as OrdinaryHandTile[];
  const entityIds = [
    ...ordinaryEntities.map((tile) => tile.id),
    ...value.flowers.map((tile) => tile.id),
  ];
  if (
    new Set(entityIds).size !== entityIds.length ||
    new Set(value.melds.map((meld) => meld.id)).size !== value.melds.length ||
    new Set(value.allMelds.map((meld) => meld.id)).size !== value.allMelds.length
  )
    return false;
  const faceCounts = new Map<string, number>();
  for (const tile of ordinaryEntities) {
    const key = ordinaryTileFaceKey(ordinaryTileFace(tile));
    faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
  }
  if ([...faceCounts.values()].some((count) => count > 4)) return false;
  const winningTile = value.winningTile as OrdinaryHandTile;
  const matchingConcealedCount = (value.concealedTiles as OrdinaryHandTile[]).filter((tile) =>
    isSameOrdinaryTileFace(tile, winningTile),
  ).length;
  if (value.source === 'discard') {
    return (
      isPlayerIndex(value.discarderPlayerIndex) &&
      value.discarderPlayerIndex !== value.winnerPlayerIndex &&
      (value.forcedBasePattern === 'global-single-wait') ===
        (value.discarderPlayerIndex === value.payerPlayerIndex) &&
      (value.trigger === 'discard-peng-opportunity' ||
        value.trigger === 'discard-ming-gang-opportunity') &&
      (value.trigger === 'discard-ming-gang-opportunity'
        ? matchingConcealedCount === 3
        : matchingConcealedCount >= 2) &&
      value.drawSource === undefined &&
      value.formedFlowerKongDuringReplacement === undefined
    );
  }
  if (value.source !== 'self-draw' || value.trigger !== 'self-draw-an-gang-opportunity') {
    return false;
  }
  if (value.forcedBasePattern !== 'global-single-wait') return false;
  if (matchingConcealedCount !== 3) return false;
  return value.drawSource === 'flower-replacement'
    ? typeof value.formedFlowerKongDuringReplacement === 'boolean'
    : value.drawSource === 'wall-head' ||
        value.drawSource === 'ming-gang-tail' ||
        value.drawSource === 'an-gang-tail' ||
        value.drawSource === 'bu-gang-tail';
}

function isValidFlowerTile(value: unknown): boolean {
  if (!isRecord(value) || value.category !== 'flower') return false;
  if (value.flowerGroup === 'four-copy') {
    return (
      hasOnlyKeys(value, ['category', 'id', 'flowerGroup', 'flower', 'copy']) &&
      FOUR_COPY_FLOWER_KINDS.some((flower) => flower === value.flower) &&
      FOUR_COPY_INDEXES.some((copy) => copy === value.copy) &&
      value.id === `flower-${String(value.flower)}-${String(value.copy)}`
    );
  }
  if (value.flowerGroup === 'plant') {
    return (
      hasOnlyKeys(value, ['category', 'id', 'flowerGroup', 'flower', 'copy']) &&
      PLANT_FLOWER_KINDS.some((flower) => flower === value.flower) &&
      value.copy === 1 &&
      value.id === `flower-${String(value.flower)}-1`
    );
  }
  return (
    value.flowerGroup === 'season' &&
    hasOnlyKeys(value, ['category', 'id', 'flowerGroup', 'flower', 'copy']) &&
    SEASON_FLOWER_KINDS.some((flower) => flower === value.flower) &&
    value.copy === 1 &&
    value.id === `season-${String(value.flower)}-1`
  );
}

function isApplicableThreeMouthDiHu(context: ThreeMouthForcedHuContext): boolean {
  const declaration = context.diHuDeclaration;
  if (
    !isValidDiHuDeclaration(declaration) ||
    declaration.playerIndex !== context.winnerPlayerIndex ||
    context.dealerIndex === context.winnerPlayerIndex ||
    !declaration.winningTileFaces.some((face) =>
      isSameOrdinaryTileFaceValue(face, ordinaryTileFace(context.winningTile)),
    )
  ) {
    return false;
  }
  return (
    context.source === 'discard' ||
    context.drawSource === 'wall-head' ||
    context.drawSource === 'ming-gang-tail' ||
    context.drawSource === 'an-gang-tail' ||
    context.drawSource === 'flower-replacement'
  );
}

function forcedSoftFlowerCount(
  context: ThreeMouthForcedHuContext,
  patterns: readonly HuPattern[],
  numberSuitCount: number,
): number {
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
  return count;
}

function getSpecialDiscardScoreTransfers(context: unknown) {
  if (!isValidSpecialDiscardScoringContext(context)) return [];
  if (context.source === 'four-winds-gathered') {
    return otherPlayers(context.receiverPlayerIndex, context.playerCount).map(
      (payerPlayerIndex) => ({
        fromPlayerIndex: payerPlayerIndex,
        toPlayerIndex: context.receiverPlayerIndex,
        amount: 10,
      }),
    );
  }
  return otherPlayers(context.payerPlayerIndex, context.playerCount).map((receiverPlayerIndex) => ({
    fromPlayerIndex: context.payerPlayerIndex,
    toPlayerIndex: receiverPlayerIndex,
    amount: 10,
  }));
}

function isValidSpecialDiscardScoringContext(
  value: unknown,
): value is SpecialDiscardScoringContext {
  if (!isRecord(value) || value.playerCount !== 4) return false;
  if (value.source === 'four-winds-gathered') {
    return (
      hasOnlyKeys(value, ['source', 'playerCount', 'receiverPlayerIndex', 'completingWind']) &&
      isPlayerIndex(value.receiverPlayerIndex) &&
      WIND_TILE_KINDS.some((wind) => wind === value.completingWind)
    );
  }
  if (value.source !== 'follow-discard' && value.source !== 'four-identical-discards') return false;
  if (!isPlayerIndex(value.payerPlayerIndex) || !isValidOrdinaryTileFaceValue(value.tileFace))
    return false;
  return value.source === 'four-identical-discards'
    ? hasOnlyKeys(value, ['source', 'playerCount', 'payerPlayerIndex', 'tileFace'])
    : hasOnlyKeys(value, [
        'source',
        'playerCount',
        'payerPlayerIndex',
        'triggeringPlayerIndex',
        'tileFace',
      ]) &&
        isPlayerIndex(value.triggeringPlayerIndex) &&
        value.triggeringPlayerIndex !== value.payerPlayerIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlayerIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 4;
}

function isValidOrdinaryTileFaceValue(value: unknown): value is OrdinaryTileFace {
  if (!isRecord(value)) return false;
  return value.category === 'number'
    ? hasOnlyKeys(value, ['category', 'suit', 'rank']) &&
        NUMBER_TILE_SUITS.some((suit) => suit === value.suit) &&
        NUMBER_TILE_RANKS.some((rank) => rank === value.rank)
    : value.category === 'wind' &&
        hasOnlyKeys(value, ['category', 'wind']) &&
        WIND_TILE_KINDS.some((wind) => wind === value.wind);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function getNanjingOpenAvailableReactions(
  context: ReactionAvailabilityContext,
): ReactionAvailability {
  const responseTypes: ReactionResponseType[] = ['pass'];
  const targetTile =
    context.source === 'discard'
      ? context.discardedTile.category === 'flower'
        ? null
        : context.discardedTile
      : context.targetTile;
  const payerPlayerIndex =
    context.source === 'discard' ? context.fromPlayerIndex : context.declarerPlayerIndex;

  if (
    targetTile &&
    context.responderPassHu === false &&
    evaluateNanjingOpenHu({
      source: context.source === 'discard' ? 'discard' : 'rob-bu-gang',
      winnerPlayerIndex: context.responderPlayerIndex,
      payerPlayerIndex,
      playerCount: context.playerCount,
      winningTile: targetTile,
      concealedTiles: context.responderConcealedTiles,
      melds: context.responderMelds,
      flowers: context.responderFlowers,
      allMelds: context.allMelds,
      dealerIndex: context.dealerIndex,
      diHuDeclaration: context.responderDiHuDeclaration,
    })
  ) {
    responseTypes.push('hu');
  }

  if (context.source === 'discard' && targetTile) {
    const matchingTileCount = context.responderConcealedTiles.filter((tile) =>
      isSameOrdinaryTileFace(tile, targetTile),
    ).length;
    if (!context.responderDiHuDeclaration && matchingTileCount >= 2) responseTypes.push('peng');
    if (
      matchingTileCount >= 3 &&
      context.canDrawFromWallTail &&
      (!context.responderDiHuDeclaration || preservesDiHuWaitAfterMingGang(context, targetTile))
    ) {
      responseTypes.push('ming-gang');
    }
  }

  return {
    playerIndex: context.responderPlayerIndex,
    seat: context.responderSeat,
    responseTypes,
  };
}

function evaluateNanjingOpenHu(context: HuEvaluationContext): HuEvaluation | null {
  if (context.diHuDeclaration !== undefined && !isValidDiHuDeclaration(context.diHuDeclaration)) {
    return null;
  }
  const structure = evaluateHuStructure({
    concealedTiles: context.concealedTiles,
    winningTile: context.winningTile,
    melds: context.melds,
  });
  if (!structure) return null;

  if (context.source === 'self-draw' && context.drawSource === 'initial-dealer') {
    if (context.diHuDeclaration) return null;
    return { structure, patterns: ['tian-hu'], hardFlowerCount: 0, softFlowerCount: 0 };
  }

  const diHu = isApplicableDiHuDeclaration(context);
  if (context.diHuDeclaration !== undefined && !diHu) return null;

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
  if (diHu) patterns.push('di-hu');
  if (context.source === 'self-draw') {
    if (
      context.drawSource === 'ming-gang-tail' ||
      context.drawSource === 'an-gang-tail' ||
      context.drawSource === 'bu-gang-tail' ||
      (context.drawSource === 'flower-replacement' && context.formedFlowerKongDuringReplacement)
    ) {
      patterns.push('gang-kai');
    } else if (context.drawSource === 'flower-replacement') {
      patterns.push('hua-kai');
    }
  }

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
  return (
    getWinningTileFaces({
      concealedTiles: context.concealedTiles,
      melds: context.melds,
    })?.length === 1
  );
}

function isApplicableDiHuDeclaration(context: HuEvaluationContext): boolean {
  const declaration = context.diHuDeclaration;
  return (
    isValidDiHuDeclaration(declaration) &&
    hasValidDiHuHuSource(context) &&
    declaration.playerIndex === context.winnerPlayerIndex &&
    Number.isInteger(context.dealerIndex) &&
    context.dealerIndex !== context.winnerPlayerIndex &&
    declaration.winningTileFaces.some((face) =>
      isSameOrdinaryTileFaceValue(face, ordinaryTileFace(context.winningTile)),
    )
  );
}

function hasValidDiHuHuSource(context: HuEvaluationContext): boolean {
  if (context.source !== 'self-draw') return true;
  if (context.drawSource === 'flower-replacement') {
    return typeof context.formedFlowerKongDuringReplacement === 'boolean';
  }
  return (
    (context.drawSource === 'wall-head' ||
      context.drawSource === 'ming-gang-tail' ||
      context.drawSource === 'an-gang-tail') &&
    !Object.prototype.hasOwnProperty.call(context, 'formedFlowerKongDuringReplacement')
  );
}

function preservesDiHuWaitAfterMingGang(
  context: Extract<ReactionAvailabilityContext, { source: 'discard' }>,
  targetTile: OrdinaryHandTile,
): boolean {
  const declaration = context.responderDiHuDeclaration;
  if (!isValidDiHuDeclaration(declaration)) return false;
  const selected = context.responderConcealedTiles
    .filter((tile) => isSameOrdinaryTileFace(tile, targetTile))
    .slice(0, 3);
  if (selected.length !== 3) return false;
  const selectedIds = new Set(selected.map((tile) => tile.id));
  const waits = getWinningTileFaces({
    concealedTiles: context.responderConcealedTiles.filter((tile) => !selectedIds.has(tile.id)),
    melds: [
      ...context.responderMelds,
      {
        id: 'di-hu-ming-gang-query',
        type: 'ming-gang',
        tiles: [...selected, targetTile],
        claimedTileId: targetTile.id,
        fromPlayerIndex: context.fromPlayerIndex,
      },
    ],
  });
  return waits !== null && sameWaitFaces(waits, declaration.winningTileFaces);
}

function isValidDiHuDeclaration(
  value: unknown,
): value is NonNullable<HuEvaluationContext['diHuDeclaration']> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['playerIndex', 'winningTileFaces']) ||
    !isPlayerIndex(value.playerIndex) ||
    !Array.isArray(value.winningTileFaces)
  ) {
    return false;
  }
  const faces = value.winningTileFaces;
  return (
    faces.length > 0 &&
    faces.every(isValidOrdinaryTileFace) &&
    new Set(faces.map(ordinaryTileFaceKey)).size === faces.length &&
    faces.every(
      (face, index) => index === 0 || compareOrdinaryTileFaces(faces[index - 1]!, face) < 0,
    )
  );
}

function compareOrdinaryTileFaces(left: OrdinaryTileFace, right: OrdinaryTileFace): number {
  const ordered = [
    ...NUMBER_TILE_SUITS.flatMap((suit) =>
      NUMBER_TILE_RANKS.map((rank): OrdinaryTileFace => ({ category: 'number', suit, rank })),
    ),
    ...WIND_TILE_KINDS.map((wind): OrdinaryTileFace => ({ category: 'wind', wind })),
  ];
  return (
    ordered.findIndex((face) => isSameOrdinaryTileFaceValue(face, left)) -
    ordered.findIndex((face) => isSameOrdinaryTileFaceValue(face, right))
  );
}

function sameWaitFaces(
  left: readonly OrdinaryTileFace[],
  right: readonly OrdinaryTileFace[],
): boolean {
  return (
    left.length === right.length &&
    left.every((face, index) =>
      right[index] ? isSameOrdinaryTileFaceValue(face, right[index]) : false,
    )
  );
}

function isSameOrdinaryTileFaceValue(left: OrdinaryTileFace, right: OrdinaryTileFace): boolean {
  return ordinaryTileFaceKey(left) === ordinaryTileFaceKey(right);
}

function otherPlayers(playerIndex: number, playerCount: number): number[] {
  return Array.from({ length: playerCount }, (_, index) => index).filter(
    (index) => index !== playerIndex,
  );
}
