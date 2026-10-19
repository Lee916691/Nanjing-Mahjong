import { afterEach, describe, expect, it } from 'vitest';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { CommandAck, RoomView } from '@nanjing-mahjong/shared-types';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import type { OrdinaryHandTile } from '@nanjing-mahjong/game-core';
import { appendTableEvents, choices } from '../src/table.js';
import { specialRuleRoom } from './event-fixture.js';

const resources: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of resources.reverse()) await cleanup();
  resources.length = 0;
});
async function server(path = ':memory:') {
  const app = createApp({ dbPath: path, tickMs: 50 });
  await new Promise<void>((r) => app.http.listen(0, '127.0.0.1', r));
  const address = app.http.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  resources.push(() => app.close());
  return { ...app, url: `http://127.0.0.1:${address.port}` };
}
async function client(url: string, existingCookie?: string) {
  const response = await fetch(url + '/api/session', {
    method: 'POST',
    headers: existingCookie ? { cookie: existingCookie } : {},
  });
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const socket = io(url, { extraHeaders: { cookie }, reconnection: false, autoConnect: false });
  const client = { socket, cookie, state: null as RoomView | null, states: [] as RoomView[] };
  socket.on('room:state', (s: RoomView) => {
    client.state = s;
    client.states.push(s);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  resources.push(() => {
    socket.disconnect();
  });
  return client;
}
const send = (
  socket: Socket,
  event: string,
  data: Record<string, unknown> = {},
): Promise<CommandAck> =>
  new Promise((resolve, reject) =>
    socket
      .timeout(2000)
      .emit(event, { commandId: randomUUID(), ...data }, (error: Error | null, ack: CommandAck) =>
        error ? reject(error) : resolve(ack),
      ),
  );
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition timed out');
};
async function table(url: string) {
  const clients = await Promise.all(Array.from({ length: 4 }, () => client(url)));
  const result = await send(clients[0]!.socket, 'room:create', { name: '东家' });
  expect(result.ok).toBe(true);
  const roomId = result.roomId!;
  for (let i = 1; i < 4; i++)
    expect((await send(clients[i]!.socket, 'room:join', { roomId, name: '朋友' + i })).ok).toBe(
      true,
    );
  for (const c of clients)
    expect((await send(c.socket, 'room:ready', { roomId, ready: true })).ok).toBe(true);
  expect((await send(clients[0]!.socket, 'room:start', { roomId })).ok).toBe(true);
  await wait(() => clients.every((c) => c.state?.status === 'playing'));
  return { clients, roomId };
}
describe('authoritative room service', () => {
  it('starts a two-player room and binds new Node receipts to the selected mode', async () => {
    const app = await server();
    const players = await Promise.all([client(app.url), client(app.url), client(app.url)]);
    const commandId = randomUUID();
    const args = { commandId, name: '双人房主', ruleSetId: 'nanjing-open-duo' };
    const created = await send(players[0]!.socket, 'room:create', args);
    expect(created.ok).toBe(true);
    expect(await send(players[0]!.socket, 'room:create', args)).toEqual(created);
    expect(
      (await send(players[0]!.socket, 'room:create', { ...args, ruleSetId: 'nanjing-open' })).error
        ?.code,
    ).toBe('DUPLICATE_ID');
    const roomId = created.roomId!;
    expect(
      (
        await send(players[1]!.socket, 'room:join', {
          roomId,
          name: '对手',
          ruleSetId: 'nanjing-open',
        })
      ).error?.code,
    ).toBe('BAD_REQUEST');
    expect((await send(players[1]!.socket, 'room:join', { roomId, name: '对手' })).ok).toBe(true);
    expect(
      (await send(players[2]!.socket, 'room:join', { roomId, name: '第三人' })).error?.code,
    ).toBe('ROOM_FULL');
    for (const player of players.slice(0, 2))
      await send(player.socket, 'room:ready', { roomId, ready: true });
    expect((await send(players[0]!.socket, 'room:start', { roomId })).ok).toBe(true);
    await wait(() => players[0]!.state?.status === 'playing');
    expect(players[0]!.state).toMatchObject({
      ruleSetId: 'nanjing-open-duo',
      totalEffectiveDealerTurns: 8,
    });
    expect(players[0]!.state!.players).toHaveLength(2);
    expect(players[0]!.state!.players[1]!.hand).toBeUndefined();
  });
  it.each(['flower-kong', 'four-winds-gathered', 'follow-discard'] as const)(
    'commits %s with its receipt once and restores all public views after a failed write',
    async (rule) => {
      const app = await server();
      const { clients, roomId } = await table(app.url);
      const room = app.rooms.get(roomId)!;
      room.match = specialRuleRoom(rule).match;
      room.tableEvents = [];
      app.store.commit(room);
      const token = choices(room, 0, app.store.secret()).find(
        (choice) => choice.view.kind === 'discard',
      )!.view.token;
      const args = { roomId, token, commandId: randomUUID() };
      const before = structuredClone(room);
      const row = app.store.db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId);
      app.store.db.exec(
        "CREATE TRIGGER fail_special_write BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect((await send(clients[0]!.socket, 'game:action', args)).ok).toBe(false);
      expect(app.rooms.get(roomId)).toEqual(before);
      expect(app.store.db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId)).toEqual(row);
      expect(
        app.store.db.prepare('SELECT * FROM commands WHERE id=?').get(args.commandId),
      ).toBeUndefined();
      app.store.db.exec('DROP TRIGGER fail_special_write');
      const accepted = await send(clients[0]!.socket, 'game:action', args);
      expect(accepted.ok).toBe(true);
      expect(await send(clients[0]!.socket, 'game:action', args)).toEqual(accepted);
      const saved = app.rooms.get(roomId)!;
      expect(saved.tableEvents.filter((event) => event.type === 'special-rule-confirmed')).toEqual([
        expect.objectContaining({ rule }),
      ]);
      await wait(() =>
        clients.every(
          (client) =>
            client.state?.tableEvents.some(
              (event) => event.type === 'special-rule-confirmed' && event.rule === rule,
            ) ?? false,
        ),
      );
      for (const client of clients) expect(client.state!.tableEvents).toEqual(saved.tableEvents);
      expect(app.store.rooms().find((room) => room.id === roomId)!.tableEvents).toEqual(
        saved.tableEvents,
      );
      const returning = await client(app.url, clients[0]!.cookie);
      await wait(() => returning.state !== null);
      expect(returning.state!.tableEvents).toEqual(saved.tableEvents);
      expect(app.rooms.get(roomId)!.nextTableEventId).toBe(saved.nextTableEventId);
    },
  );
  it('creates four seats, rejects a fifth and isolates every hand', async () => {
    const app = await server();
    const { clients, roomId } = await table(app.url);
    for (let i = 0; i < 4; i++) {
      const state = clients[i]!.state!;
      expect(state.self).toBe(i);
      expect(state.players[i]?.hand?.length).toBeGreaterThan(0);
      expect(state.players.filter((_, j) => j !== i).every((p) => p && !('hand' in p))).toBe(true);
      expect(state.players.filter((_, j) => j !== i).every((p) => p && !('drawnTileId' in p))).toBe(
        true,
      );
      const own = state.players[i]!;
      if (own.drawnTileId) expect(own.hand?.some((t) => t.id === own.drawnTileId)).toBe(true);
      const serialized = JSON.stringify(state);
      for (const field of [
        'winningTileFaces',
        'pendingPlayerIndices',
        'selfDrawProvenance',
        'responderOrder',
        'wall"',
        'session"',
        'passHu',
      ])
        expect(serialized).not.toContain(field);
    }
    const fifth = await client(app.url);
    expect((await send(fifth.socket, 'room:join', { roomId, name: '第五人' })).ok).toBe(false);
    const invalid = await send(clients[0]!.socket, 'game:action', {
      roomId,
      playerIndex: 1,
      type: 'DRAW_TILE',
    });
    expect(invalid.ok).toBe(false);
  });
  it('persists acknowledgements, rejects stale tokens and pauses on disconnect', async () => {
    const app = await server();
    const { clients, roomId } = await table(app.url);
    const player = clients.find((c) => c.state!.actions.choices.length)!;
    const action =
      player.state!.actions.choices.find((c) => c.kind === 'discard') ??
      player.state!.actions.choices[0]!;
    const commandId = randomUUID(),
      data = { roomId, token: action.token, commandId };
    const first = await send(player.socket, 'game:action', data);
    expect(first.ok).toBe(true);
    const epoch = app.rooms.get(roomId)!.epoch;
    const eventState = structuredClone({
      events: app.rooms.get(roomId)!.tableEvents,
      id: app.rooms.get(roomId)!.nextTableEventId,
      sequence: app.rooms.get(roomId)!.nextTableEventSequence,
    });
    expect(await send(player.socket, 'game:action', data)).toEqual(first);
    expect(app.rooms.get(roomId)!.epoch).toBe(epoch);
    expect({
      events: app.rooms.get(roomId)!.tableEvents,
      id: app.rooms.get(roomId)!.nextTableEventId,
      sequence: app.rooms.get(roomId)!.nextTableEventSequence,
    }).toEqual(eventState);
    expect((await send(player.socket, 'game:action', { roomId, token: action.token })).ok).toBe(
      false,
    );
    clients[3]!.socket.disconnect();
    await wait(() => clients[0]!.state!.paused);
    const pending = clients.find((c) => c.socket.connected)!;
    expect(
      (await send(pending.socket, 'game:action', { roomId, token: action.token })).error?.code,
    ).toBe('PAUSED');
    const replacement = await client(app.url, clients[3]!.cookie);
    await wait(() => replacement.state?.paused === false);
    expect(replacement.state?.self).toBe(3);
  });
  it('restores a stored match and anonymous seats after a process restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mahjong-'));
    resources.unshift(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'state.sqlite'),
      app = await server(path);
    const { clients, roomId } = await table(app.url);
    const actorIndex = clients.findIndex((c) => c.state!.actions.choices.length > 0);
    const command = {
      roomId,
      commandId: randomUUID(),
      token: clients[actorIndex]!.state!.actions.choices[0]!.token,
    };
    const receipt = await send(clients[actorIndex]!.socket, 'game:action', command);
    expect(receipt.ok).toBe(true);
    const saved = structuredClone(app.rooms.get(roomId)!.match);
    const savedEvents = structuredClone(app.rooms.get(roomId)!.tableEvents);
    const savedCounters = [
      app.rooms.get(roomId)!.nextTableEventId,
      app.rooms.get(roomId)!.nextTableEventSequence,
    ];
    const cookies = clients.map((c) => c.cookie);
    for (const c of clients) c.socket.disconnect();
    await app.close();
    // createApp.close is made idempotent so a failed assertion still closes all resources.
    const restored = await server(path);
    const returning = await Promise.all(cookies.map((cookie) => client(restored.url, cookie)));
    await wait(() => returning.every((c) => c.state?.paused === false));
    expect(restored.rooms.get(roomId)!.match).toEqual(saved);
    expect(restored.rooms.get(roomId)!.tableEvents).toEqual(savedEvents);
    expect([
      restored.rooms.get(roomId)!.nextTableEventId,
      restored.rooms.get(roomId)!.nextTableEventSequence,
    ]).toEqual(savedCounters);
    expect(returning.map((c) => c.state?.self)).toEqual([0, 1, 2, 3]);
    expect(await send(returning[actorIndex]!.socket, 'game:action', command)).toEqual(receipt);
    expect(restored.rooms.get(roomId)!.match).toEqual(saved);
  });
  it('backs up a live database with committed rooms and identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mahjong-backup-'));
    resources.unshift(() => rmSync(dir, { recursive: true, force: true }));
    const app = await server(join(dir, 'live.sqlite'));
    const { roomId, clients } = await table(app.url);
    const backupPath = join(dir, 'copy.sqlite');
    await app.backup(backupPath);
    const copy = new Store(backupPath);
    try {
      expect(copy.rooms().find((r) => r.id === roomId)).toEqual(app.rooms.get(roomId));
    } finally {
      copy.close();
    }
    const restored = await server(backupPath);
    const returning = await Promise.all(clients.map((c) => client(restored.url, c.cookie)));
    await wait(() => returning.every((c) => c.state?.paused === false));
    expect(restored.rooms.get(roomId)!.match).toEqual(app.rooms.get(roomId)!.match);
  });
  it('any seated player may end, while only the host may start a rematch', async () => {
    const app = await server();
    const { clients, roomId } = await table(app.url);
    const room = app.rooms.get(roomId)!;
    appendTableEvents(room, [{ type: 'tile-drawn', hand: 1, seat: 0 }]);
    const counters = [room.nextTableEventId, room.nextTableEventSequence];
    expect((await send(clients[1]!.socket, 'room:end', { roomId })).ok).toBe(true);
    expect((await send(clients[1]!.socket, 'room:rematch', { roomId })).ok).toBe(false);
    expect(app.rooms.get(roomId)!.status).toBe('ended');
    expect((await send(clients[0]!.socket, 'room:rematch', { roomId })).ok).toBe(true);
    expect(app.rooms.get(roomId)!.status).toBe('waiting');
    expect(app.rooms.get(roomId)!.members.every((m) => m?.ready === false)).toBe(true);
    expect(app.rooms.get(roomId)!.tableEvents).toEqual([]);
    expect([
      app.rooms.get(roomId)!.nextTableEventId,
      app.rooms.get(roomId)!.nextTableEventSequence,
    ]).toEqual(counters);
  });
});

