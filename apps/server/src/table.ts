import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  applyAction,
  createMatch,
  completeCurrentHand,
  prepareNextHand,
  settlePendingScoringEvents,
  getAvailableAnGangs,
  getAvailableBuGangs,
  getAvailableSelfDrawHu,
  getAvailableDiHuDecision,
  explainNanjingScore,
} from '@nanjing-mahjong/game-core';
import type { GameAction, MatchState, Tile, OrdinaryTileFace } from '@nanjing-mahjong/game-core';
import type { RoomView, ActionChoice, ScoreLine, TileView } from '@nanjing-mahjong/shared-types';

export interface Member {
  session: string;
  name: string;
  ready: boolean;
  joined: number;
}
export const HAND_REVIEW_MS = 45_000;
export interface SavedRoom {
  format: 1;
  rules: 'V1.0.8';
  id: string;
  host: number;
  members: (Member | null)[];
  status: RoomView['status'];
  revision: number;
  epoch: number;
  match?: MatchState;
  reactions: Record<string, string>;
  scores: ScoreLine[];
  remainingMs: number | null;
  nextHandReady?: number[];
}
export const newRoom = (session: string, name: string): SavedRoom => ({
  format: 1,
  rules: 'V1.0.8',
  id: randomBytes(9).toString('base64url'),
  host: 0,
  members: [{ session, name, ready: false, joined: Date.now() }, null, null, null],
  status: 'waiting',
  revision: 1,
  epoch: 0,
  reactions: {},
  scores: [],
  remainingMs: null,
});
const names: Record<string, string> = {
  east: '东',
  south: '南',
  west: '西',
  north: '北',
  'red-center': '中',
  fortune: '发',
  'white-board': '白',
  plum: '梅',
  orchid: '兰',
  bamboo: '竹',
  chrysanthemum: '菊',
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};
export function tileView(tile: Tile): TileView {
  return {
    id: tile.id,
    family: tile.category === 'number' ? tile.suit : tile.category,
    label:
      tile.category === 'number'
        ? String(tile.rank) + { wan: '万', tiao: '条', tong: '筒' }[tile.suit]
        : (names[tile.category === 'wind' ? tile.wind : tile.flower] ?? '?'),
  };
}
export const faceLabel = (face: OrdinaryTileFace): string =>
  face.category === 'wind'
    ? names[face.wind]!
    : String(face.rank) + { wan: '万', tiao: '条', tong: '筒' }[face.suit];
export const paused = (room: SavedRoom, online: Set<string>): boolean =>
  room.status === 'playing' &&
  room.members.some((member) => !member || !online.has(member.session));

