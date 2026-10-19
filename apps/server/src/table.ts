import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  applyAction,
  createGame,
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
import type {
  GameAction,
  GameState,
  MatchState,
  Tile,
  OrdinaryTileFace,
} from '@nanjing-mahjong/game-core';
import type {
  RoomView,
  ActionChoice,
  ScoreLine,
  TableEvent,
  TableScoreChange,
  TileView,
  PublicTableTile,
  PublicScoreLine,
} from '@nanjing-mahjong/shared-types';

export interface Member {
  session: string;
  name: string;
  ready: boolean;
  joined: number;
}
export const HAND_REVIEW_MS = 45_000;
export interface SavedRoom {
  format: 1;
  rules: 'V1.0.8' | 'V1.0.9' | 'V1.0.10' | 'V1.0.11';
  id: string;
  host: number;
  members: (Member | null)[];
  status: RoomView['status'];
  revision: number;
  epoch: number;
  match?: MatchState;
  reactions: Record<string, string>;
  scores: ScoreLine[];
  tableEventSchemaVersion: 1 | 2;
  tableEvents: TableEvent[];
  nextTableEventId: number;
  nextTableEventSequence: number;
  remainingMs: number | null;
  nextHandReady?: number[];
}
export const newRoom = (session: string, name: string): SavedRoom => ({
  format: 1,
  rules: 'V1.0.11',
  id: randomBytes(9).toString('base64url'),
  host: 0,
  members: [{ session, name, ready: false, joined: Date.now() }, null, null, null],
  status: 'waiting',
  revision: 1,
  epoch: 0,
  reactions: {},
  scores: [],
  tableEventSchemaVersion: 2,
  tableEvents: [],
  nextTableEventId: 1,
  nextTableEventSequence: 1,
  remainingMs: null,
});
export class TableEventArchiveError extends Error {
  constructor(
    readonly kind: 'missing' | 'corrupt' | 'unsupported',
    detail: string,
  ) {
    super(`牌桌事件存档兼容性错误：${detail}`);
  }
}
type TableEventInput = TableEvent extends infer Event
  ? Event extends TableEvent
    ? Omit<Event, 'id' | 'sequence'>
    : never
  : never;
