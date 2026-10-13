import { createHash } from 'node:crypto';
import { CloudStore, LEASE_MS } from './store.js';
import type { Session, CloudRoom, RequestContext } from './store.js';
import { createRoom, events, execute, fail, parseCommand, PublicError, tick } from './commands.js';
import { view } from '../apps/server/src/table.js';
import type { CommandAck, RoomEvent, RoomView } from '@nanjing-mahjong/shared-types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_ORIGIN?: string;
}
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...headers, ...extra } });
function cookie(request: Request): string {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('mj_session='))
      ?.slice(11) ?? ''
  );
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > 8192)
    fail('BAD_REQUEST', '请求过大', 413);
  if (!request.body) return {};
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) {
      await reader.cancel();
      fail('BAD_REQUEST', '请求过大', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    return fail('BAD_REQUEST', '请求格式错误');
  }
}
function peer(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{16,80}$/.test(value))
    return fail('BAD_REQUEST', '连接信息无效');
  return value;
}
async function authenticated(
  store: CloudStore,
  request: Request,
  connection?: string,
): Promise<Session> {
  const token = cookie(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return fail('NO_SESSION', '请刷新页面恢复会话', 401);
  const session = await store.session(token);
  if (!session) return fail('NO_SESSION', '请刷新页面恢复会话', 401);
  if (connection !== undefined && session.peer !== connection)
    return fail('REPLACED', '此座位已在另一页面打开', 409);
  return session;
}
async function snapshot(
  store: CloudStore,
  session: Session,
  waking = false,
  context?: RequestContext,
): Promise<RoomView | null> {
  if (!session.room_id) return null;
  for (let i = 0; i < 8; i++) {
    const initial = i === 0 ? context : undefined;
    const loaded = initial ? initial.loaded : await store.room(session.room_id);
    if (!loaded) return null;
    const { room, record } = loaded;
    if (!room.members.some((m) => m?.session === session.token)) return null;
    const now = Date.now(),
      online = initial ? initial.online : await store.online(room.id, now);
    if (tick(room, online, now, waking) && !(await store.saveClock(room, record.version))) continue;
    return view(room, session.token, online, room.secret);
  }
  return fail('BUSY', '牌局正在同步，请稍后重试', 503);
}
async function command(
  store: CloudStore,
  session: Session,
  connection: string,
  event: RoomEvent,
  raw: unknown,
  initial: RequestContext,
) {
  const cmd = parseCommand(raw);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([event, cmd]))
    .digest('hex');
  for (let attempt = 0; attempt < 8; attempt++) {
    const context =
      attempt === 0
        ? initial
        : await store.context(session.token, connection, cmd.roomId, cmd.commandId);
    const current = context.session;
    if (!current || current.peer !== connection) fail('REPLACED', '此座位已在另一页面打开', 409);
    const previous = context.receipt;
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('DUPLICATE_ID', '操作编号已用于其他请求', 409);
      const latest = current;
      return {
        ack: JSON.parse(previous.body) as CommandAck,
        state: latest ? await snapshot(store, latest) : null,
      };
    }

    let room: CloudRoom,
      version: number | null,
      nextRoom: string | null,
      disconnect = false,
      left = false;
    if (event === 'room:create') {
      if (current!.room_id) fail('ALREADY_SEATED', '请先离开当前房间');
      if (!cmd.name) fail('NAME_REQUIRED', '请填写昵称');
      if (cmd.roomId && !/^[0-9]{6,12}$/.test(cmd.roomId))
        fail('ROOM_CODE_INVALID', '自定义房间号须为 6～12 位数字');
      if (cmd.roomId && context.loaded) fail('ROOM_CODE_TAKEN', '这个房间号已被使用，请换一个');
      room = createRoom(session.token, cmd.name!.trim());
      if (cmd.roomId) room.id = cmd.roomId;
      version = null;
      nextRoom = room.id;
    } else {
      if (!cmd.roomId) fail('ROOM_NOT_FOUND', '房间不存在', 404);
      if (current!.room_id && current!.room_id !== cmd.roomId)
        fail('ALREADY_SEATED', '请先离开当前房间');
      const loaded = context.loaded;
      if (!loaded) fail('ROOM_NOT_FOUND', '房间不存在', 404);
      room = loaded!.room;
      version = loaded!.record.version;
      const online = context.online;
      const outcome = execute(room, event, cmd, session.token, online);
      left = outcome.left;
      disconnect = outcome.disconnect;
      nextRoom = left ? null : room.id;
    }
    const ack: CommandAck = {
      commandId: cmd.commandId,
      ok: true,
      roomId: room.id,
      revision: room.revision,
    };
    if (
      await store.commit({
        room,
        version,
        session: session.token,
        peer: connection,
        nextRoom,
        ack,
        fingerprint,
      })
    ) {
      if (disconnect) await store.disconnect(session.token, connection);
      return {
        ack,
        state: left
          ? null
          : view(
              room,
              session.token,
              new Set([...context.online, ...(!disconnect ? [session.token] : [])]),
              room.secret,
            ),
        left,
        disconnect,
      };
    }
  }
  return fail('BUSY', '同时操作较多，请重试', 503);
}
function streamState(
  store: CloudStore,
  session: Session,
  connection: string,
  initial: RoomView | null,
): Response {
  const encoder = new TextEncoder();
  let canceled = false,
    last = JSON.stringify(initial),
    count = 0,
    playing = initial?.status === 'playing',
    samples = 0,
    totalMs = 0,
    reported = false;
  const report = () => {
    if (!reported && samples > 0) {
      reported = true;
      console.info(
        JSON.stringify({ event: 'sync-latency', samples, meanMs: Math.round(totalMs / samples) }),
      );
    }
  };
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ state: initial }) + '\n'));
    },
    async pull(controller) {
      if (canceled) return;
      if (Date.now() - started > 5000 || count++ >= 35) {
        report();
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, playing ? 60 : 400));
      if (canceled) return;
      try {
        const queriedAt = Date.now();
        const context = await store.poll(session.token, connection);
        if (!context.session || context.session.peer !== connection) {
          if (!canceled) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ error: { code: 'REPLACED', message: '此座位已在另一页面打开' } }) +
                  '\n',
              ),
            );
            controller.close();
          }
          return;
        }
        const state = await snapshot(
          store,
          context.session,
          Date.now() - context.session.last_seen > LEASE_MS,
          context,
        );
        if (canceled) return;
        totalMs += Date.now() - queriedAt;
        samples++;
        playing = state?.status === 'playing';
        const serialized = JSON.stringify(state);
        controller.enqueue(
          encoder.encode((serialized === last ? '{}' : JSON.stringify({ state })) + '\n'),
        );
        last = serialized;
      } catch {
        if (!canceled) controller.error(new Error('同步连接中断'));
      }
    },
    cancel() {
      canceled = true;
      report();
    },
  });
  return new Response(stream, {
    headers: {
      ...headers,
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/health')
      return env.ASSETS.fetch(request);
    try {
      const store = new CloudStore(env.DB.withSession('first-primary'));
      if (url.pathname === '/health') {
        await store.db.prepare('SELECT 1').first();
        return json({ status: 'ok', storage: 'd1' });
      }
      if (request.method !== 'POST')
        return json({ error: { code: 'METHOD', message: '请求方式不支持' } }, 405, {
          Allow: 'POST',
        });
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin && origin !== env.SITE_ORIGIN)
        fail('ORIGIN', '来源不允许', 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site') fail('ORIGIN', '来源不允许', 403);
      if (url.pathname === '/api/session') {
        let session = (await store.context(cookie(request), '')).session;
        session ??= await store.createSession();
        return json({ roomId: session.room_id }, 200, {
          'Set-Cookie': `mj_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`,
        });
      }
      const value = await body(request),
        connection = peer(value.peer);
      if (url.pathname === '/api/connect') {
        const session = await authenticated(store, request);
        await store.connect(session.token, connection);
        const context = await store.context(session.token, connection);
        return json({ state: await snapshot(store, context.session!, true, context) });
      }
      if (url.pathname === '/api/disconnect') {
        const session = await authenticated(store, request, connection);
        await store.disconnect(session.token, connection);
        return json({ ok: true });
      }
      const token = cookie(request);
      if (!/^[a-f0-9]{64}$/.test(token)) fail('NO_SESSION', '请刷新页面恢复会话', 401);
      const raw =
        url.pathname === '/api/command'
          ? (value.command as Record<string, unknown> | undefined)
          : undefined;
      const context =
        url.pathname === '/api/poll' || url.pathname === '/api/stream'
          ? await store.poll(token, connection)
          : await store.context(
              token,
              connection,
              typeof raw?.roomId === 'string' ? raw.roomId : undefined,
              typeof raw?.commandId === 'string' ? raw.commandId : undefined,
            );
      const session = context.session;
      if (!session) return fail('NO_SESSION', '请刷新页面恢复会话', 401);
      if (session.peer !== connection) fail('REPLACED', '此座位已在另一页面打开', 409);
      const waking = Date.now() - session.last_seen > LEASE_MS;
      if (url.pathname === '/api/stream')
        return streamState(
          store,
          session,
          connection,
          await snapshot(store, session, waking, context),
        );
      if (url.pathname === '/api/poll')
        return json({ state: await snapshot(store, session, waking, context) });
      if (url.pathname === '/api/command') {
        if (typeof value.event !== 'string' || !events.includes(value.event))
          fail('BAD_REQUEST', '未知操作');
        try {
          return json(
            await command(
              store,
              session,
              connection,
              value.event as RoomEvent,
              value.command,
              context,
            ),
          );
        } catch (error) {
          if (error instanceof PublicError && error.code !== 'REPLACED' && error.status < 500) {
            const id =
              typeof value.command === 'object' &&
              value.command !== null &&
              'commandId' in value.command
                ? String(value.command.commandId)
                : '';
            return json({
              ack: {
                commandId: id,
                ok: false,
                error: { code: error.code, message: error.message },
              },
            });
          }
          throw error;
        }
      }
      return json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404);
    } catch (error) {
      if (error instanceof PublicError)
        return json({ error: { code: error.code, message: error.message } }, error.status);
      console.error('Cloud request failed', error instanceof Error ? error.message : 'unknown');
      return json({ error: { code: 'UNAVAILABLE', message: '服务暂时不可用，请稍后重试' } }, 503);
    }
  },
};