it('rejects a valid action token belonging to another seat', async () => {
  const app = await server();
  const { clients, roomId } = await table(app.url);
  const acting = clients.find((c) => c.state!.actions.choices.length)!;
  const other = clients.find((c) => c !== acting)!;
  const token = acting.state!.actions.choices[0]!.token;
  const before = structuredClone(app.rooms.get(roomId));
  expect((await send(other.socket, 'game:action', { roomId, token })).ok).toBe(false);
  expect(app.rooms.get(roomId)).toEqual(before);
});
it('rolls back a command when the database transaction fails', async () => {
  const app = await server();
  const c = await client(app.url);
  const created = await send(c.socket, 'room:create', { name: '玩家' });
  const roomId = created.roomId!;
  const before = structuredClone(app.rooms.get(roomId));
  app.store.db.exec(
    "CREATE TRIGGER reject_write BEFORE INSERT ON rooms BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;",
  );
  const commandId = randomUUID();
  expect((await send(c.socket, 'room:ready', { roomId, ready: true, commandId })).ok).toBe(false);
  expect(app.rooms.get(roomId)).toEqual(before);
  app.store.db.exec('DROP TRIGGER reject_write');
  expect((await send(c.socket, 'room:ready', { roomId, ready: true, commandId })).ok).toBe(true);
  expect(app.rooms.get(roomId)!.members[0]!.ready).toBe(true);
});
it('a replacement connection takes control without releasing the seat', async () => {
  const app = await server();
  const { clients, roomId } = await table(app.url);
  const replacement = await client(app.url, clients[0]!.cookie);
  await wait(() => !clients[0]!.socket.connected && replacement.state !== null);
  expect(replacement.state!.self).toBe(0);
  expect(app.rooms.get(roomId)!.members.filter(Boolean)).toHaveLength(4);
  expect(replacement.state!.paused).toBe(false);
});
it('never broadcasts private response receipts to the other players', async () => {
  const app = await server();
  const { clients, roomId } = await table(app.url);
  const room = app.rooms.get(roomId)!;
  // A synthetic response window is confined to this test process; no network test hooks exist.
  const { createGame, createNanjingMahjongDeck, applyAction } =
    await import('@nanjing-mahjong/game-core');
  const deck = createNanjingMahjongDeck();
  const pick = (id: string) => deck.find((t) => t.id === id) as OrdinaryHandTile;
  const base = createGame();
  const game = {
    ...base,
    phase: 'playing' as const,
    turnStage: 'waiting-for-discard' as const,
    players: base.players.map((p, i) => ({
      ...p,
      hand: i === 0 ? [pick('wan-9-1')] : i === 1 ? [pick('wan-9-2'), pick('wan-9-3')] : [],
    })),
    pendingAction: { type: 'discard' as const, playerIndex: 0, seat: 'east' as const },
    wall: [pick('wan-8-1')],
  };
  room.match = {
    ...room.match!,
    currentHand: applyAction(game, { type: 'DISCARD_TILE', tileId: 'wan-9-1' }),
  };
  // Fourth player has an actionable response too, so player 1's receipt is still private.
  const window = room.match.currentHand.reactionWindow!;
  room.match = {
    ...room.match,
    currentHand: {
      ...room.match.currentHand,
      reactionWindow: {
        ...window,
        availableReactions: window.availableReactions.map((a) =>
          a.playerIndex === 3 ? { ...a, responseTypes: ['pass', 'hu'] } : a,
        ),
      },
    },
  };
  const { choices } = await import('../src/table.js');
  const pass = choices(room, 1, app.store.secret()).find((c) => c.view.kind === 'pass')!;
  const counts = clients.map((c) => c.states.length);
  expect(
    (await send(clients[1]!.socket, 'game:action', { roomId, token: pass.view.token })).ok,
  ).toBe(true);
  await new Promise((r) => setTimeout(r, 50));
  expect(clients[0]!.states.length).toBe(counts[0]);
  expect(clients[2]!.states.length).toBe(counts[2]);
  expect(clients[3]!.states.length).toBe(counts[3]);
});