const tableEventTypes = new Set<TableEvent['type']>([
  'hand-started',
  'tile-drawn',
  'tile-discarded',
  'flower-replaced',
  'peng',
  'ming-gang',
  'an-gang',
  'bu-gang',
  'hu',
  'draw',
  'score-changed',
  'special-rule-confirmed',
  'mouth-locked',
  'hand-settled',
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const isSeat = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) < 4;
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function parsePublicTile(value: unknown): { family: string; label: string } | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['family', 'label']) ||
    typeof value.family !== 'string' ||
    typeof value.label !== 'string'
  )
    return null;
  return { family: value.family, label: value.label };
}
function parseScoreChanges(value: unknown): TableScoreChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes: TableScoreChange[] = [];
  for (const change of value) {
    if (
      !isRecord(change) ||
      !hasOnlyKeys(change, ['seat', 'delta']) ||
      !isSeat(change.seat) ||
      !Number.isSafeInteger(change.delta) ||
      changes.some(({ seat }) => seat === change.seat)
    )
      return null;
    changes.push({ seat: change.seat, delta: Number(change.delta) });
  }
  return changes;
}
function parseSeats(value: unknown, allowEmpty = false): number[] | null {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((seat) => !isSeat(seat)) ||
    new Set(value).size !== value.length
  )
    return null;
  return [...value] as number[];
}
function invalidTableEvent(): never {
  throw new TableEventArchiveError('corrupt', '事件字段损坏');
}
function parseTableEvent(value: unknown): TableEvent {
  if (
    !isRecord(value) ||
    !isPositiveSafeInteger(value.id) ||
    !isPositiveSafeInteger(value.sequence) ||
    !isPositiveSafeInteger(value.hand) ||
    typeof value.type !== 'string' ||
    !tableEventTypes.has(value.type as TableEvent['type'])
  )
    return invalidTableEvent();
  const base = { id: value.id, sequence: value.sequence, hand: value.hand };
  switch (value.type) {
    case 'special-rule-confirmed':
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'rule', 'seat']) ||
        !isSeat(value.seat) ||
        (value.rule !== 'flower-kong' &&
          value.rule !== 'four-winds-gathered' &&
          value.rule !== 'follow-discard')
      )
        return invalidTableEvent();
      return { ...base, type: value.type, rule: value.rule, seat: value.seat };
    case 'mouth-locked':
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'mouths']) ||
        !isSeat(value.seat) ||
        !isSeat(value.fromSeat) ||
        value.seat === value.fromSeat ||
        (value.mouths !== 2 && value.mouths !== 3)
      )
        return invalidTableEvent();
      return {
        ...base,
        type: value.type,
        seat: value.seat,
        fromSeat: value.fromSeat,
        mouths: value.mouths,
      };
    case 'hand-started':
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'dealer']) ||
        !isSeat(value.dealer)
      )
        return invalidTableEvent();
      return { ...base, type: value.type, dealer: value.dealer };
    case 'tile-drawn':
      if (!hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat']) || !isSeat(value.seat))
        return invalidTableEvent();
      return { ...base, type: value.type, seat: value.seat };
    case 'tile-discarded': {
      const tile = parsePublicTile(value.tile);
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat', 'tile']) ||
        !isSeat(value.seat) ||
        !tile
      )
        return invalidTableEvent();
      return { ...base, type: value.type, seat: value.seat, tile };
    }
    case 'flower-replaced': {
      const flower = parsePublicTile(value.flower);
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat', 'flower']) ||
        !isSeat(value.seat) ||
        !flower
      )
        return invalidTableEvent();
      return { ...base, type: value.type, seat: value.seat, flower };
    }
    case 'peng':
    case 'ming-gang':
    case 'bu-gang': {
      const tile = parsePublicTile(value.tile);
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'tile']) ||
        !isSeat(value.seat) ||
        !isSeat(value.fromSeat) ||
        value.seat === value.fromSeat ||
        !tile
      )
        return invalidTableEvent();
      return { ...base, type: value.type, seat: value.seat, fromSeat: value.fromSeat, tile };
    }
    case 'an-gang': {
      const tile = parsePublicTile(value.tile);
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'seat', 'tile']) ||
        !isSeat(value.seat) ||
        !tile
      )
        return invalidTableEvent();
      return { ...base, type: value.type, seat: value.seat, tile };
    }
    case 'hu': {
      const winnerSeats = parseSeats(value.winnerSeats);
      const keys = ['id', 'sequence', 'type', 'hand', 'winnerSeats', 'fromSeat', 'summary'];
      if (Object.hasOwn(value, 'responsibleSeat')) keys.push('responsibleSeat');
      if (
        !hasOnlyKeys(value, keys) ||
        !winnerSeats ||
        !(value.fromSeat === null || isSeat(value.fromSeat)) ||
        (Object.hasOwn(value, 'responsibleSeat') && !isSeat(value.responsibleSeat)) ||
        typeof value.summary !== 'string'
      )
        return invalidTableEvent();
      return {
        ...base,
        type: value.type,
        winnerSeats,
        fromSeat: value.fromSeat,
        ...(Object.hasOwn(value, 'responsibleSeat')
          ? { responsibleSeat: value.responsibleSeat as number }
          : {}),
        summary: value.summary,
      };
    }
    case 'draw':
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'summary']) ||
        typeof value.summary !== 'string'
      )
        return invalidTableEvent();
      return { ...base, type: value.type, summary: value.summary };
    case 'score-changed': {
      const changes = parseScoreChanges(value.changes);
      if (
        !hasOnlyKeys(value, ['id', 'sequence', 'type', 'hand', 'changes', 'reason']) ||
        !changes ||
        changes.length === 0 ||
        typeof value.reason !== 'string'
      )
        return invalidTableEvent();
      return { ...base, type: value.type, changes, reason: value.reason };
    }
    case 'hand-settled': {
      const winnerSeats = parseSeats(value.winnerSeats, value.result === 'draw');
      const changes = parseScoreChanges(value.changes);
      if (
        !hasOnlyKeys(value, [
          'id',
          'sequence',
          'type',
          'hand',
          'result',
          'winnerSeats',
          'changes',
          'summary',
        ]) ||
        (value.result !== 'hu' && value.result !== 'draw') ||
        !winnerSeats ||
        (value.result === 'draw' ? winnerSeats.length !== 0 : winnerSeats.length === 0) ||
        !changes ||
        typeof value.summary !== 'string'
      )
        return invalidTableEvent();
      return {
        ...base,
        type: value.type,
        result: value.result,
        winnerSeats,
        changes,
        summary: value.summary,
      };
    }
  }
  return invalidTableEvent();
}
function restoreTableEvents(room: Record<string, unknown>): void {
  const fields = [
    'tableEventSchemaVersion',
    'tableEvents',
    'nextTableEventId',
    'nextTableEventSequence',
  ] as const;
  const present = fields.map((field) => Object.hasOwn(room, field));
  if (present.every((value) => !value)) {
    room.tableEventSchemaVersion = 1;
    room.tableEvents = [];
    room.nextTableEventId = 1;
    room.nextTableEventSequence = 1;
    return;
  }
  if (!present[0]) throw new TableEventArchiveError('missing', '版本标记缺失但事件字段存在');
  if (room.tableEventSchemaVersion !== 1 && room.tableEventSchemaVersion !== 2)
    throw new TableEventArchiveError('unsupported', '不支持的事件存档版本');
  if (!present[1]) {
    if (
      present[2] &&
      present[3] &&
      isPositiveSafeInteger(room.nextTableEventId) &&
      isPositiveSafeInteger(room.nextTableEventSequence)
    )
      throw new TableEventArchiveError('missing', '事件历史字段缺失');
    throw new TableEventArchiveError(
      present[2] && present[3] ? 'corrupt' : 'missing',
      '事件历史或计数器字段不完整',
    );
  }
  if (!present[2] || !present[3]) throw new TableEventArchiveError('missing', '事件计数器字段缺失');
  if (
    !Array.isArray(room.tableEvents) ||
    !isPositiveSafeInteger(room.nextTableEventId) ||
    !isPositiveSafeInteger(room.nextTableEventSequence)
  )
    throw new TableEventArchiveError('corrupt', '事件历史或计数器字段损坏');
  const events = room.tableEvents.map(parseTableEvent);
  if (
    room.tableEventSchemaVersion === 1 &&
    events.some((event) => event.type === 'special-rule-confirmed' || event.type === 'mouth-locked')
  )
    throw new TableEventArchiveError('corrupt', '版本 1 含新增事件类型');
  for (let index = 1; index < events.length; index++) {
    if (
      events[index]!.id <= events[index - 1]!.id ||
      events[index]!.sequence <= events[index - 1]!.sequence
    )
      throw new TableEventArchiveError('corrupt', '事件编号重复或顺序错误');
  }
  const last = events.at(-1);
  if (last && (room.nextTableEventId <= last.id || room.nextTableEventSequence <= last.sequence))
    throw new TableEventArchiveError('corrupt', '事件计数器与历史冲突');
  if (events.length > 100)
    console.warn(`牌桌事件历史超过 100 条，已裁剪 ${events.length - 100} 条旧记录`);
  room.tableEvents = events.slice(-100);
}
/** Upgrade rule metadata without rewriting history; preserve the V1.0.8 three-mouth flow. */
export function restoreRoomRules<T extends SavedRoom>(room: T): T {
  if (room.format !== 1 || !['V1.0.8', 'V1.0.9', 'V1.0.10', 'V1.0.11'].includes(room.rules))
    throw new Error('房间存档版本不兼容');
  restoreTableEvents(room as unknown as Record<string, unknown>);
  if (room.rules === 'V1.0.9' || room.rules === 'V1.0.10') room.rules = 'V1.0.11';
  if (room.rules === 'V1.0.8' && room.match) {
    room.match = {
      ...room.match,
      currentHand: {
        ...room.match.currentHand,
        legacyThreeMouth: true,
        threeMouthState: createGame().threeMouthState,
      },
    };
  }
  return room;
}
export function appendTableEvents(
  room: SavedRoom,
  inputs: readonly TableEventInput[],
): TableEvent[] {
  if (
    !isPositiveSafeInteger(room.nextTableEventId) ||
    !isPositiveSafeInteger(room.nextTableEventSequence) ||
    room.nextTableEventId + inputs.length > Number.MAX_SAFE_INTEGER ||
    room.nextTableEventSequence + inputs.length > Number.MAX_SAFE_INTEGER
  )
    throw new Error('牌桌事件编号已达到安全上限');
  const appended = inputs.map((input, index) =>
    parseTableEvent({
      ...input,
      id: room.nextTableEventId + index,
      sequence: room.nextTableEventSequence + index,
    }),
  );
  room.nextTableEventId += appended.length;
  room.nextTableEventSequence += appended.length;
  if (appended.length) room.tableEventSchemaVersion = 2;
  room.tableEvents = [...room.tableEvents, ...appended].slice(-100);
  return appended;
}
function publicTableEvent(event: TableEvent): TableEvent {
  const keysByType: Record<TableEvent['type'], string[]> = {
    'hand-started': ['id', 'sequence', 'type', 'hand', 'dealer'],
    'tile-drawn': ['id', 'sequence', 'type', 'hand', 'seat'],
    'tile-discarded': ['id', 'sequence', 'type', 'hand', 'seat', 'tile'],
    'flower-replaced': ['id', 'sequence', 'type', 'hand', 'seat', 'flower'],
    peng: ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'tile'],
    'ming-gang': ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'tile'],
    'an-gang': ['id', 'sequence', 'type', 'hand', 'seat', 'tile'],
    'bu-gang': ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'tile'],
    hu: ['id', 'sequence', 'type', 'hand', 'winnerSeats', 'fromSeat', 'summary'],
    draw: ['id', 'sequence', 'type', 'hand', 'summary'],
    'score-changed': ['id', 'sequence', 'type', 'hand', 'changes', 'reason'],
    'special-rule-confirmed': ['id', 'sequence', 'type', 'hand', 'rule', 'seat'],
    'mouth-locked': ['id', 'sequence', 'type', 'hand', 'seat', 'fromSeat', 'mouths'],
    'hand-settled': [
      'id',
      'sequence',
      'type',
      'hand',
      'result',
      'winnerSeats',
      'changes',
      'summary',
    ],
  };
  const source = event as unknown as Record<string, unknown>;
  const keys = [...keysByType[event.type]];
  if (event.type === 'hu' && Object.hasOwn(event, 'responsibleSeat')) keys.push('responsibleSeat');
  const projected = Object.fromEntries(keys.map((key) => [key, source[key]]));
  if (isRecord(projected.tile))
    projected.tile = { family: projected.tile.family, label: projected.tile.label };
  if (isRecord(projected.flower))
    projected.flower = { family: projected.flower.family, label: projected.flower.label };
  if (Array.isArray(projected.winnerSeats)) projected.winnerSeats = [...projected.winnerSeats];
  if (Array.isArray(projected.changes))
    projected.changes = projected.changes.map((change) =>
      isRecord(change) ? { seat: change.seat, delta: change.delta } : change,
    );
  return parseTableEvent(projected);
}
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

