import { advance, apply, reviewToken } from '../../apps/server/src/table';
import { threeMouthRoom } from '../../apps/server/test/three-mouth-fixture';
import { CloudStore } from '../../cloud/store';
import type { CloudRoom } from '../../cloud/store';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import worker from '../../cloud/worker';
import type { Env } from '../../cloud/worker';
import type { RoomView, CommandAck } from '@nanjing-mahjong/shared-types';

// SQLite-backed D1 contract, including transactional batches and optimistic update counts.
class SqlD1 {
  calls = 0;
  readonly db = new DatabaseSync(':memory:');
  constructor() {
    for (const filename of readdirSync('drizzle')
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      this.db.exec(readFileSync(resolve('drizzle', filename), 'utf8'));
    }
  }
  withSession() {
    return this;
  }
  prepare(sql: string) {
    return new SqlStatement(this, sql);
  }
  async batch(statements: SqlStatement[]) {
    this.calls++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows = statements.map((s) => s.execute());
      this.db.exec('COMMIT');
      return rows;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
class SqlStatement {
  values: (string | number | null)[] = [];
  constructor(
    readonly source: SqlD1,
    readonly sql: string,
  ) {}
  bind(...values: (string | number | null)[]) {
    const stmt = new SqlStatement(this.source, this.sql);
    stmt.values = values;
    return stmt;
  }
  async first() {
    this.source.calls++;
    return this.source.db.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return {
      results: this.source.db.prepare(this.sql).all(...this.values),
      success: true,
      meta: {},
    };
  }
  execute() {
    if (/^SELECT/i.test(this.sql))
      return {
        results: this.source.db.prepare(this.sql).all(...this.values),
        success: true,
        meta: { changes: 0 },
      };
    const result = this.source.db.prepare(this.sql).run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async run() {
    this.source.calls++;
    return this.execute();
  }
}
const databases: SqlD1[] = [];
afterEach(() => {
  for (const db of databases) db.db.close();
  databases.length = 0;
});
function setup() {
  const db = new SqlD1();
  databases.push(db);
  const env = { DB: db, ASSETS: { fetch: () => new Response('assets') } } as unknown as Env;
  return { db, env };
}
interface Client {
  cookie: string;
  peer: string;
}
async function call(env: Env, path: string, client?: Client, body: Record<string, unknown> = {}) {
  return worker.fetch(
    new Request('https://mahjong.test' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://mahjong.test',
        ...(client ? { Cookie: client.cookie } : {}),
      },
      body: JSON.stringify({ ...body, ...(client ? { peer: client.peer } : {}) }),
    }) as unknown as Parameters<typeof worker.fetch>[0],
    env,
  );
}
async function client(env: Env): Promise<Client> {
  const response = await call(env, '/api/session');
  expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('Secure');
  const c = {
    cookie: response.headers.get('Set-Cookie')!.split(';')[0]!,
    peer: crypto.randomUUID(),
  };
  expect((await call(env, '/api/connect', c)).status).toBe(200);
  return c;
}
async function command(
  env: Env,
  c: Client,
  event: string,
  args: Record<string, unknown> = {},
  id = crypto.randomUUID(),
) {
  const response = await call(env, '/api/command', c, {
    event,
    command: { commandId: id, ...args },
  });
  return {
    response,
    body: (await response.json()) as {
      ack: CommandAck;
      state: RoomView | null;
      error?: { code: string };
    },
  };
}
async function table(env: Env) {
  const clients = await Promise.all(Array.from({ length: 4 }, () => client(env)));
  const created = await command(env, clients[0]!, 'room:create', { name: '房主' });
  expect(created.body.ack.ok).toBe(true);
  const roomId = created.body.ack.roomId!;
  await Promise.all(
    clients
      .slice(1)
      .map(async (c, i) =>
        expect((await command(env, c, 'room:join', { roomId, name: '朋友' + i })).body.ack.ok).toBe(
          true,
        ),
      ),
  );
  await Promise.all(
    clients.map(async (c) =>
      expect((await command(env, c, 'room:ready', { roomId, ready: true })).body.ack.ok).toBe(true),
    ),
  );
  expect((await command(env, clients[0]!, 'room:start', { roomId })).body.ack.ok).toBe(true);
  return { clients, roomId };
}
describe('Sites D1 room service', () => {
  it('restores a special hu opportunity after reconnect and does not settle a replay twice', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = JSON.parse(
      String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
    ) as CloudRoom;
    stored.match = threeMouthRoom().match;
    apply(stored, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
    advance(stored);
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    clients[1]!.peer = crypto.randomUUID();
    expect((await call(env, '/api/connect', clients[1]!)).status).toBe(200);
    const { state } = (await (await call(env, '/api/poll', clients[1]!)).json()) as {
      state: RoomView;
    };
    expect(state.actions.choices.map((c) => c.kind)).toEqual(['pass', 'hu']);
    const token = state.actions.choices.find((c) => c.kind === 'hu')!.token;
    const commandId = crypto.randomUUID();
    const first = await command(env, clients[1]!, 'game:action', { roomId, token }, commandId);
    expect(first.body.ack.ok).toBe(true);
    expect(first.body.state!.scores.at(-1)!.responsibility).toEqual({ trigger: 2, payer: 0 });
    const beforeReplay = JSON.parse(
      String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
    ) as CloudRoom;
    expect(
      (await command(env, clients[1]!, 'game:action', { roomId, token }, commandId)).body.ack,
    ).toEqual(first.body.ack);
    const afterReplay = JSON.parse(
      String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
    ) as CloudRoom;
    expect(afterReplay.scores).toEqual(beforeReplay.scores);
    expect(afterReplay.match).toEqual(beforeReplay.match);
  });
  it('all D1 read paths retain a legacy match and rematch upgrades the rules', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const raw = JSON.parse(
      String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
    );
    raw.rules = 'V1.0.8';
    delete raw.match.currentHand.threeMouthState;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(raw), roomId);
    const store = new CloudStore(env.DB);
    const session = clients[0]!.cookie.split('=')[1]!;
    const direct = await store.room(roomId);
    const polled = await store.poll(session, clients[0]!.peer);
    const context = await store.context(session, clients[0]!.peer);
    for (const loaded of [direct, polled.loaded, context.loaded]) {
      expect(loaded!.room.rules).toBe('V1.0.8');
      expect(loaded!.room.match!.currentHand.legacyThreeMouth).toBe(true);
      expect(loaded!.room.match!.cumulativeScores).toEqual(raw.match.cumulativeScores);
    }
    expect((await command(env, clients[0]!, 'room:end', { roomId })).body.ack.ok).toBe(true);
    expect((await command(env, clients[0]!, 'room:rematch', { roomId })).body.ack.ok).toBe(true);
    for (const c of clients)
      expect((await command(env, c, 'room:ready', { roomId, ready: true })).body.ack.ok).toBe(true);
    expect((await command(env, clients[0]!, 'room:start', { roomId })).body.ack.ok).toBe(true);
    const next = (await store.room(roomId))!.room;
    expect(next.rules).toBe('V1.0.10');
    expect(next.match!.currentHand.legacyThreeMouth).toBeUndefined();
  });
  it('joins four concurrent players, isolates hands, rejects extra and forged commands', async () => {
    const { env } = setup();
    const { clients, roomId } = await table(env);
    for (let i = 0; i < 4; i++) {
      const { state } = (await (await call(env, '/api/poll', clients[i]!)).json()) as {
        state: RoomView;
      };
      expect(state.self).toBe(i);
      expect(state.players[i]?.hand?.length).toBeGreaterThan(0);
      expect(
        state.players
          .filter((_, j) => j !== i)
          .every((p) => p && !('hand' in p) && !('drawnTileId' in p)),
      ).toBe(true);
      for (const hidden of [
        'winningTileFaces',
        'pendingPlayerIndices',
        'responderOrder',
        '"secret"',
        '"session"',
        '"wall"',
      ])
        expect(JSON.stringify(state)).not.toContain(hidden);
    }
    const fifth = await client(env);
    expect((await command(env, fifth, 'room:join', { roomId, name: '第五人' })).body.ack.ok).toBe(
      false,
    );
    expect(
      (
        await command(env, clients[0]!, 'game:action', {
          roomId,
          type: 'DRAW_TILE',
          playerIndex: 1,
        })
      ).body.error?.code,
    ).toBeUndefined();
    expect(
      (await command(env, clients[0]!, 'game:action', { roomId, token: 'fake' })).body.ack.ok,
    ).toBe(false);
  });
  it('commits a racing duplicate exactly once and replays its receipt after a fresh handler', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const states = await Promise.all(
      clients.map(
        async (c) =>
          ((await (await call(env, '/api/poll', c)).json()) as { state: RoomView }).state,
      ),
    );
    const actor = states.findIndex((s) => s.actions.choices.length > 0),
      id = crypto.randomUUID();
    const args = { roomId, token: states[actor]!.actions.choices[0]!.token };
    const results = await Promise.all([
      command(env, clients[actor]!, 'game:action', args, id),
      command(env, clients[actor]!, 'game:action', args, id),
    ]);
    expect(results[0]!.body.ack.ok).toBe(true);
    expect(results[1]!.body.ack).toEqual(results[0]!.body.ack);
    const original = db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId);
    const freshEnv = { ...env, DB: db as unknown as D1Database };
    expect((await command(freshEnv, clients[actor]!, 'game:action', args, id)).body.ack).toEqual(
      results[0]!.body.ack,
    );
    expect(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(original);
    expect(
      (await command(env, clients[actor]!, 'game:action', { roomId, token: 'other' }, id)).body.ack
        .error?.code,
    ).toBe('DUPLICATE_ID');
  });
  it('pauses disconnected players, restores seats and rejects a superseded browser', async () => {
    const { env } = setup();
    const { clients } = await table(env);
    await call(env, '/api/disconnect', clients[3]!);
    expect(
      ((await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }).state
        .paused,
    ).toBe(true);
    const replacement = { ...clients[3]!, peer: crypto.randomUUID() };
    const response = await call(env, '/api/connect', replacement);
    expect(((await response.json()) as { state: RoomView }).state.self).toBe(3);
    expect((await call(env, '/api/poll', clients[3]!)).status).toBe(409);
    expect(
      ((await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }).state
        .paused,
    ).toBe(false);
  });
  it('does not reserve two rooms when the same player creates simultaneously', async () => {
    const { env, db } = setup();
    const c = await client(env);
    const results = await Promise.all([
      command(env, c, 'room:create', { name: '甲' }),
      command(env, c, 'room:create', { name: '乙' }),
    ]);
    expect(results.filter((r) => r.body.ack.ok)).toHaveLength(1);
    expect(db.db.prepare('SELECT count(*) AS count FROM cloud_rooms').get()?.count).toBe(1);
  });
  it('rolls back both room state and receipt when persistence fails', async () => {
    const { env, db } = setup();
    const c = await client(env);
    const result = await command(env, c, 'room:create', { name: '甲' }),
      roomId = result.body.ack.roomId!;
    const before = db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId);
    db.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON cloud_commands BEGIN SELECT RAISE(ABORT,'simulated failure'); END;",
    );
    expect((await command(env, c, 'room:ready', { roomId, ready: true })).response.status).toBe(
      503,
    );
    expect(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
  });
});

