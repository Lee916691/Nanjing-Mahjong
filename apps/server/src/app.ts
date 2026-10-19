import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import type { RoomCommand, RoomEvent, CommandAck } from '@nanjing-mahjong/shared-types';
import { isRuleSetId } from '@nanjing-mahjong/game-core';
import { Store, ReceiptConflictError } from './store.js';
import { createHash } from 'node:crypto';
import {
  newRoom,
  start,
  paused,
  choices,
  apply,
  advance,
  nextHand,
  view,
  confirmNextHand,
} from './table.js';
import type { SavedRoom } from './table.js';

const events: RoomEvent[] = [
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
function cookie(header?: string): string | undefined {
  return header
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('mj_session='))
    ?.slice(11);
}
class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(code: string, message: string): never {
  throw new ClientError(code, message);
}
function parse(value: unknown, event: RoomEvent): RoomCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('BAD_REQUEST', '请求格式错误');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) => !['commandId', 'roomId', 'name', 'ready', 'token', 'ruleSetId'].includes(k),
    ) ||
    (Object.hasOwn(v, 'ruleSetId') && (event !== 'room:create' || !isRuleSetId(v.ruleSetId))) ||
    typeof v.commandId !== 'string' ||
    !/^[\w-]{8,80}$/.test(v.commandId) ||
    (v.roomId !== undefined && (typeof v.roomId !== 'string' || !/^[\w-]{12}$/.test(v.roomId))) ||
    (v.name !== undefined &&
      (typeof v.name !== 'string' || v.name.trim().length < 1 || v.name.trim().length > 16)) ||
    (v.ready !== undefined && typeof v.ready !== 'boolean') ||
    (v.token !== undefined && (typeof v.token !== 'string' || v.token.length > 100))
  )
    fail('BAD_REQUEST', '请求内容不合法');
  return v as unknown as RoomCommand;
}
export function createApp(options: {
  dbPath: string;
  webPath?: string;
  tickMs?: number;
  publicOrigin?: string;
}) {
  const store = new Store(options.dbPath);
  const rooms = new Map(store.rooms().map((room) => [room.id, room]));
  const app = express();
  const http = createServer(app);
  const sockets = new Map<string, Socket>();
  const secret = store.secret();
  const allowed = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return true;
    try {
      return options.publicOrigin ? origin === options.publicOrigin : new URL(origin).host === host;
    } catch {
      return false;
    }
  };
  const io = new Server(http, {
    maxHttpBufferSize: 8192,
    allowRequest: (req, callback) => callback(null, allowed(req.headers.origin, req.headers.host)),
  });
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (!allowed(req.headers.origin, req.headers.host)) {
      res.status(403).json({ error: '来源不允许' });
      return;
    }
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/session', (req, res) => {
    const token = store.session(cookie(req.headers.cookie));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Set-Cookie',
      `mj_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${options.publicOrigin?.startsWith('https:') ? '; Secure' : ''}`,
    );
    const room = [...rooms.values()].find((r) => r.members.some((m) => m?.session === token));
    res.json({ roomId: room?.id ?? null });
  });
  const online = () => new Set(sockets.keys());
  const send = (room: SavedRoom, only?: readonly string[]) => {
    for (const m of room.members)
      if (m && (!only || only.includes(m.session)))
        sockets.get(m.session)?.emit('room:state', view(room, m.session, online(), secret));
  };
  io.use((socket, next) => {
    const token = cookie(socket.request.headers.cookie);
    if (!token || !store.hasSession(token)) {
      next(new Error('请刷新页面恢复会话'));
      return;
    }
    socket.data.session = token;
    next();
  });
  io.on('connection', (socket) => {
    const session = String(socket.data.session);
    const old = sockets.get(session);
    sockets.set(session, socket);
    if (old && old !== socket) {
      old.emit('session:replaced');
      old.disconnect(true);
    }
    for (const room of rooms.values())
      if (room.members.some((m) => m?.session === session)) send(room);
    let windowStart = Date.now(),
      count = 0;
    for (const event of events)
      socket.on(event, (raw: unknown, callback: unknown) => {
        const ackFn =
          typeof callback === 'function' ? (callback as (ack: CommandAck) => void) : () => {};
        let commandId = '';
        try {
          if (sockets.get(session) !== socket) fail('REPLACED', '此页面已由另一页面接管');
          const cmd = parse(raw, event);
          commandId = cmd.commandId;
          if (Date.now() - windowStart > 1000) {
            windowStart = Date.now();
            count = 0;
          }
          if (++count > 30) fail('RATE_LIMIT', '操作太频繁，请稍后再试');
          const fingerprint = createHash('sha256')
            .update(JSON.stringify([event, cmd]))
            .digest('hex');
          const receipt = store.receipt(session, cmd.commandId, fingerprint);
          if (receipt) {
            ackFn(receipt);
            return;
          }
          let room: SavedRoom;
          let privateOnly = false;
          let privateRecipients: string[] = [session];
          if (event === 'room:create') {
            if ([...rooms.values()].some((r) => r.members.some((m) => m?.session === session)))
              fail('ALREADY_SEATED', '请先离开当前房间');
            if (!cmd.name) fail('NAME_REQUIRED', '请填写昵称');
            room = newRoom(session, cmd.name.trim(), cmd.ruleSetId);
          } else {
            const existing = rooms.get(cmd.roomId ?? '');
            if (!existing) fail('ROOM_NOT_FOUND', '房间不存在');
            room = structuredClone(existing);
            let seat = room.members.findIndex((m) => m?.session === session);
            if (event === 'room:join') {
              if (seat < 0) {
                if (
                  [...rooms.values()].some(
                    (r) => r.id !== room.id && r.members.some((m) => m?.session === session),
                  )
                )
                  fail('ALREADY_SEATED', '请先离开当前房间');
                if (room.status !== 'waiting') fail('STARTED', '牌局已开始，不能替换玩家');
                seat = room.members.findIndex((m) => !m);
                if (seat < 0) fail('ROOM_FULL', '房间已满');
                if (!cmd.name) fail('NAME_REQUIRED', '请填写昵称');
                room.members[seat] = {
                  session,
                  name: cmd.name.trim(),
                  ready: false,
                  joined: Date.now(),
                };
              }
            } else {
              if (seat < 0) fail('FORBIDDEN', '你不在此房间');
              const member = room.members[seat]!;
              if (event === 'room:leave') {
                if (room.status === 'playing') {
                  socket.disconnect(true);
                  ackFn({ commandId, ok: true, roomId: room.id });
                  return;
                }
                room.members[seat] = null;
                if (seat === room.host) {
                  const remaining = room.members
                    .map((m, i) => ({ m, i }))
                    .filter((x) => x.m)
                    .sort((a, b) => a.m!.joined - b.m!.joined);
                  room.host = remaining[0]?.i ?? 0;
                }
              } else if (event === 'room:ready') {
                if (room.status !== 'waiting' || typeof cmd.ready !== 'boolean')
                  fail('INVALID_STATE', '当前不能准备');
                member.ready = cmd.ready;
              } else if (event === 'room:start') {
                if (seat !== room.host) fail('FORBIDDEN', '只有房主可以开始');
                if (
                  room.status !== 'waiting' ||
                  room.members.some((m) => !m?.ready || !sockets.has(m.session))
                )
                  fail('NOT_READY', `需要${room.members.length === 2 ? '两' : '四'}人在线并准备`);
                start(room);
              } else if (event === 'room:next-ready') {
                confirmNextHand(room, seat, cmd.token, online(), secret);
              } else if (event === 'room:end') {
                if (room.status !== 'playing') fail('FORBIDDEN', '只能结束进行中的牌局');
                room.status = 'ended';
                room.remainingMs = null;
                room.nextHandReady = [];
                room.epoch++;
              } else if (event === 'room:rematch') {
                if (seat !== room.host || !['ended', 'completed'].includes(room.status))
                  fail('FORBIDDEN', '当前不能再来一将');
                room.status = 'waiting';
                room.match = undefined;
                room.reactions = {};
                room.scores = [];
                room.tableEvents = [];
                room.nextHandReady = [];
                room.epoch++;
                room.members.forEach((m) => {
                  if (m) m.ready = false;
                });
              } else if (event === 'game:action') {
                if (paused(room, online())) fail('PAUSED', '有玩家掉线，等待重连');
                const choice = choices(room, seat, secret).find((c) => c.view.token === cmd.token);
                if (!choice) fail('STALE_ACTION', '操作已失效，请根据最新牌桌重新选择');
                if (choice.action.type === 'SUBMIT_REACTION') {
                  room.reactions[String(seat)] = choice.action.responseType;
                  const epoch = room.epoch;
                  advance(room);
                  privateOnly = epoch === room.epoch;
                } else {
                  apply(room, choice.action);
                  room.epoch++;
                  advance(room);
                  if (
                    choice.action.type === 'SUBMIT_DI_HU_DECISION' &&
                    choice.action.decision === 'pass' &&
                    room.match?.currentHand.turnStage === 'waiting-for-di-hu-decision'
                  ) {
                    privateOnly = true;
                    const next = room.match.currentHand.pendingAction.playerIndex;
                    const member = next === null ? null : room.members[next];
                    privateRecipients = member ? [session, member.session] : [session];
                  }
                }
              }
            }
            if (!privateOnly) room.revision++;
          }
          const ack: CommandAck = { commandId, ok: true, roomId: room.id, revision: room.revision };
          store.commit(room, session, ack, fingerprint);
          rooms.set(room.id, room);
          ackFn(ack);
          send(room, privateOnly ? privateRecipients : undefined);
          if (event === 'room:leave') socket.emit('room:left');
        } catch (error) {
          const known = error instanceof ClientError || error instanceof ReceiptConflictError;
          ackFn({
            commandId,
            ok: false,
            error: {
              code:
                error instanceof ReceiptConflictError
                  ? 'DUPLICATE_ID'
                  : error instanceof ClientError
                    ? error.code
                    : 'OPERATION_FAILED',
              message: known ? error.message : '操作未保存，请重试或检查服务端',
            },
          });
          if (!known)
            console.error('Command failed:', error instanceof Error ? error.message : 'unknown');
        }
      });
    socket.on('disconnect', () => {
      if (sockets.get(session) !== socket) return;
      sockets.delete(session);
      for (const room of rooms.values()) {
        if (room.members.some((m) => m?.session === session)) {
          runningSince.delete(room.id);
          send(room);
        }
      }
    });
  });
  const runningSince = new Map<string, number>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const original of rooms.values()) {
      if (
        original.status !== 'playing' ||
        original.remainingMs === null ||
        paused(original, online())
      ) {
        runningSince.delete(original.id);
        continue;
      }
      const elapsed = now - (runningSince.get(original.id) ?? now);
      runningSince.set(original.id, now);
      const room = structuredClone(original);
      room.remainingMs = Math.max(0, room.remainingMs! - elapsed);
      try {
        if (room.remainingMs === 0) nextHand(room);
        room.revision++;
        store.commit(room);
        rooms.set(room.id, room);
        send(room);
      } catch (error) {
        console.error('Advance failed:', error instanceof Error ? error.message : 'unknown');
      }
    }
  }, options.tickMs ?? 1000);
  const webPath = options.webPath ?? fileURLToPath(new URL('../../web/dist/', import.meta.url));
  app.use(express.static(webPath));
  app.get('/{*path}', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.sendStatus(404);
      return;
    }
    res.sendFile(resolve(webPath, 'index.html'));
  });
  let closed = false;
  return {
    app,
    http,
    io,
    store,
    rooms,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      store.close();
    },
    backup: (path: string) => store.backup(path),
  };
}
