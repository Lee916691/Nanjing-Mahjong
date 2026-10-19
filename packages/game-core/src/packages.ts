import type { GameAction } from './actions.js';
import type { Meld } from './meld.js';
import type {
  GameState,
  HuEvaluation,
  HuPattern,
  OrdinaryHandTile,
  OrdinaryTileFace,
  PendingScoringEvent,
  PackageHandResult,
  SoftFlowerItem,
} from './state.js';
import { ordinaryTileFace, ordinaryTileFaceKey, HU_PATTERNS } from './hu.js';
import { getRuleSet } from './rules/index.js';
import { forcedPackageTransfers, withSelfDrawFlowers } from './rules/nanjing-open.js';
export interface GlobalRack {
  tile: OrdinaryHandTile;
  wait: OrdinaryTileFace;
  active: boolean;
}
export function threeMouth(melds: readonly Meld[]): number | null {
  if (melds.length < 3) return null;
  const first = melds.slice(0, 3);
  const suppliers = new Set(
    first.filter((m) => m.type !== 'an-gang').map((m) => m.fromPlayerIndex),
  );
  return suppliers.size === 1 && !suppliers.has(undefined) ? [...suppliers][0]! : null;
}
const category = (tile: OrdinaryHandTile): string =>
  tile.category === 'wind' ? 'wind' : tile.suit;
export function threePure(melds: readonly Meld[]): string | null {
  if (melds.length < 3 || !melds[0]?.tiles[0]) return null;
  const group = category(melds[0].tiles[0]);
  return melds.every((m) => m.tiles.every((t) => category(t) === group)) ? group : null;
}
export function updateRacks(before: GameState, after: GameState, action: GameAction): GameState {
  if (before === after) return after;
  if (action.type === 'START_GAME') return after;
  const racks = { ...before.globalRacks };
  if (action.type === 'DISCARD_TILE' || action.type === 'DISCARDED_TILE') {
    for (let i = 0; i < after.players.length; i++) {
      const player = after.players[i]!,
        old = before.players[i]!;
      if (player.hand === old.hand || player.hand.length !== 1 || player.melds.length !== 4)
        continue;
      const wait = ordinaryTileFace(player.hand[0]!);
      const rack = racks[i];
      if (rack) {
        if (ordinaryTileFaceKey(rack.wait) !== ordinaryTileFaceKey(wait))
          racks[i] = { ...rack, active: false };
      } else if (player.melds[3]?.type === 'peng' && old.hand.some((t) => t.id === action.tileId)) {
        const tile = old.hand.find((t) => t.id === action.tileId)!;
        racks[i] = { tile, wait, active: true };
      }
    }
  }
  return Object.keys(racks).length ? { ...after, globalRacks: racks } : after;
}
const inRack = (tile: OrdinaryHandTile, rack: GlobalRack): boolean =>
  rack.active &&
  ((tile.category === 'wind' && rack.tile.category === 'wind') ||
    (tile.category === 'number' &&
      rack.tile.category === 'number' &&
      tile.suit === rack.tile.suit &&
      Math.abs(tile.rank - rack.tile.rank) <= 2));

