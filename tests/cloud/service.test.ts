import { advance, apply, appendTableEvents, reviewToken } from '../../apps/server/src/table';
import { threeMouthRoom } from '../../apps/server/test/three-mouth-fixture';
import { prepareTwoPlayerWin } from '../../apps/server/test/two-player-fixture';
import {
  buGangRoom,
  eventRoom,
  eventTile,
  ordinary,
  setEventHand,
  specialRuleRoom,
  anGangRoom,
} from '../../apps/server/test/event-fixture';
import { CloudStore } from '../../cloud/store';
import * as core from '@nanjing-mahjong/game-core';
import type { CloudRoom } from '../../cloud/store';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import worker from '../../cloud/worker';
import type { Env } from '../../cloud/worker';
import type { RoomView, CommandAck } from '@nanjing-mahjong/shared-types';

// SQLite-backed D1 contract, including transactional batches and optimistic update counts.
class SqlD1 {
  calls = 0;
  versionConflicts = 0;
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
      if (
        statements.some(
          (statement, index) =>
            statement.sql.startsWith('UPDATE cloud_rooms SET body=') &&
            statement.sql.includes('AND version=?') &&
            rows[index]!.meta.changes === 0,
        )
      )
        this.versionConflicts++;
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
async function table(env: Env, duo = false) {
  const clients = await Promise.all(Array.from({ length: duo ? 2 : 4 }, () => client(env)));
  const created = await command(env, clients[0]!, 'room:create', {
    name: '房主',
    ...(duo ? { ruleSetId: 'nanjing-open-duo' } : {}),
  });
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
  it('commits self-draw flowers once, rolls back failed receipts and restores two-player review confirmations', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env, true);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    const winner = prepareTwoPlayerWin(stored);
    apply(stored, { type: 'DRAW_TILE' });
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const winnerClient = clients[winner]!;
    const polled = (
      (await (await call(env, '/api/poll', winnerClient)).json()) as { state: RoomView }
    ).state;
    const token = polled.actions.choices.find((choice) => choice.kind === 'hu')!.token;
    const commandId = crypto.randomUUID();
    const args = { roomId, token };
    const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
    db.db.exec(
      "CREATE TRIGGER fail_duo_receipt BEFORE INSERT ON cloud_commands BEGIN SELECT RAISE(ABORT,'failure'); END;",
    );
    expect((await command(env, winnerClient, 'game:action', args, commandId)).response.status).toBe(
      503,
    );
    expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
    db.db.exec('DROP TRIGGER fail_duo_receipt');
    const accepted = await command(env, winnerClient, 'game:action', args, commandId);
    expect(accepted.body.ack.ok).toBe(true);
    const state = accepted.body.state!;
    const score = state.scores.at(-1)!;
    expect(score.calculation).toMatchObject({
      payments: 1,
      total: 60,
      terms: expect.arrayContaining([{ label: '自摸加花 2 花', points: 4 }]),
    });
    expect(score.transfers).toEqual([{ from: 1 - winner, to: winner, amount: 60 }]);
    const replay = await command(env, winnerClient, 'game:action', args, commandId);
    expect(replay.body.ack).toEqual(accepted.body.ack);
    expect(replay.body.state!.players.map((player) => player!.score)).toEqual(
      state.players.map((player) => player!.score),
    );
    const review = { roomId, token: state.nextHandToken };
    expect(
      (await command(env, clients[0]!, 'room:next-ready', review)).body.state!.nextHandReady,
    ).toEqual([0]);
    const store = new CloudStore(env.DB);
    const loaded = (await store.room(roomId))!.room;
    expect(loaded.nextHandReady).toEqual([0]);
    await store.disconnect(clients[1]!.cookie.split('=')[1]!, clients[1]!.peer);
    const paused = (
      (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }
    ).state;
    expect(paused.paused).toBe(true);
    expect((await store.room(roomId))!.room.remainingMs).toBe(loaded.remainingMs);
    await call(env, '/api/connect', clients[1]!);
    const next = await command(env, clients[1]!, 'room:next-ready', review);
    expect(next.body.ack.ok).toBe(true);
    expect(next.body.state!.hand).toBe(state.hand + 1);
    expect(next.body.state!.ruleSetId).toBe('nanjing-open-duo');
    expect((await command(env, clients[0]!, 'room:next-ready', review)).body.ack.error?.code).toBe(
      'STALE_ACTION',
    );
  });
  it.each(['missing-mode', 'wrong-player-count', 'wrong-rule-version'])(
    'rejects %s through every D1 read and HTTP entry without rewriting the room or receipts',
    async (kind) => {
      const { env, db } = setup();
      const c = await client(env);
      const created = await command(env, c, 'room:create', {
        name: '双人房主',
        ruleSetId: 'nanjing-open-duo',
      });
      const roomId = created.body.ack.roomId!;
      const raw = JSON.parse(
        String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
      );
      if (kind === 'missing-mode') delete raw.ruleSetId;
      if (kind === 'wrong-player-count') raw.members.push(null);
      if (kind === 'wrong-rule-version') raw.rules = 'V1.0.11';
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(raw), roomId);
      const row = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      const receipts = db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all();
      const store = new CloudStore(env.DB);
      const session = c.cookie.split('=')[1]!;
      for (const read of [
        () => store.room(roomId),
        () => store.poll(session, c.peer),
        () => store.context(session, c.peer),
      ])
        await expect(read()).rejects.toThrow('玩法存档');
      for (const path of ['/api/poll', '/api/connect', '/api/stream', '/api/command']) {
        const response = await call(env, path, c, {
          event: 'room:end',
          command: { commandId: crypto.randomUUID(), roomId },
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
          error: { code: 'ROOM_MODE_ARCHIVE_INCOMPATIBLE' },
        });
      }
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(row);
      expect(db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all()).toEqual(
        receipts,
      );
    },
  );

  it('closes an already-open two-player stream with a clear error if mode data becomes corrupt', async () => {
    const { env, db } = setup();
    const c = await client(env);
    const created = await command(env, c, 'room:create', {
      name: '双人',
      ruleSetId: 'nanjing-open-duo',
    });
    const roomId = created.body.ack.roomId!;
    const response = await call(env, '/api/stream', c);
    const reader = response.body!.getReader();
    const next = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value));
    try {
      expect((await next()).state.ruleSetId).toBe('nanjing-open-duo');
      db.db
        .prepare("UPDATE cloud_rooms SET body=json_remove(body,'$.ruleSetId') WHERE id=?")
        .run(roomId);
      const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      expect(await next()).toMatchObject({ error: { code: 'ROOM_MODE_ARCHIVE_INCOMPATIBLE' } });
      expect((await reader.read()).done).toBe(true);
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
    } finally {
      await reader.cancel();
    }
  });
  it('creates a two-seat mode, rejects mode changes and extra members, and persists an idempotent mode fingerprint', async () => {
    const { env, db } = setup();
    const clients = await Promise.all([client(env), client(env), client(env)]);
    const args = { name: '双人房主', ruleSetId: 'nanjing-open-duo' };
    const commandId = crypto.randomUUID();
    const created = await command(env, clients[0]!, 'room:create', args, commandId);
    expect(created.body.ack.ok).toBe(true);
    expect(created.body.state).toMatchObject({
      ruleSetId: 'nanjing-open-duo',
      totalEffectiveDealerTurns: 8,
    });
    expect(created.body.state!.players).toHaveLength(2);
    const roomId = created.body.ack.roomId!;
    expect((await command(env, clients[0]!, 'room:create', args, commandId)).body.ack).toEqual(
      created.body.ack,
    );
    expect(
      (
        await command(
          env,
          clients[0]!,
          'room:create',
          { ...args, ruleSetId: 'nanjing-open' },
          commandId,
        )
      ).body.ack.error?.code,
    ).toBe('DUPLICATE_ID');
    expect(
      (
        await command(env, clients[1]!, 'room:join', {
          roomId,
          name: '对手',
          ruleSetId: 'nanjing-open',
        })
      ).body.ack.error?.code,
    ).toBe('BAD_REQUEST');
    expect(
      (await command(env, clients[1]!, 'room:join', { roomId, name: '对手' })).body.ack.ok,
    ).toBe(true);
    expect(
      (await command(env, clients[2]!, 'room:join', { roomId, name: '第三人' })).body.ack.error
        ?.code,
    ).toBe('ROOM_FULL');
    expect((await command(env, clients[0]!, 'room:start', { roomId })).body.ack.error?.code).toBe(
      'NOT_READY',
    );
    for (const c of clients.slice(0, 2))
      await command(env, c!, 'room:ready', { roomId, ready: true });
    const started = await command(env, clients[0]!, 'room:start', { roomId });
    expect(started.body.ack.ok).toBe(true);
    expect(started.body.state!.players).toHaveLength(2);
    expect(started.body.state!.players[1]!.hand).toBeUndefined();
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(stored).toMatchObject({ format: 2, ruleSetId: 'nanjing-open-duo', rules: 'V1.0.12' });
    const before = JSON.stringify(stored.match);
    const poll = await call(env, '/api/poll', clients[1]!);
    const state = ((await poll.json()) as { state: RoomView }).state;
    expect(state.ruleSetId).toBe('nanjing-open-duo');
    expect(state.players[0]!.hand).toBeUndefined();
    expect(JSON.stringify((await new CloudStore(env.DB).room(roomId))!.room.match)).toBe(before);
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM cloud_rooms').get()?.count).toBe(1);
  });

  it.each([null, 'unknown', 2])('rejects an invalid explicit room mode: %s', async (ruleSetId) => {
    const { env } = setup();
    const c = await client(env);
    expect(
      (await command(env, c, 'room:create', { name: '双人', ruleSetId })).body.ack.error?.code,
    ).toBe('BAD_REQUEST');
  });
  it('sends public kong faces without entity IDs in command, replay, poll, connect and live NDJSON', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = anGangRoom().match;
    stored.tableEvents = [];
    const firstId = stored.nextTableEventId;
    const firstSequence = stored.nextTableEventSequence;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const gangIds = [1, 2, 3, 4].map((copy) => `wan-1-${copy}`);
    const assertPublic = (raw: string) => {
      const { state } = JSON.parse(raw) as { state: RoomView };
      for (const id of gangIds) expect(raw).not.toContain(id);
      expect(state.players[0]!.melds[0]).toEqual({
        kind: 'an-gang',
        tiles: Array.from({ length: 4 }, () => ({ family: 'wan', label: '1万' })),
      });
      expect(state.tableEvents.find((event) => event.type === 'an-gang')).toEqual({
        type: 'an-gang',
        hand: 1,
        seat: 0,
        id: firstId,
        sequence: firstSequence,
        tile: { family: 'wan', label: '1万' },
      });
      expect(JSON.stringify(state.scores)).not.toMatch(/"id"\s*:/);
      return state;
    };
    const streams = await Promise.all(
      clients.map(async (c) => {
        const response = await call(env, '/api/stream', c);
        expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
        const reader = response.body!.getReader();
        await reader.read(); // The pre-kong state may legitimately contain the owner's hand IDs.
        return reader;
      }),
    );
    try {
      const initial = (await (await call(env, '/api/poll', clients[0]!)).json()) as {
        state: RoomView;
      };
      const args = {
        roomId,
        token: initial.state.actions.choices.find((choice) => choice.kind === 'an-gang')!.token,
      };
      const id = crypto.randomUUID();
      const response = await call(env, '/api/command', clients[0]!, {
        event: 'game:action',
        command: { commandId: id, ...args },
      });
      expect(response.status).toBe(200);
      const acceptedRaw = await response.text();
      assertPublic(acceptedRaw);
      const accepted = JSON.parse(acceptedRaw) as { ack: CommandAck };
      expect(accepted.ack.ok).toBe(true);
      const replay = await command(env, clients[0]!, 'game:action', args, id);
      expect(replay.body.ack).toEqual(accepted.ack);
      assertPublic(JSON.stringify(replay.body));
      for (const reader of streams) {
        let found = false;
        for (let attempt = 0; attempt < 12; attempt++) {
          const chunk = new TextDecoder().decode((await reader.read()).value);
          for (const line of chunk.trim().split('\n')) {
            const reply = JSON.parse(line) as { state?: RoomView };
            if (reply.state?.tableEvents.some((event) => event.type === 'an-gang')) {
              assertPublic(line);
              found = true;
              break;
            }
          }
          if (found) break;
        }
        expect(found).toBe(true);
      }
      for (const c of clients) {
        for (const path of ['/api/poll', '/api/connect', '/api/stream']) {
          const reply = await call(env, path, c);
          if (path === '/api/stream') {
            const reader = reply.body!.getReader();
            try {
              assertPublic(new TextDecoder().decode((await reader.read()).value));
            } finally {
              await reader.cancel();
            }
          } else assertPublic(await reply.text());
        }
        const joined = await command(env, c, 'room:join', { roomId });
        expect(joined.body.ack.ok).toBe(true);
        assertPublic(JSON.stringify(joined.body));
      }
      const saved = (await new CloudStore(env.DB).room(roomId))!.room;
      expect(saved.match!.currentHand.players[0]!.melds[0]!.tiles.map((tile) => tile.id)).toEqual(
        gangIds,
      );
      expect(saved.tableEvents.filter((event) => event.type === 'an-gang')).toHaveLength(1);
      expect(saved.match!.cumulativeScores).toEqual([1030, 990, 990, 990]);
    } finally {
      await Promise.all(streams.map((reader) => reader.cancel()));
    }
  });

  it('projects saved winning snapshots without IDs for hand, final match and reconnect responses', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = anGangRoom().match;
    stored.tableEvents = [];
    apply(stored, {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    });
    apply(stored, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    advance(stored);
    const originalScores = JSON.stringify(stored.scores);
    expect(originalScores).toContain('wan-1-1');
    const expected = JSON.parse(originalScores, (key, value) => (key === 'id' ? undefined : value));
    for (const status of ['playing', 'completed', 'ended'] as const) {
      stored.status = status;
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
      for (const c of clients) {
        const response = await call(env, '/api/connect', c);
        const raw = await response.text();
        const { state } = JSON.parse(raw) as { state: RoomView };
        expect(state.scores).toEqual(expected);
        expect(JSON.stringify(state.scores)).not.toMatch(/"id"\s*:/);
        expect(raw).not.toContain('wan-1-');
        const stream = (await call(env, '/api/stream', c)).body!.getReader();
        try {
          const frame = new TextDecoder().decode((await stream.read()).value);
          expect(JSON.parse(frame).state.scores).toEqual(expected);
          expect(frame).not.toContain('wan-1-');
        } finally {
          await stream.cancel();
        }
      }
      expect(JSON.stringify((await new CloudStore(env.DB).room(roomId))!.room.scores)).toBe(
        originalScores,
      );
    }
  });

  it.each(['flower-kong', 'four-winds-gathered', 'follow-discard'] as const)(
    'atomically commits %s confirmation once across failed receipts, racing retries and recovery',
    async (rule) => {
      const { env, db } = setup();
      const { clients, roomId } = await table(env);
      const stored = (await new CloudStore(env.DB).room(roomId))!.room;
      stored.match = specialRuleRoom(rule).match;
      stored.tableEvents = [];
      stored.nextTableEventId = 101;
      stored.nextTableEventSequence = 201;
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
      const getState = async (seat: number) =>
        ((await (await call(env, '/api/poll', clients[seat]!)).json()) as { state: RoomView })
          .state;
      const token = (await getState(0)).actions.choices.find(
        (choice) => choice.kind === 'discard',
      )!.token;
      const args = { roomId, token };
      const id = crypto.randomUUID();
      const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      db.db.exec(
        "CREATE TRIGGER fail_special_receipt BEFORE INSERT ON cloud_commands BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect((await command(env, clients[0]!, 'game:action', args, id)).response.status).toBe(503);
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
      expect(db.db.prepare('SELECT * FROM cloud_commands WHERE id=?').get(id)).toBeUndefined();
      db.db.exec('DROP TRIGGER fail_special_receipt');
      const replies = await Promise.all([
        command(env, clients[0]!, 'game:action', args, id),
        command(env, clients[0]!, 'game:action', args, id),
      ]);
      expect(replies[0]!.body.ack.ok).toBe(true);
      expect(replies[1]!.body.ack).toEqual(replies[0]!.body.ack);
      expect(db.versionConflicts).toBeGreaterThan(0);
      const saved = (await new CloudStore(env.DB).room(roomId))!.room;
      const facts = saved.tableEvents.filter((event) => event.type === 'special-rule-confirmed');
      expect(facts).toEqual([
        expect.objectContaining({
          rule,
          seat: rule === 'flower-kong' ? 1 : rule === 'follow-discard' ? 1 : 0,
        }),
      ]);
      expect(replies[0]!.body.state!.tableEvents).toEqual(saved.tableEvents);
      expect(saved.tableEvents.map(({ id, sequence }) => [id, sequence])).toEqual(
        saved.tableEvents.map((_, index) => [101 + index, 201 + index]),
      );
      expect(saved.nextTableEventId).toBe(101 + saved.tableEvents.length);
      expect(saved.nextTableEventSequence).toBe(201 + saved.tableEvents.length);
      expect(facts[0]!.sequence).toBeLessThan(
        saved.tableEvents.find((event) => event.type === 'score-changed')!.sequence,
      );
      const committed = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      clients[1]!.peer = crypto.randomUUID();
      expect((await call(env, '/api/connect', clients[1]!)).status).toBe(200);
      for (const seat of [0, 1, 2, 3]) {
        const state = await getState(seat);
        expect(state.tableEvents).toEqual(saved.tableEvents);
        expect(JSON.stringify(state.tableEvents)).not.toContain(token);
        expect(JSON.stringify(state.tableEvents)).not.toContain('wan-9-4');
      }
      expect((await command(env, clients[0]!, 'game:action', args, id)).body.ack).toEqual(
        replies[0]!.body.ack,
      );
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(committed);
    },
  );

  it('persists a two-to-three mouth upgrade once through failed writes and racing command retries', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const getState = async (seat: number) =>
      ((await (await call(env, '/api/poll', clients[seat]!)).json()) as { state: RoomView }).state;
    let stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = eventRoom().match;
    stored.tableEvents = [];
    const game = stored.match!.currentHand;
    game.threeMouthState = [
      game.threeMouthState[0],
      { status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 },
      game.threeMouthState[2],
      game.threeMouthState[3],
    ];
    for (const rank of [1, 2]) {
      // Legal stage fixture for the next claim; carry forward the real first lock and meld.
      const hand = stored.match!.currentHand;
      hand.currentPlayerIndex = 0;
      hand.turnStage = 'waiting-for-discard';
      hand.pendingAction = { type: 'discard', playerIndex: 0, seat: 'east' };
      hand.wall = ['tong-9-3', 'tong-9-4'].map(ordinary);
      setEventHand(stored, 0, [ordinary(`wan-${rank}-1`)]);
      setEventHand(
        stored,
        1,
        [2, 3].map((copy) => ordinary(`wan-${rank}-${copy}`)),
      );
      setEventHand(stored, 2, [ordinary('tong-5-1'), ordinary('tong-5-2')]);
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
      const discard = (await getState(0)).actions.choices.find(
        (choice) => choice.kind === 'discard',
      )!;
      expect(
        (await command(env, clients[0]!, 'game:action', { roomId, token: discard.token })).body.ack
          .ok,
      ).toBe(true);
      const peng = (await getState(1)).actions.choices.find((choice) => choice.kind === 'peng')!;
      expect(
        (await getState(1)).tableEvents.filter((event) => event.type === 'mouth-locked'),
      ).toHaveLength(rank - 1);
      const args = { roomId, token: peng.token };
      const id = crypto.randomUUID();
      const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      db.db.exec(
        "CREATE TRIGGER fail_lock_receipt BEFORE INSERT ON cloud_commands BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect((await command(env, clients[1]!, 'game:action', args, id)).response.status).toBe(503);
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
      expect(db.db.prepare('SELECT * FROM cloud_commands WHERE id=?').get(id)).toBeUndefined();
      db.db.exec('DROP TRIGGER fail_lock_receipt');
      const [accepted, retried] = await Promise.all([
        command(env, clients[1]!, 'game:action', args, id),
        command(env, clients[1]!, 'game:action', args, id),
      ]);
      expect(accepted.body.ack.ok).toBe(true);
      expect(retried.body.ack).toEqual(accepted.body.ack);
      expect((await command(env, clients[1]!, 'game:action', args, id)).body.ack).toEqual(
        accepted.body.ack,
      );
      stored = (await new CloudStore(env.DB).room(roomId))!.room;
      expect(
        stored.tableEvents
          .filter((event) => event.type === 'mouth-locked')
          .map((event) => [event.seat, event.fromSeat, event.mouths]),
      ).toEqual(
        rank === 1
          ? [[1, 0, 2]]
          : [
              [1, 0, 2],
              [1, 0, 3],
            ],
      );
    }
    for (const seat of [0, 1, 2, 3])
      expect((await getState(seat)).tableEvents).toEqual(stored.tableEvents);
    expect(db.versionConflicts).toBeGreaterThan(0);
    expect((await new CloudStore(env.DB).room(roomId))!.room.tableEvents).toEqual(
      stored.tableEvents,
    );
  });
  it.each(['self-draw', 'draw'] as const)(
    'persists a %s result and one completed settlement',
    async (result) => {
      const { env, db } = setup();
      const { clients, roomId } = await table(env);
      const stored = (await new CloudStore(env.DB).room(roomId))!.room;
      stored.match = eventRoom({ wall: [] }).match;
      const game = stored.match!.currentHand;
      setEventHand(
        stored,
        0,
        result === 'draw'
          ? [ordinary('wan-1-1')]
          : [
              'wan-1-1',
              'wan-2-1',
              'wan-3-1',
              'wan-4-1',
              'wan-5-1',
              'wan-6-1',
              'tiao-1-1',
              'tiao-2-1',
              'tiao-3-1',
              'tong-1-1',
              'tong-2-1',
              'tong-3-1',
              'wind-east-1',
              'wind-east-2',
            ].map(ordinary),
      );
      if (result === 'self-draw')
        game.selfDrawProvenance = { source: 'wall-head', playerIndex: 0, tileId: 'wind-east-2' };
      const firstId = stored.nextTableEventId;
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
      const state = (
        (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }
      ).state;
      const kind = result === 'draw' ? 'discard' : 'hu';
      const args = {
        roomId,
        token: state.actions.choices.find((choice) => choice.kind === kind)!.token,
      };
      const id = crypto.randomUUID();
      const reply = await command(env, clients[0]!, 'game:action', args, id);
      expect(reply.body.ack.ok).toBe(true);
      const saved = (await new CloudStore(env.DB).room(roomId))!.room;
      expect(
        saved.tableEvents.filter((event) => event.id >= firstId).map((event) => event.type),
      ).toEqual(
        result === 'draw'
          ? ['tile-discarded', 'draw', 'hand-settled']
          : ['hu', 'score-changed', 'hand-settled'],
      );
      expect(saved.match!.currentHandStatus).toBe('completed');
      expect((await command(env, clients[0]!, 'game:action', args, id)).body.ack).toEqual(
        reply.body.ack,
      );
      expect((await new CloudStore(env.DB).room(roomId))!.room.tableEvents).toEqual(
        saved.tableEvents,
      );
    },
  );
  it('commits concurrent multi-hu responses with one final settlement and stable events after reconnect', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = buGangRoom().match;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const getState = async (seat: number) =>
      ((await (await call(env, '/api/poll', clients[seat]!)).json()) as { state: RoomView }).state;
    const token = (await getState(0)).actions.choices.find(
      (choice) => choice.kind === 'discard',
    )!.token;
    expect((await command(env, clients[0]!, 'game:action', { roomId, token })).body.ack.ok).toBe(
      true,
    );
    const requests = await Promise.all(
      [1, 2, 3].map(async (seat) => ({
        seat,
        id: crypto.randomUUID(),
        args: {
          roomId,
          token: (await getState(seat)).actions.choices.find((choice) => choice.kind === 'hu')!
            .token,
        },
      })),
    );
    const replies = await Promise.all(
      requests.map(({ seat, args, id }) => command(env, clients[seat]!, 'game:action', args, id)),
    );
    expect(replies.every((reply) => reply.body.ack.ok)).toBe(true);
    expect(db.versionConflicts).toBeGreaterThan(0);
    const saved = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(saved.match!.currentHandStatus).toBe('completed');
    expect(
      saved.tableEvents.filter((event) => event.type === 'hu').map((event) => event.winnerSeats),
    ).toEqual([[1], [2], [3]]);
    const settlements = saved.tableEvents.filter((event) => event.type === 'hand-settled');
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.winnerSeats).toEqual([1, 2, 3]);
    expect(settlements[0]!.changes).toEqual(
      saved.match!.cumulativeScores.map((score, seat) => ({ seat, delta: score - 1000 })),
    );
    for (const { seat, args, id } of requests)
      expect((await command(env, clients[seat]!, 'game:action', args, id)).body.ack.ok).toBe(true);
    clients[1]!.peer = crypto.randomUUID();
    expect((await call(env, '/api/connect', clients[1]!)).status).toBe(200);
    for (const seat of [0, 1, 2, 3])
      expect((await getState(seat)).tableEvents).toEqual(saved.tableEvents);
    const restored = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(restored.tableEvents).toEqual(saved.tableEvents);
    expect([restored.nextTableEventId, restored.nextTableEventSequence]).toEqual([
      saved.nextTableEventId,
      saved.nextTableEventSequence,
    ]);
    expect(restored.scores).toEqual(saved.scores);
  });

  it('does not commit game state or reset scores when event generation fails', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = specialRuleRoom('four-winds-gathered').match;
    stored.scores = [{ hand: 1, reason: '历史记录', transfers: [{ from: 1, to: 0, amount: 10 }] }];
    stored.nextTableEventId = Number.MAX_SAFE_INTEGER - 1;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const state = (
      (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }
    ).state;
    const token = state.actions.choices.find((choice) => choice.kind === 'discard')!.token;
    const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
    const receipts = db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all();
    expect(
      (await command(env, clients[0]!, 'game:action', { roomId, token })).response.status,
    ).toBe(503);
    expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
    expect(db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all()).toEqual(
      receipts,
    );
  });
  it('does not publish or save an already generated confirmation when scoring fails', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = (await new CloudStore(env.DB).room(roomId))!.room;
    stored.match = specialRuleRoom('four-winds-gathered').match;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const state = (
      (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }
    ).state;
    const token = state.actions.choices.find((choice) => choice.kind === 'discard')!.token;
    const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
    const id = crypto.randomUUID();
    const settle = vi.spyOn(core, 'settlePendingScoringEvents').mockImplementationOnce(() => {
      throw new Error('simulated scoring failure');
    });
    try {
      const failed = await command(env, clients[0]!, 'game:action', { roomId, token }, id);
      expect(failed.response.status).toBe(503);
      expect(failed.body.state).toBeUndefined();
      expect(settle).toHaveBeenCalledOnce();
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
      expect(db.db.prepare('SELECT * FROM cloud_commands WHERE id=?').get(id)).toBeUndefined();
    } finally {
      settle.mockRestore();
    }
  });
  it.each([false, true])(
    'persists bu-gang resolution without premature success (robbed=%s)',
    async (robbed) => {
      const { env, db } = setup();
      const { clients, roomId } = await table(env);
      const stored = JSON.parse(
        String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
      ) as CloudRoom;
      stored.match = buGangRoom().match;
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
      const initialEvents = structuredClone(stored.tableEvents);
      const getState = async (seat: number) =>
        ((await (await call(env, '/api/poll', clients[seat]!)).json()) as { state: RoomView })
          .state;
      const declare = (await getState(0)).actions.choices.find(
        (choice) => choice.kind === 'bu-gang',
      )!;
      const declared = await command(env, clients[0]!, 'game:action', {
        roomId,
        token: declare.token,
      });
      expect(declared.body.ack.ok).toBe(true);
      expect(declared.body.state!.tableEvents).toEqual(initialEvents);
      expect(declared.body.state!.responseWindow).toEqual({ source: 'bu-gang', actorSeat: 0 });
      for (const seat of [1, 2, 3]) {
        const state = await getState(seat);
        const kind = robbed && seat === 1 ? 'hu' : 'pass';
        const token = state.actions.choices.find((choice) => choice.kind === kind)!.token;
        const args = { roomId, token };
        const id = crypto.randomUUID();
        const accepted = await command(env, clients[seat]!, 'game:action', args, id);
        expect(accepted.body.ack.ok).toBe(true);
        if (seat < 3) {
          expect(accepted.body.state!.tableEvents).toEqual(initialEvents);
          expect(accepted.body.state!.responseWindow).toEqual({ source: 'bu-gang', actorSeat: 0 });
        } else expect(accepted.body.state!.responseWindow).toBeUndefined();
        expect((await command(env, clients[seat]!, 'game:action', args, id)).body.ack).toEqual(
          accepted.body.ack,
        );
      }
      const saved = (await new CloudStore(env.DB).room(roomId))!.room;
      expect(saved.tableEvents.filter((event) => event.type === 'bu-gang')).toHaveLength(
        robbed ? 0 : 1,
      );
      expect(saved.match!.currentHand.players[0]!.melds[0]!.type).toBe(robbed ? 'peng' : 'bu-gang');
      for (const seat of [0, 1, 2, 3])
        expect((await getState(seat)).tableEvents).toEqual(saved.tableEvents);
    },
  );
  it('atomically persists real discard and flower events, then replays a lost acknowledgement', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const row = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)!;
    const stored = JSON.parse(String(row.body)) as CloudRoom;
    expect(stored.tableEvents.filter((event) => event.type === 'hand-started')).toHaveLength(1);
    stored.match = eventRoom({
      wall: ['flower-plum-1', 'wan-9-1', 'flower-orchid-1'].map(eventTile),
    }).match;
    setEventHand(stored, 0, [ordinary('wan-1-1')]);
    const firstId = stored.nextTableEventId;
    const firstSequence = stored.nextTableEventSequence;
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const state = (
      (await (await call(env, '/api/poll', clients[0]!)).json()) as { state: RoomView }
    ).state;
    const args = {
      roomId,
      token: state.actions.choices.find((choice) => choice.kind === 'discard')!.token,
    };
    const commandId = crypto.randomUUID();
    db.db.exec(
      "CREATE TRIGGER fail_event_receipt BEFORE INSERT ON cloud_commands BEGIN SELECT RAISE(ABORT,'simulated failure'); END;",
    );
    const before = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
    expect((await command(env, clients[0]!, 'game:action', args, commandId)).response.status).toBe(
      503,
    );
    expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
    expect(db.db.prepare('SELECT * FROM cloud_commands WHERE id=?').get(commandId)).toBeUndefined();
    db.db.exec('DROP TRIGGER fail_event_receipt');
    const accepted = await command(env, clients[0]!, 'game:action', args, commandId);
    expect(accepted.body.ack.ok).toBe(true);
    const committed = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)!;
    const saved = JSON.parse(String(committed.body)) as CloudRoom;
    const events = saved.tableEvents.filter((event) => event.id >= firstId);
    expect(events.map((event) => event.type)).toEqual([
      'tile-discarded',
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
    ]);
    expect(events.map((event) => [event.id, event.sequence])).toEqual(
      events.map((_, index) => [firstId + index, firstSequence + index]),
    );
    expect(saved.match!.currentHand.players[1]!.hand.map((tile) => tile.id)).toEqual(['wan-9-1']);
    expect(saved.nextTableEventId).toBe(firstId + events.length);
    expect(db.db.prepare('SELECT * FROM cloud_commands WHERE id=?').get(commandId)).toBeDefined();
    // Ignore the first response, as if it timed out after the transaction committed.
    expect((await command(env, clients[0]!, 'game:action', args, commandId)).body.ack).toEqual(
      accepted.body.ack,
    );
    expect((await command(env, clients[0]!, 'game:action', args)).body.ack.ok).toBe(false);
    for (const client of clients) {
      const visible = ((await (await call(env, '/api/poll', client)).json()) as { state: RoomView })
        .state;
      expect(visible.tableEvents).toEqual(saved.tableEvents);
      expect(JSON.stringify(visible.tableEvents)).not.toContain('wan-9-1');
      expect(JSON.stringify(visible.tableEvents)).not.toContain(args.token);
    }
    expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(committed);
  });
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
    expect(next.rules).toBe('V1.0.11');
    expect(next.match!.currentHand.legacyThreeMouth).toBeUndefined();
  });
  it.each(['V1.0.9', 'V1.0.10'] as const)(
    'all D1 read paths upgrade %s metadata without changing match or history',
    async (version) => {
      const { env, db } = setup();
      const { clients, roomId } = await table(env);
      const raw = JSON.parse(
        String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
      ) as CloudRoom;
      raw.rules = version;
      db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(raw), roomId);
      const store = new CloudStore(env.DB);
      const session = clients[0]!.cookie.split('=')[1]!;
      const direct = await store.room(roomId);
      const polled = await store.poll(session, clients[0]!.peer);
      const context = await store.context(session, clients[0]!.peer);
      for (const loaded of [direct, polled.loaded, context.loaded]) {
        expect(loaded!.room).toEqual({ ...raw, rules: 'V1.0.11' });
      }
    },
  );
  it('persists artificial public events and clears only their history on rematch', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const stored = JSON.parse(
      String(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)!.body),
    ) as CloudRoom;
    appendTableEvents(stored, [
      { type: 'tile-drawn', hand: 1, seat: 0 },
      {
        type: 'tile-discarded',
        hand: 1,
        seat: 0,
        tile: { family: 'wan', label: '1万' },
      },
    ]);
    db.db.prepare('UPDATE cloud_rooms SET body=? WHERE id=?').run(JSON.stringify(stored), roomId);
    const restored = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(restored.tableEvents).toEqual(stored.tableEvents);
    const counters = [stored.nextTableEventId, stored.nextTableEventSequence];
    expect([restored.nextTableEventId, restored.nextTableEventSequence]).toEqual(counters);
    const views = await Promise.all(
      clients.map(
        async (c) =>
          ((await (await call(env, '/api/poll', c)).json()) as { state: RoomView }).state,
      ),
    );
    expect(views.map(({ tableEvents }) => tableEvents)).toEqual(
      Array.from({ length: 4 }, () => stored.tableEvents),
    );
    expect((await command(env, clients[0]!, 'room:end', { roomId })).body.ack.ok).toBe(true);
    expect((await command(env, clients[0]!, 'room:rematch', { roomId })).body.ack.ok).toBe(true);
    const rematch = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(rematch.tableEvents).toEqual([]);
    expect([rematch.nextTableEventId, rematch.nextTableEventSequence]).toEqual(counters);
    for (const client of clients)
      expect((await command(env, client, 'room:ready', { roomId, ready: true })).body.ack.ok).toBe(
        true,
      );
    expect((await command(env, clients[0]!, 'room:start', { roomId })).body.ack.ok).toBe(true);
    const restarted = (await new CloudStore(env.DB).room(roomId))!.room;
    expect(restarted.tableEvents[0]).toMatchObject({
      type: 'hand-started',
      id: counters[0],
      sequence: counters[1],
      hand: 1,
    });
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
    const rejected = await command(env, c, 'room:ready', { roomId, ready: true });
    expect(rejected.response.status).toBe(503);
    expect(rejected.body).toEqual({
      error: { code: 'UNAVAILABLE', message: '服务暂时不可用，请稍后重试' },
    });
    expect(db.db.prepare('SELECT body FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(before);
  });
  it.each(['missing', 'corrupt', 'unsupported'] as const)(
    'reports a %s event archive without rewriting room state, version, or receipts',
    async (kind) => {
      const { env, db } = setup();
      const { clients, roomId } = await table(env);
      const c = clients[0]!;
      const row = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)!;
      const corrupt = JSON.parse(String(row.body)) as CloudRoom;
      corrupt.scores.push({
        hand: 1,
        reason: '既有计分',
        transfers: [{ from: 0, to: 1, amount: 10 }],
      });
      appendTableEvents(corrupt, [{ type: 'tile-drawn', hand: 1, seat: 0 }]);
      if (kind === 'missing') delete (corrupt as Partial<CloudRoom>).nextTableEventSequence;
      else if (kind === 'corrupt') corrupt.nextTableEventSequence = 0;
      else Object.assign(corrupt, { tableEventSchemaVersion: 3 });
      db.db
        .prepare('UPDATE cloud_rooms SET body=? WHERE id=?')
        .run(JSON.stringify(corrupt), roomId);
      const beforeRoom = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      const beforeReceipts = db.db
        .prepare('SELECT * FROM cloud_commands ORDER BY session,id')
        .all();
      for (const path of ['/api/command', '/api/connect', '/api/poll', '/api/stream']) {
        const rejected = await call(env, path, c, {
          event: 'room:end',
          command: { commandId: crypto.randomUUID(), roomId },
        });
        expect(rejected.status).toBe(503);
        expect(await rejected.json()).toEqual({
          error: {
            code: 'ROOM_EVENT_ARCHIVE_INCOMPATIBLE',
            message: '牌桌事件历史存档不兼容或已损坏，房间暂不可用，请联系管理员核查并修复存档。',
          },
        });
        expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(
          beforeRoom,
        );
        expect(db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all()).toEqual(
          beforeReceipts,
        );
      }
    },
  );

  it('reports archive damage after a stream opens and closes without modifying the archive', async () => {
    const { env, db } = setup();
    const { clients, roomId } = await table(env);
    const response = await call(env, '/api/stream', clients[0]!);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const next = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value));
    try {
      expect((await next()).state.id).toBe(roomId);
      db.db
        .prepare("UPDATE cloud_rooms SET body=json_remove(body,'$.tableEvents') WHERE id=?")
        .run(roomId);
      const beforeRoom = db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId);
      const beforeReceipts = db.db
        .prepare('SELECT * FROM cloud_commands ORDER BY session,id')
        .all();
      expect(await next()).toEqual({
        error: {
          code: 'ROOM_EVENT_ARCHIVE_INCOMPATIBLE',
          message: '牌桌事件历史存档不兼容或已损坏，房间暂不可用，请联系管理员核查并修复存档。',
        },
      });
      expect((await reader.read()).done).toBe(true);
      expect(db.db.prepare('SELECT * FROM cloud_rooms WHERE id=?').get(roomId)).toEqual(beforeRoom);
      expect(db.db.prepare('SELECT * FROM cloud_commands ORDER BY session,id').all()).toEqual(
        beforeReceipts,
      );
    } finally {
      await reader.cancel();
    }
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
  expect(
    saved.tableEvents.filter((event) => event.type === 'hand-started' && event.hand === hand + 2),
  ).toHaveLength(1);
  expect(saved.nextHandReady).toEqual([]);
  expect((await command(env, clients[0]!, 'room:next-ready', { roomId, token })).body.ack.ok).toBe(
    false,
  );
});