it('custom numeric rooms reject duplicates, invalid codes and preserve the first host', async () => {
  const { env } = setup();
  const a = await client(env),
    b = await client(env);
  const results = await Promise.all([
    command(env, a, 'room:create', { name: '甲', roomId: '00123456' }),
    command(env, b, 'room:create', { name: '乙', roomId: '00123456' }),
  ]);
  expect(results.filter((r) => r.body.ack.ok)).toHaveLength(1);
  expect(results.find((r) => !r.body.ack.ok)?.body.ack.error?.code).toBe('ROOM_CODE_TAKEN');
  const loser = results[0]!.body.ack.ok ? b : a;
  expect(
    (await command(env, loser, 'room:create', { name: '乙', roomId: 'bad-code-123' })).body.ack.ok,
  ).toBe(false);
  const joined = await command(env, loser, 'room:join', { name: '朋友', roomId: '00123456' });
  expect(joined.body.ack.ok).toBe(true);
  expect(joined.body.state?.players.filter(Boolean)).toHaveLength(2);
});

it('uses one database trip for normal polling and two for a committed action', async () => {
  const { env, db } = setup();
  const { clients, roomId } = await table(env);
  db.calls = 0;
  const state = (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView };
  expect(state.state.id).toBe(roomId);
  expect(db.calls).toBe(1);
  db.calls = 0;
  const ended = await command(env, clients[0]!, 'room:end', { roomId });
  expect(ended.body.ack.ok).toBe(true);
  expect(ended.body.state?.status).toBe('ended');
  expect(db.calls).toBe(2);
});