it('freezes the next-hand countdown while a member is offline and resumes afterwards', async () => {
  const app = await server();
  const { clients, roomId } = await table(app.url);
  clients[3]!.socket.disconnect();
  await wait(() => clients[0]!.state!.paused);
  const room = app.rooms.get(roomId)!;
  room.match = {
    ...room.match!,
    currentHand: {
      ...room.match!.currentHand,
      phase: 'ended',
      turnStage: 'hand-ended',
      result: { type: 'draw', reason: 'wall-exhausted' },
    },
  };
  const { advance } = await import('../src/table.js');
  advance(room);
  room.remainingMs = 120;
  const hand = room.match!.currentHandIndex;
  await new Promise((r) => setTimeout(r, 250));
  expect(app.rooms.get(roomId)!.remainingMs).toBe(120);
  const replacement = await client(app.url, clients[3]!.cookie);
  await wait(() => replacement.state?.hand === hand + 2);
  expect(app.rooms.get(roomId)!.remainingMs).toBe(null);
});

it('keeps a declined Di Hu decision private while prompting the next eligible player', async () => {
  const app = await server();
  const { clients, roomId } = await table(app.url);
  const room = app.rooms.get(roomId)!;
  const { createGame, startGame } = await import('@nanjing-mahjong/game-core');
  room.match = { ...room.match!, currentHand: startGame(createGame()) };
  room.reactions = {};
  room.epoch++;
  const { choices } = await import('../src/table.js');
  const pass = choices(room, 1, app.store.secret()).find((c) => c.view.kind === 'pass')!;
  const counts = clients.map((c) => c.states.length),
    revision = room.revision;
  expect(
    (await send(clients[1]!.socket, 'game:action', { roomId, token: pass.view.token })).ok,
  ).toBe(true);
  await wait(() => clients[2]!.states.length > counts[2]!);
  expect(clients[0]!.states.length).toBe(counts[0]);
  expect(clients[3]!.states.length).toBe(counts[3]);
  expect(app.rooms.get(roomId)!.revision).toBe(revision);
  expect(clients[2]!.state!.actions.choices.map((c) => c.kind)).toContain('di-hu');
});