export function packageNaturalWins(before: GameState, after: GameState): GameState {
  if (before === after || before.phase !== 'playing' || after.result?.type !== 'win') return after;
  const result = after.result;
  const evaluations = new Map<number, HuEvaluation>();
  const packageKinds = new Map<number, 'three-mouth' | 'three-pure' | 'global'>();
  let newPackages = 0;
  const events: PendingScoringEvent[] = after.pendingScoringEvents.map((event) => {
    if (event.type !== 'hu-resolved' || event.threeMouthResolution) return event;
    const player = before.players[event.winnerPlayerIndex]!;
    const tracked = before.threeMouthState[event.winnerPlayerIndex];
    const locked = before.legacyThreeMouth
      ? threeMouth(player.melds)
      : tracked?.status === 'active'
        ? tracked.payerPlayerIndex
        : null;
    const pure = threePure(player.melds);
    let payer: number | null = null,
      global = false,
      forcePure = false;
    let packageKind: 'three-mouth' | 'three-pure' | 'global' = 'global';
    if (
      locked !== null &&
      event.evaluation.patterns.includes('all-pungs') &&
      event.source !== 'rob-bu-gang'
    ) {
      payer = locked;
      packageKind = 'three-mouth';
      global = event.source === 'self-draw' || event.payerPlayerIndex === locked;
    } else if (
      event.source === 'discard' &&
      pure &&
      (event.evaluation.patterns.includes('pure-one-suit') || pure === 'wind')
    ) {
      payer = event.payerPlayerIndex;
      packageKind = 'three-pure';
      global = event.evaluation.patterns.includes('all-pungs') || pure === 'wind';
      forcePure = pure === 'wind';
    } else if (
      event.source === 'discard' &&
      event.evaluation.patterns.includes('global-single-wait')
    ) {
      const rack = before.globalRacks?.[event.winnerPlayerIndex];
      if (rack && inRack(event.winningTile, rack)) payer = event.payerPlayerIndex;
    }
    if (payer === null) return event;
    const patterns = HU_PATTERNS.filter(
      (p) =>
        (global && p === 'global-single-wait') ||
        (forcePure && p === 'pure-one-suit') ||
        (event.evaluation.patterns.includes(p) &&
          !(global && p === 'all-pungs') &&
          !(forcePure && p === 'mixed-one-suit')),
    );
    const baseEvaluation = { ...event.evaluation, patterns };
    const evaluation =
      before.ruleSetId === 'nanjing-open-duo'
        ? withSelfDrawFlowers(baseEvaluation)
        : baseEvaluation;
    evaluations.set(event.winnerPlayerIndex, evaluation);
    packageKinds.set(event.winnerPlayerIndex, packageKind);
    // A gang package may already have marked this self-draw. Higher-priority replacement counts once.
    if (!(event.source === 'self-draw' && before.gangPackage.status === 'active')) newPackages++;
    const transfers = getRuleSet(before.ruleSetId)
      .getHuScoreTransfers({
        source: 'self-draw',
        drawSource: 'wall-head',
        winnerPlayerIndex: event.winnerPlayerIndex,
        playerCount: before.players.length,
        evaluation,
      })
      .map((t) => ({ ...t, fromPlayerIndex: payer! }));
    return { ...event, evaluation, transfers, packageKind };
  });
  if (evaluations.size === 0) return after;
  return {
    ...after,
    pendingScoringEvents: events,
    handProgressFacts: {
      ...after.handProgressFacts,
      packageSettlementCount: after.handProgressFacts.packageSettlementCount + newPackages,
    },
    result:
      result.source === 'self-draw'
        ? {
            ...result,
            winner: {
              ...result.winner,
              ...(before.ruleSetId === 'nanjing-open-duo' &&
              packageKinds.has(result.winner.playerIndex)
                ? { packageKind: packageKinds.get(result.winner.playerIndex)! }
                : {}),
              evaluation: evaluations.get(result.winner.playerIndex) ?? result.winner.evaluation,
            },
          }
        : {
            ...result,
            winners: result.winners.map((w) => ({
              ...w,
              ...(before.ruleSetId === 'nanjing-open-duo' && packageKinds.has(w.playerIndex)
                ? { packageKind: packageKinds.get(w.playerIndex)! }
                : {}),
              evaluation: evaluations.get(w.playerIndex) ?? w.evaluation,
            })),
          },
  };
}
export function forcedPatterns(
  patterns: readonly HuPattern[],
  global: boolean,
  pure: boolean,
): HuPattern[] {
  return HU_PATTERNS.filter(
    (p) =>
      (global ? p === 'global-single-wait' : p === 'all-pungs') ||
      (pure && p === 'pure-one-suit') ||
      (patterns.includes(p) &&
        !(pure && p === 'mixed-one-suit') &&
        ![
          'all-pungs',
          'global-single-wait',
          'seven-pairs',
          'dragon-seven-pairs',
          'tian-hu',
        ].includes(p)),
  );
}