it('allows a non-host member to end, rejects outsiders, and preserves scores', async () => {
  const { env } = setup();
  const { clients, roomId } = await table(env);
  const outsider = await client(env);
  expect((await command(env, outsider, 'room:end', { roomId })).body.ack.ok).toBe(false);
  const before = (await (await call(env, '/api/poll', clients[1]!)).json()) as { state: RoomView };
  const ended = await command(env, clients[1]!, 'room:end', { roomId });
  expect(ended.body.ack.ok).toBe(true);
  expect(ended.body.state?.status).toBe('ended');
  expect(ended.body.state?.players.map((p) => p?.score)).toEqual(
    before.state.players.map((p) => p?.score),
  );
});

it('expires after 30 minutes without commands even with polling, frees everyone', async () => {
  const { env, db } = setup();
  const { clients, roomId } = await table(env);
  const row = db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!;
  const room = JSON.parse(String(row.body));
  room.lastActivity = Date.now() - 29 * 60 * 1000;
  db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(room), roomId);
  expect(
    ((await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }).state.id,
  ).toBe(roomId);
  expect(
    JSON.parse(String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body))
      .lastActivity,
  ).toBe(room.lastActivity);
  room.lastActivity = Date.now() - 30 * 60 * 1000 - 1;
  db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(room), roomId);
  expect(
    ((await (await call(env, '/api/poll', clients[1]!)).json()) as { state: null }).state,
  ).toBeNull();
  expect(
    db.db.prepare('SELECT count(*) AS n FROM cloud_sessions WHERE room_id=?').get(roomId)?.n,
  ).toBe(0);
  expect(db.db.prepare('SELECT id FROM cloud_rooms WHERE id=?').get(roomId)).toBeUndefined();
  const created = await command(env, clients[0]!, 'room:create', {
    name: '重新开房',
    roomId: '987654',
  });
  expect(created.body.ack.ok).toBe(true);
});