function publicTile(tile: Tile): { family: string; label: string } {
  const { family, label } = tileView(tile);
  return { family, label };
}

const publicFace = ({ family, label }: PublicTableTile): PublicTableTile => ({ family, label });

function publicScore(score: ScoreLine): PublicScoreLine {
  const { winningHand, ...line } = score;
  return {
    ...line,
    ...(winningHand
      ? {
          winningHand: {
            concealed: winningHand.concealed.map(publicFace),
            melds: winningHand.melds.map((meld) => ({
              kind: meld.kind,
              tiles: meld.tiles.map(publicFace),
            })),
            flowers: winningHand.flowers.map(publicFace),
            winningTile: publicFace(winningHand.winningTile),
          },
        }
      : {}),
  };
}

function drawnEvents(hand: number, seat: number, tiles: readonly Tile[]): TableEventInput[] {
  return tiles.flatMap((tile): TableEventInput[] => [
    { type: 'tile-drawn', hand, seat },
    ...(tile.category === 'flower'
      ? [{ type: 'flower-replaced' as const, hand, seat, flower: publicTile(tile) }]
      : []),
  ]);
}

function actionEvents(
  room: SavedRoom,
  before: GameState,
  after: GameState,
  action: GameAction,
): TableEventInput[] {
  const hand = room.match!.currentHandIndex + 1;
  if (action.type === 'START_GAME') {
    if (before.phase !== 'ready' || after.phase === 'ready') return [];
    const events: TableEventInput[] = [{ type: 'hand-started', hand, dealer: after.dealerIndex }];
    // The remaining wall identifies the actual head/tail consumption of this accepted deal.
    const headCount = before.wall.findIndex((tile) => tile.id === after.wall[0]?.id);
    if (headCount < 0) throw new Error('开手牌墙消耗无法确认');
    const initialIds = new Set(before.wall.slice(0, headCount).map((tile) => tile.id));
    for (let offset = 0; offset < after.players.length; offset++) {
      const seat = (after.dealerIndex + offset) % after.players.length;
      for (const flower of after.players[seat]!.flowers.filter((tile) => initialIds.has(tile.id)))
        events.push({ type: 'flower-replaced', hand, seat, flower: publicTile(flower) });
    }
    for (const tile of before.wall.slice(headCount + after.wall.length).reverse()) {
      const seat = after.players.findIndex((player) =>
        [...player.hand, ...player.flowers].some((held) => held.id === tile.id),
      );
      if (seat < 0) throw new Error('补花归属无法确认');
      events.push(...drawnEvents(hand, seat, [tile]));
    }
    return events;
  }
  if (action.type === 'DISCARD_TILE' || action.type === 'DISCARDED_TILE') {
    const discard = after.lastDiscard;
    if (!discard || discard.tileId !== action.tileId) throw new Error('弃牌结果无法确认');
    return [
      {
        type: 'tile-discarded',
        hand,
        seat: discard.fromPlayerIndex,
        tile: publicTile(discard.tile),
      },
    ];
  }
  if (action.type === 'DRAW_TILE') {
    const count = before.wall.length - after.wall.length;
    if (count === 0) return [];
    const tiles = [before.wall[0]!, ...before.wall.slice(before.wall.length - count + 1).reverse()];
    return drawnEvents(hand, before.currentPlayerIndex, tiles);
  }
  const events: TableEventInput[] = [];
  for (const [seat, player] of after.players.entries()) {
    for (const meld of player.melds) {
      const previous = before.players[seat]!.melds.find((candidate) => candidate.id === meld.id);
      if (previous?.type === meld.type) continue;
      const tile = publicTile(meld.tiles[0]!);
      if (meld.type === 'an-gang') events.push({ type: 'an-gang', hand, seat, tile });
      else {
        if (meld.fromPlayerIndex === undefined) throw new Error('副露来源无法确认');
        events.push({ type: meld.type, hand, seat, fromSeat: meld.fromPlayerIndex, tile });
      }
      if (room.rules !== 'V1.0.8' && !after.legacyThreeMouth) {
        const prior = before.threeMouthState[seat]!;
        const current = after.threeMouthState[seat]!;
        if (current.status === 'active' && prior.status !== 'active')
          events.push({
            type: 'mouth-locked',
            hand,
            seat,
            fromSeat: current.payerPlayerIndex,
            mouths: 3,
          });
        else if (
          current.status === 'tracking' &&
          current.mouthCount === 2 &&
          current.lockedPayerPlayerIndex !== null &&
          !(
            prior.status === 'tracking' &&
            prior.mouthCount === 2 &&
            prior.lockedPayerPlayerIndex === current.lockedPayerPlayerIndex
          )
        )
          events.push({
            type: 'mouth-locked',
            hand,
            seat,
            fromSeat: current.lockedPayerPlayerIndex,
            mouths: 2,
          });
      }
      if (meld.type !== 'peng') {
        const count = before.wall.length - after.wall.length;
        events.push(...drawnEvents(hand, seat, count ? before.wall.slice(-count).reverse() : []));
      }
    }
  }
  return events;
}

