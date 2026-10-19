import { randomBytes } from 'node:crypto';
import {
  apply,
  confirmNextHand,
  advance,
  choices,
  newRoom,
  nextHand,
  paused,
  start,
} from '../apps/server/src/table.js';
import type { RoomCommand, RoomEvent } from '@nanjing-mahjong/shared-types';
import type { CloudRoom } from './store.js';
export class PublicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new PublicError(code, message, status);
};
export const events: readonly string[] = [
  'room:create',
  'room:join',
  'room:leave',
  'room:ready',
  'room:start',
  'room:end',
  'room:rematch',
  'room:next-ready',
  'game:action',
];
export function parseCommand(raw: unknown): RoomCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return fail('BAD_REQUEST', '请求格式错误');
  const v = raw as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !['commandId', 'roomId', 'name', 'ready', 'token'].includes(k)) ||
    typeof v.commandId !== 'string' ||
    !/^[\w-]{8,80}$/.test(v.commandId) ||
    (v.roomId !== undefined &&
      (typeof v.roomId !== 'string' || !/^(?:[0-9]{6,12}|[\w-]{12})$/.test(v.roomId))) ||
    (v.name !== undefined &&
      (typeof v.name !== 'string' || v.name.trim().length < 1 || v.name.trim().length > 16)) ||
    (v.ready !== undefined && typeof v.ready !== 'boolean') ||
    (v.token !== undefined && (typeof v.token !== 'string' || v.token.length > 100))
  )
    return fail('BAD_REQUEST', '请求内容不合法');
  return v as unknown as RoomCommand;
}
export function createRoom(session: string, name: string): CloudRoom {
  return {
    ...newRoom(session, name),
    cloudFormat: 1,
    secret: randomBytes(32).toString('hex'),
    clockAt: null,
    lastActivity: Date.now(),
  };
}
/** Clock is driven by authenticated polls; an offline interval can never consume review time. */
export function tick(room: CloudRoom, online: Set<string>, now: number, waking = false): boolean {
  if (room.status !== 'playing' || room.remainingMs === null || paused(room, online)) {
    if (room.clockAt === null) return false;
    room.clockAt = null;
    return true;
  }
  if (room.clockAt === null || waking) {
    room.clockAt = now;
    return true;
  }
  const elapsed = Math.max(0, now - room.clockAt);
  if (elapsed < 200) return false;
  room.remainingMs = Math.max(0, room.remainingMs - elapsed);
  room.clockAt = now;
  if (room.remainingMs === 0) {
    nextHand(room);
    room.clockAt = null;
  }
  room.revision++;
  return true;
}
export function execute(
  room: CloudRoom,
  event: RoomEvent,
  cmd: RoomCommand,
  session: string,
  online: Set<string>,
): { left: boolean; disconnect: boolean } {
  let seat = room.members.findIndex((m) => m?.session === session),
    privateOnly = false;
  if (event === 'room:join') {
    if (seat < 0) {
      if (room.status !== 'waiting') fail('STARTED', '牌局已开始，不能替换玩家');
      seat = room.members.findIndex((m) => !m);
      if (seat < 0) fail('ROOM_FULL', '房间已满');
      if (!cmd.name) fail('NAME_REQUIRED', '请填写昵称');
      room.members[seat] = { session, name: cmd.name!.trim(), ready: false, joined: Date.now() };
    }
  } else {
    if (seat < 0) fail('FORBIDDEN', '你不在此房间', 403);
    if (event === 'room:leave') {
      if (room.status === 'playing') return { left: false, disconnect: true };
      room.members[seat] = null;
      if (room.host === seat)
        room.host =
          room.members
            .map((m, i) => ({ m, i }))
            .filter((x) => x.m)
            .sort((a, b) => a.m!.joined - b.m!.joined)[0]?.i ?? 0;
      room.revision++;
      return { left: true, disconnect: false };
    }
    if (event === 'room:ready') {
      if (room.status !== 'waiting' || typeof cmd.ready !== 'boolean')
        fail('INVALID_STATE', '当前不能准备');
      room.members[seat]!.ready = cmd.ready!;
    } else if (event === 'room:start') {
      if (room.host !== seat) fail('FORBIDDEN', '只有房主可以开始', 403);
      if (
        room.status !== 'waiting' ||
        room.members.some((m) => !m?.ready || !online.has(m.session))
      )
        fail('NOT_READY', '需要四人在线并准备');
      start(room);
      room.clockAt = null;
    } else if (event === 'room:next-ready') {
      try {
        confirmNextHand(room, seat, cmd.token, online, room.secret);
      } catch (error) {
        fail('STALE_ACTION', error instanceof Error ? error.message : '当前不能开始下一把');
      }
      if (room.remainingMs === null) room.clockAt = null;
    } else if (event === 'room:end') {
      if (room.status !== 'playing') fail('FORBIDDEN', '只能结束进行中的牌局', 403);
      room.status = 'ended';
      room.remainingMs = null;
      room.clockAt = null;
      room.epoch++;
    } else if (event === 'room:rematch') {
      if (room.host !== seat || !['completed', 'ended'].includes(room.status))
        fail('FORBIDDEN', '当前不能再来一将', 403);
      room.status = 'waiting';
      room.match = undefined;
      room.reactions = {};
      room.scores = [];
      room.tableEvents = [];
      room.remainingMs = null;
      room.clockAt = null;
      room.epoch++;
      room.members.forEach((m) => {
        if (m) m.ready = false;
      });
    } else if (event === 'game:action') {
      if (paused(room, online)) fail('PAUSED', '有玩家掉线，等待重连');
      const choice = choices(room, seat, room.secret).find((c) => c.view.token === cmd.token);
      if (!choice) fail('STALE_ACTION', '操作已失效，请重新选择');
      if (choice!.action.type === 'SUBMIT_REACTION') {
        room.reactions[String(seat)] = choice!.action.responseType;
        const epoch = room.epoch;
        advance(room);
        privateOnly = epoch === room.epoch;
      } else {
        apply(room, choice!.action);
        room.epoch++;
        advance(room);
        privateOnly =
          choice!.action.type === 'SUBMIT_DI_HU_DECISION' &&
          choice!.action.decision === 'pass' &&
          room.match?.currentHand.turnStage === 'waiting-for-di-hu-decision';
      }
    } else fail('BAD_REQUEST', '未知操作');
  }
  if (!privateOnly) room.revision++;
  return { left: false, disconnect: false };
}