it('valid actions reset idle expiry', async () => {
  const { env, db } = setup();
  const c = await client(env);
  const created = await command(env, c, 'room:create', { name: '测试' });
  const roomId = created.body.ack.roomId!;
  const room = JSON.parse(
    String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
  );
  room.lastActivity = Date.now() - 29 * 60 * 1000;
  db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(room), roomId);
  await command(env, c, 'room:ready', { roomId, ready: true });
  const saved = JSON.parse(
    String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
  );
  expect(saved.lastActivity).toBeGreaterThan(Date.now() - 5000);
});

it('lets a new player reuse an expired custom room code', async () => {
  const { env, db } = setup();
  const a = await client(env),
    b = await client(env);
  await command(env, a, 'room:create', { name: '旧房主', roomId: '654321' });
  db.db
    .prepare("UPDATE cloud_rooms SET body=json_set(body,'$.lastActivity',?) WHERE id=?")
    .run(Date.now() - 1800001, '654321');
  const created = await command(env, b, 'room:create', { name: '新房主', roomId: '654321' });
  expect(created.body.ack.ok).toBe(true);
  expect(created.body.state?.players[0]?.name).toBe('新房主');
  expect(((await (await call(env, '/api/poll', a)).json()) as { state: null }).state).toBeNull();
});

it('streams private state changes and detects a replacement connection', async () => {
  const { env } = setup();
  const a = await client(env),
    b = await client(env);
  const created = await command(env, a, 'room:create', { name: '房主' });
  const roomId = created.body.ack.roomId!;
  const response = await call(env, '/api/stream', a);
  expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
  const reader = response.body!.getReader();
  const next = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value));
  try {
    expect((await next()).state.id).toBe(roomId);
    await command(env, b, 'room:join', { roomId, name: '朋友' });
    let received = false;
    for (let i = 0; i < 10; i++) {
      const update = await next();
      if (update.state?.players.filter(Boolean).length === 2) {
        received = true;
        break;
      }
    }
    expect(received).toBe(true);
    await call(env, '/api/connect', { ...a, peer: crypto.randomUUID() });
    let replaced = false;
    for (let i = 0; i < 10; i++) {
      const update = await next();
      if (update.error?.code === 'REPLACED') {
        replaced = true;
        break;
      }
    }
    expect(replaced).toBe(true);
  } finally {
    await reader.cancel();
  }
});

it('starts the next hand once after four concurrent confirmations and rejects stale review tokens', async () => {
  const { env, db } = setup();
  const { clients, roomId } = await table(env);
  const room = JSON.parse(
    String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
  ) as CloudRoom;
  room.match!.currentHand = {
    ...room.match!.currentHand,
    phase: 'ended',
    turnStage: 'hand-ended',
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
  advance(room);
  const hand = room.match!.currentHandIndex;
  expect(room.remainingMs).toBe(45000);
  db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(room), roomId);
  const token = reviewToken(room, room.secret);
  const outsider = await client(env);
  expect((await command(env, outsider, 'room:next-ready', { roomId, token })).body.ack.ok).toBe(
    false,
  );
  const replies = await Promise.all(
    clients.map((c) => command(env, c, 'room:next-ready', { roomId, token })),
  );
  expect(replies.every((r) => r.body.ack.ok)).toBe(true);
  const saved = JSON.parse(
    String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
  ) as CloudRoom;
  expect(saved.match!.currentHandIndex).toBe(hand + 1);
  expect(saved.nextHandReady).toEqual([]);
  expect((await command(env, clients[0]!, 'room:next-ready', { roomId, token })).body.ack.ok).toBe(
    false,
  );
});