function specialRuleEvents(hand: number, before: GameState, after: GameState): TableEventInput[] {
  return after.pendingScoringEvents
    .slice(before.pendingScoringEvents.length)
    .flatMap((event): TableEventInput[] => {
      if (event.type === 'flower-kong-created')
        return [
          { type: 'special-rule-confirmed', hand, rule: 'flower-kong', seat: event.playerIndex },
        ];
      if (event.type === 'special-discard' && event.source === 'four-winds-gathered')
        return [
          { type: 'special-rule-confirmed', hand, rule: event.source, seat: event.playerIndex },
        ];
      if (event.type === 'special-discard' && event.source === 'follow-discard')
        return [
          {
            type: 'special-rule-confirmed',
            hand,
            rule: event.source,
            seat: event.initiatorPlayerIndex,
          },
        ];
      return [];
    });
}

function scoreChanges(scores: readonly ScoreLine[]): TableScoreChange[] {
  const deltas = [0, 0, 0, 0];
  for (const score of scores)
    for (const transfer of score.transfers) {
      deltas[transfer.from]! -= transfer.amount;
      deltas[transfer.to]! += transfer.amount;
    }
  return deltas.map((delta, seat) => ({ seat, delta }));
}

function handOutcome(game: GameState): { winnerSeats: number[]; summary: string } {
  const result = game.result;
  if (!result) throw new Error('本手结果尚未确认');
  if (result.type === 'draw') return { winnerSeats: [], summary: '牌墙耗尽，流局' };
  if (result.type === 'package')
    return {
      winnerSeats: [result.winnerPlayerIndex],
      summary: result.kind === 'three-pure' ? '三清胡牌' : '三嘴胡牌',
    };
  return {
    winnerSeats:
      result.source === 'self-draw'
        ? [result.winner.playerIndex]
        : result.winners.map((winner) => winner.playerIndex),
    summary: { 'self-draw': '自摸胡', discard: '点炮胡', 'rob-bu-gang': '抢补杠胡' }[result.source],
  };
}