export function forceFourthMeld(before: GameState, after: GameState): GameState {
  if (before === after || before.phase !== 'playing') return after;
  for (let index = 0; index < after.players.length; index++) {
    let player = after.players[index]!;
    const old = before.players[index]!;
    const meld = player.melds[3];
    if (
      old.melds.length !== 3 ||
      player.melds.length !== 4 ||
      !meld ||
      !['peng', 'ming-gang', 'an-gang'].includes(meld.type)
    )
      continue;
    const mouth = before.legacyThreeMouth ? threeMouth(old.melds) : null,
      pure = threePure(old.melds);
    const pureTrigger =
      pure !== null && meld.type !== 'an-gang' && meld.tiles.every((t) => category(t) === pure);
    if (mouth === null && !pureTrigger) continue;
    const global = mouth === null || meld.type === 'an-gang' || mouth === meld.fromPlayerIndex;
    if (meld.type !== 'peng') {
      // The base reducer validates and forms the real meld. Discard its provisional
      // replacement chain before recording the immediate forced settlement.
      const used = new Set(meld.tiles.map((t) => t.id));
      player = {
        ...player,
        hand: old.hand.filter((t) => !used.has(t.id)),
        flowers: old.flowers,
        buGangDrawProvenance: old.buGangDrawProvenance.filter((p) => !used.has(p.tileId)),
      };
      const gangEvent = after.pendingScoringEvents
        .slice(before.pendingScoringEvents.length)
        .filter(
          (e) =>
            (e.type === 'an-gang-created' || e.type === 'ming-gang-created') &&
            e.meldId === meld.id,
        );
      if (gangEvent.length !== 1) return before;
      after = {
        ...after,
        wall: [...before.wall],
        players: after.players.map((p, i) => (i === index ? player : p)),
        pendingScoringEvents: [...before.pendingScoringEvents, ...gangEvent],
        handProgressFacts: {
          ...before.handProgressFacts,
          successfulAnGangCount:
            before.handProgressFacts.successfulAnGangCount + (meld.type === 'an-gang' ? 1 : 0),
          successfulMingOrBuGangCount:
            before.handProgressFacts.successfulMingOrBuGangCount +
            (meld.type === 'ming-gang' ? 1 : 0),
        },
      };
    }
    const patterns: HuPattern[] = [];
    const all = [...player.hand, ...player.melds.flatMap((m) => m.tiles)];
    const suits = new Set(all.filter((t) => t.category === 'number').map((t) => t.suit));
    const winds = all.some((t) => t.category === 'wind');
    if (player.melds.every((m) => m.type !== 'peng')) patterns.push('men-qing');
    if (suits.size === 1 && winds) patterns.push('mixed-one-suit');
    if (suits.size === 1 && !winds) patterns.push('pure-one-suit');
    if (player.flowers.length === 0) patterns.push('no-flower');
    if (before.diHuDeclarations?.declarations.some((d) => d.playerIndex === index))
      patterns.push('di-hu');
    const source = meld.type === 'an-gang' ? before.selfDrawProvenance : undefined;
    if (source?.playerIndex === index) {
      if (
        ['ming-gang-tail', 'an-gang-tail', 'bu-gang-tail'].includes(source.source) ||
        (source.source === 'flower-replacement' && source.formedFlowerKongDuringReplacement)
      )
        patterns.push('gang-kai');
      else if (source.source === 'flower-replacement') patterns.push('hua-kai');
    }
    const normalized = forcedPatterns(patterns, global, mouth === null);
    const softFlowerItems: SoftFlowerItem[] = [];
    if (
      !normalized.includes('pure-one-suit') &&
      !normalized.includes('mixed-one-suit') &&
      suits.size === 2
    )
      softFlowerItems.push({ kind: 'missing-suit', count: 1 });
    const exposed = player.melds.filter(
      (m) => m.type === 'ming-gang' || m.type === 'bu-gang',
    ).length;
    const concealed = player.melds.filter((m) => m.type === 'an-gang').length * 2;
    const windsCount = player.melds.filter((m) => m.tiles[0]?.category === 'wind').length;
    if (exposed) softFlowerItems.push({ kind: 'exposed-kong', count: exposed });
    if (concealed) softFlowerItems.push({ kind: 'concealed-kong', count: concealed });
    if (windsCount) softFlowerItems.push({ kind: 'wind-triplet', count: windsCount });
    const baseEvaluation = {
      patterns: normalized,
      hardFlowerCount: player.flowers.length,
      softFlowerCount: softFlowerItems.reduce((sum, item) => sum + item.count, 0),
      softFlowerItems,
    };
    const evaluation =
      before.ruleSetId === 'nanjing-open-duo'
        ? withSelfDrawFlowers(baseEvaluation)
        : baseEvaluation;
    const payer = mouth ?? meld.fromPlayerIndex;
    if (payer === undefined) return before;
    const result: PackageHandResult = {
      type: 'package',
      kind: mouth === null ? 'three-pure' : 'three-mouth',
      winnerPlayerIndex: index,
      payerPlayerIndex: payer,
      evaluation,
    };
    return {
      ...after,
      phase: 'ended',
      turnStage: 'hand-ended',
      pendingAction: { type: 'none', playerIndex: null, seat: null },
      reactionWindow: undefined,
      selfDrawProvenance: undefined,
      gangPackage: { status: 'none' },
      result,
      pendingScoringEvents: [
        ...after.pendingScoringEvents,
        {
          type: 'package-resolved',
          result,
          transfers: forcedPackageTransfers(evaluation, index, payer, before.players.length),
          status: 'pending',
        },
      ],
      handProgressFacts: {
        ...after.handProgressFacts,
        packageSettlementCount: after.handProgressFacts.packageSettlementCount + 1,
      },
    };
  }
  return after;
}