export function start(room: SavedRoom): void {
  room.match = createMatch({ dealerIndex: randomInt(4) });
  room.status = 'playing';
  room.scores = [];
  room.reactions = {};
  room.remainingMs = null;
  startHand(room);
}
function startHand(room: SavedRoom): void {
  room.nextHandReady = [];
  if (!room.match) return;
  // startCurrentHand settles internally; start the hand explicitly so audit snapshots are retained.
  const ready = room.match;
  const wall = [...ready.currentHand.wall];
  for (let i = wall.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [wall[i], wall[j]] = [wall[j]!, wall[i]!];
  }
  const game = applyAction({ ...ready.currentHand, wall }, { type: 'START_GAME' });
  room.match = { ...ready, status: 'playing', currentHandStatus: 'playing', currentHand: game };
  settle(room);
  room.epoch++;
  advance(room);
}
function settle(room: SavedRoom): void {
  const match = room.match;
  if (!match) return;
  for (const event of match.currentHand.pendingScoringEvents) {
    room.scores.push({
      hand: match.currentHandIndex + 1,
      reason:
        event.type === 'hu-resolved'
          ? [event.packageKind, event.source, ...event.evaluation.patterns]
              .filter(Boolean)
              .join('、')
          : event.type === 'package-resolved'
            ? event.result.kind + '、' + event.result.evaluation.patterns.join('、')
            : event.type === 'special-discard'
              ? event.source
              : event.type,
      transfers: event.transfers.map((t) => ({
        from: t.fromPlayerIndex,
        to: t.toPlayerIndex,
        amount: t.amount,
      })),
      calculation: explainNanjingScore(event),
      ...(event.type === 'hu-resolved'
        ? {
            winningHand: {
              concealed: match.currentHand.players[event.winnerPlayerIndex]!.hand.filter(
                (t) => t.id !== event.winningTile.id,
              )
                .map(tileView)
                .sort((a, b) => a.id.localeCompare(b.id)),
              winningTile: tileView(event.winningTile),
              melds: match.currentHand.players[event.winnerPlayerIndex]!.melds.map((m) => ({
                kind: m.type,
                tiles: m.tiles.map(tileView),
              })),
              flowers: match.currentHand.players[event.winnerPlayerIndex]!.flowers.map(tileView),
            },
          }
        : {}),
    });
  }
  room.match = settlePendingScoringEvents(match);
}
export function apply(room: SavedRoom, action: GameAction): void {
  if (!room.match) throw new Error('牌局尚未开始');
  const before = room.match.currentHand;
  const after = applyAction(before, action);
  if (after === before) throw new Error('该操作已失效或不合法');
  room.match = { ...room.match, currentHand: after };
  settle(room);
}
export function advance(room: SavedRoom): void {
  for (let guard = 0; guard < 200; guard++) {
    const match = room.match;
    if (!match || room.status !== 'playing') return;
    const game = match.currentHand;
    if (game.phase === 'ended') {
      if (match.currentHandStatus !== 'completed') room.match = completeCurrentHand(match);
      if (room.match!.status === 'completed') {
        room.status = 'completed';
        room.remainingMs = null;
      } else room.remainingMs ??= HAND_REVIEW_MS;
      return;
    }
    if (game.turnStage === 'waiting-for-draw') {
      apply(room, { type: 'DRAW_TILE' });
      room.epoch++;
      continue;
    }
    const window = game.reactionWindow;
    if (game.turnStage === 'waiting-for-reaction' && window) {
      if (window.status === 'awaiting-resolution') {
        apply(room, { type: 'RESOLVE_REACTION_WINDOW' });
        room.reactions = {};
        room.epoch++;
        continue;
      }
      for (const available of window.availableReactions) {
        if (available.responseTypes.every((type) => type === 'pass'))
          room.reactions[String(available.playerIndex)] = 'pass';
      }
      if (!window.responderOrder.every((r) => room.reactions[String(r.playerIndex)])) return;
      for (const responder of window.responderOrder) {
        const type = room.reactions[String(responder.playerIndex)] as
          'pass' | 'hu' | 'peng' | 'ming-gang';
        apply(room, {
          type: 'SUBMIT_REACTION',
          playerIndex: responder.playerIndex,
          responseType: type,
        });
      }
      continue;
    }
    return;
  }
  throw new Error('自动推进超出安全边界');
}
export function reviewToken(room: SavedRoom, secret: string): string {
  return createHmac('sha256', secret)
    .update(room.id + ':' + room.epoch + ':next:' + room.match?.currentHandIndex)
    .digest('hex');
}
export function confirmNextHand(
  room: SavedRoom,
  seat: number,
  token: string | undefined,
  online: Set<string>,
  secret: string,
): void {
  if (
    room.status !== 'playing' ||
    room.remainingMs === null ||
    room.match?.currentHandStatus !== 'completed' ||
    token !== reviewToken(room, secret)
  )
    throw new Error('本局结算已结束，请刷新牌局状态');
  if (paused(room, online)) throw new Error('有玩家掉线，等待重连后再开始');
  room.nextHandReady = [...new Set([...(room.nextHandReady ?? []), seat])];
  if (room.nextHandReady.length === 4) nextHand(room);
}
export function nextHand(room: SavedRoom): void {
  if (!room.match || room.match.currentHandStatus !== 'completed') return;
  room.match = prepareNextHand(room.match);
  room.remainingMs = null;
  room.reactions = {};
  startHand(room);
}
export function choices(
  room: SavedRoom,
  seat: number,
  secret: string,
): { view: ActionChoice; action: GameAction }[] {
  const state = room.match?.currentHand;
  if (room.status !== 'playing' || !state || state.phase !== 'playing') return [];
  const result: { view: ActionChoice; action: GameAction }[] = [];
  const add = (action: GameAction, label: string, kind: string, tileId?: string) => {
    const token = createHmac('sha256', secret)
      .update(JSON.stringify([room.id, room.epoch, seat, action]))
      .digest('base64url');
    result.push({ action, view: { token, label, kind, ...(tileId ? { tileId } : {}) } });
  };
  if (state.turnStage === 'waiting-for-reaction') {
    if (!room.reactions[String(seat)]) {
      const availability = state.reactionWindow?.availableReactions.find(
        (a) => a.playerIndex === seat,
      );
      for (const responseType of availability?.responseTypes ?? []) {
        add(
          { type: 'SUBMIT_REACTION', playerIndex: seat, responseType },
          { pass: '过', hu: '胡', peng: '碰', 'ming-gang': '明杠' }[responseType],
          responseType,
        );
      }
    }
    return result;
  }
  if (getAvailableDiHuDecision(state, seat)) {
    add(
      { type: 'SUBMIT_DI_HU_DECISION', playerIndex: seat, decision: 'declare' },
      '报地胡',
      'di-hu',
    );
    add({ type: 'SUBMIT_DI_HU_DECISION', playerIndex: seat, decision: 'pass' }, '不报', 'pass');
    return result;
  }
  if (state.currentPlayerIndex !== seat || state.turnStage !== 'waiting-for-discard') return result;
  for (const tile of state.players[seat]!.hand) {
    const action: GameAction = { type: 'DISCARD_TILE', tileId: tile.id };
    if (applyAction(state, action) !== state) add(action, '出牌', 'discard', tile.id);
  }
  for (const face of getAvailableAnGangs(state, seat)) {
    const action: GameAction = { type: 'DECLARE_AN_GANG', playerIndex: seat, tileFace: face };
    if (applyAction(state, action) !== state) add(action, '暗杠 ' + faceLabel(face), 'an-gang');
  }
  for (const candidate of getAvailableBuGangs(state, seat))
    add(
      { type: 'DECLARE_BU_GANG', playerIndex: seat, meldId: candidate.targetMeldId },
      '补杠 ' + faceLabel(candidate.tileFace),
      'bu-gang',
    );
  if (getAvailableSelfDrawHu(state, seat))
    add({ type: 'DECLARE_SELF_DRAW_HU', playerIndex: seat }, '自摸胡', 'hu');
  return result;
}
export function view(
  room: SavedRoom,
  session: string,
  online: Set<string>,
  secret: string,
): RoomView {
  const self = room.members.findIndex((m) => m?.session === session);
  const match = room.match,
    game = match?.currentHand;
  const stopped = paused(room, online);
  const diHuStage = game?.turnStage === 'waiting-for-di-hu-decision';
  return {
    id: room.id,
    revision: room.revision,
    self,
    host: room.host,
    status: room.status,
    paused: stopped,
    players: room.members.map((member, seat) => {
      if (!member) return null;
      const player = game?.players[seat];
      return {
        seat,
        name: member.name,
        connected: online.has(member.session),
        ready: member.ready,
        handCount: player?.hand.length ?? 0,
        ...(seat === self
          ? {
              hand: [...(player?.hand ?? [])]
                .sort((a, b) => {
                  const order = (t: typeof a) =>
                    t.category === 'wind'
                      ? 40 + ['east', 'south', 'west', 'north'].indexOf(t.wind)
                      : ['wan', 'tiao', 'tong'].indexOf(t.suit) * 10 + t.rank;
                  return order(a) - order(b) || a.id.localeCompare(b.id);
                })
                .map(tileView),
              ...(game?.selfDrawProvenance?.playerIndex === seat &&
              player?.hand.some((t) => t.id === game.selfDrawProvenance?.tileId)
                ? { drawnTileId: game.selfDrawProvenance.tileId }
                : {}),
            }
          : {}),
        flowers: player?.flowers.map(tileView) ?? [],
        melds:
          player?.melds.map((m) => ({
            kind: m.type,
            tiles: m.tiles.map(tileView),
            ...(m.claimedTileId ? { claimedTileId: m.claimedTileId } : {}),
            ...(m.fromPlayerIndex !== undefined ? { fromSeat: m.fromPlayerIndex } : {}),
          })) ?? [],
        discards:
          player?.discardPile.filter((d) => !d.claimedByMeldId).map((d) => tileView(d.tile)) ?? [],
        diHu: game?.diHuDeclarations?.declarations.some((d) => d.playerIndex === seat) ?? false,
        score: match?.cumulativeScores[seat] ?? 1000,
        ...(game?.globalRacks?.[seat]?.active
          ? { rack: tileView(game.globalRacks[seat]!.tile) }
          : {}),
      };
    }),
    hand: (match?.currentHandIndex ?? 0) + 1,
    effectiveTurn: match?.effectiveDealerTurn ?? 1,
    dealer: match?.dealerIndex ?? 0,
    current:
      diHuStage || game?.turnStage === 'waiting-for-reaction'
        ? null
        : (game?.currentPlayerIndex ?? null),
    remaining: game?.wall.length ?? 0,
    phase: game?.turnStage ?? 'waiting',
    actions: { choices: stopped ? [] : choices(room, self, secret).map((c) => c.view) },
    scores: room.scores.slice(-100),
    result: game?.result ? (game.result.type === 'draw' ? '流局' : '本局结算') : null,
    ...(room.status === 'playing' && room.remainingMs !== null
      ? {
          nextHandReady: [...(room.nextHandReady ?? [])],
          nextHandToken: reviewToken(room, secret),
        }
      : {}),
    nextHandSeconds: room.remainingMs === null ? null : Math.ceil(room.remainingMs / 1000),
    ...(game?.lastDiscard ? { lastDiscard: tileView(game.lastDiscard.tile) } : {}),
  };
}