function resultEvents(room: SavedRoom, before: GameState, after: GameState): TableEventInput[] {
  if (before.phase === 'ended' || after.phase !== 'ended') return [];
  const hand = room.match!.currentHandIndex + 1;
  const { winnerSeats, summary } = handOutcome(after);
  const result = after.result!;
  if (result.type === 'draw') return [{ type: 'draw', hand, summary }];
  const fromSeat =
    result.type === 'package'
      ? before.reactionWindow?.source === 'discard'
        ? before.reactionWindow.fromPlayerIndex
        : null
      : result.source === 'self-draw'
        ? null
        : (result.triggerPlayerIndex ?? result.payerPlayerIndex);
  return winnerSeats.map((seat): TableEventInput => {
    const score = after.pendingScoringEvents.find((event) =>
      event.type === 'hu-resolved'
        ? event.winnerPlayerIndex === seat
        : event.type === 'package-resolved' && event.result.winnerPlayerIndex === seat,
    );
    const payers = new Set(score?.transfers.map((transfer) => transfer.fromPlayerIndex));
    const responsibleSeat = payers.size === 1 ? [...payers][0] : undefined;
    return {
      type: 'hu',
      hand,
      winnerSeats: [seat],
      fromSeat,
      summary,
      ...(responsibleSeat !== undefined && responsibleSeat !== fromSeat ? { responsibleSeat } : {}),
    };
  });
}

export function start(room: SavedRoom): void {
  room.rules = 'V1.0.11';
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
  const before = {
    ...ready.currentHand,
    wall,
    ...(room.rules === 'V1.0.8' ? { legacyThreeMouth: true } : {}),
  };
  const action = { type: 'START_GAME' } as const;
  const game = applyAction(before, action);
  if (game === before) throw new Error('开手未成立');
  room.match = { ...ready, status: 'playing', currentHandStatus: 'playing', currentHand: game };
  appendTableEvents(room, actionEvents(room, before, game, action));
  appendTableEvents(room, specialRuleEvents(ready.currentHandIndex + 1, before, game));
  appendTableEvents(room, resultEvents(room, before, game));
  settle(room);
  room.epoch++;
  advance(room);
}
function settle(room: SavedRoom): void {
  const match = room.match;
  if (!match) return;
  const settled = settlePendingScoringEvents(match);
  const scoreStart = room.scores.length;
  for (const event of match.currentHand.pendingScoringEvents) {
    room.scores.push({
      hand: match.currentHandIndex + 1,
      reason:
        event.type === 'hu-resolved'
          ? [
              event.threeMouthResolution ? 'three-mouth' : event.packageKind,
              event.source,
              ...event.evaluation.patterns,
            ]
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
      ...(event.type === 'hu-resolved' && (event.threeMouthResolution || event.packageKind)
        ? {
            responsibility: {
              trigger:
                event.threeMouthResolution?.triggerPlayerIndex ??
                (event.source === 'self-draw' ? event.winnerPlayerIndex : event.payerPlayerIndex),
              payer: event.transfers[0]!.fromPlayerIndex,
            },
          }
        : {}),
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
  room.match = settled;
  appendTableEvents(
    room,
    room.scores.slice(scoreStart).map((score) => ({
      type: 'score-changed',
      hand: score.hand,
      changes: scoreChanges([score]),
      reason: score.reason,
    })),
  );
}
export function apply(room: SavedRoom, action: GameAction): void {
  if (!room.match) throw new Error('牌局尚未开始');
  const before = room.match.currentHand;
  const after = applyAction(before, action);
  if (after === before) throw new Error('该操作已失效或不合法');
  room.match = { ...room.match, currentHand: after };
  appendTableEvents(room, actionEvents(room, before, after, action));
  appendTableEvents(room, specialRuleEvents(room.match.currentHandIndex + 1, before, after));
  appendTableEvents(room, resultEvents(room, before, after));
  settle(room);
}
export function advance(room: SavedRoom): void {
  for (let guard = 0; guard < 200; guard++) {
    const match = room.match;
    if (!match || room.status !== 'playing') return;
    const game = match.currentHand;
    if (game.phase === 'ended') {
      if (match.currentHandStatus !== 'completed') {
        room.match = completeCurrentHand(match);
        const hand = match.currentHandIndex + 1;
        const outcome = handOutcome(game);
        appendTableEvents(room, [
          {
            type: 'hand-settled',
            hand,
            result: game.result!.type === 'draw' ? 'draw' : 'hu',
            ...outcome,
            changes: scoreChanges(room.scores.filter((score) => score.hand === hand)),
          },
        ]);
      }
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
        flowers: player?.flowers.map(publicTile) ?? [],
        melds:
          player?.melds.map((m) => ({
            kind: m.type,
            tiles: m.tiles.map(publicTile),
            ...(m.claimedTileId
              ? { claimedTileIndex: m.tiles.findIndex((tile) => tile.id === m.claimedTileId) }
              : {}),
            ...(m.fromPlayerIndex !== undefined ? { fromSeat: m.fromPlayerIndex } : {}),
          })) ?? [],
        discards:
          player?.discardPile.filter((d) => !d.claimedByMeldId).map((d) => tileView(d.tile)) ?? [],
        diHu: game?.diHuDeclarations?.declarations.some((d) => d.playerIndex === seat) ?? false,
        score: match?.cumulativeScores[seat] ?? 1000,
        ...(game?.globalRacks?.[seat]?.active
          ? { rack: publicTile(game.globalRacks[seat]!.tile) }
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
    ...(game?.turnStage === 'waiting-for-reaction' &&
    game.reactionWindow &&
    game.reactionWindow.status !== 'closed'
      ? {
          responseWindow: {
            source: game.reactionWindow.source,
            actorSeat:
              game.reactionWindow.source === 'discard'
                ? game.reactionWindow.fromPlayerIndex
                : game.reactionWindow.intent.declarerPlayerIndex,
          },
        }
      : {}),
    actions: { choices: stopped ? [] : choices(room, self, secret).map((c) => c.view) },
    scores: room.scores.slice(-100).map(publicScore),
    tableEvents: room.tableEvents.slice(-100).map(publicTableEvent),
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
