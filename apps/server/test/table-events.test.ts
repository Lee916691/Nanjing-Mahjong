import { describe, expect, it, vi } from 'vitest';
import type { TableEvent } from '@nanjing-mahjong/shared-types';
import {
  advance,
  appendTableEvents,
  newRoom,
  nextHand,
  restoreRoomRules,
  start,
  TableEventArchiveError,
  view,
} from '../src/table.js';

const tile = { family: 'wan', label: '1万' };
const event = (id: number, sequence = id): TableEvent => ({
  id,
  sequence,
  type: 'tile-discarded',
  hand: 1,
  seat: 0,
  tile,
});
const rawRoom = () =>
  structuredClone(newRoom('session-0', '东家')) as unknown as Record<string, unknown>;
const restore = (raw: Record<string, unknown>) =>
  restoreRoomRules(raw as unknown as ReturnType<typeof newRoom>);

describe('table event archive', () => {
  it('keeps a valid v1 archive until the first append upgrades it without replay', () => {
    const raw = rawRoom();
    raw.tableEventSchemaVersion = 1;
    raw.tableEvents = [event(20, 30)];
    raw.nextTableEventId = 40;
    raw.nextTableEventSequence = 50;
    const room = restore(raw);
    expect(room.tableEventSchemaVersion).toBe(1);
    appendTableEvents(room, [
      { type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: 0 },
      { type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 2 },
    ]);
    expect(room.tableEventSchemaVersion).toBe(2);
    expect(room.tableEvents[0]).toEqual(event(20, 30));
    expect(room.tableEvents.slice(1).map(({ id, sequence }) => [id, sequence])).toEqual([
      [40, 50],
      [41, 51],
    ]);
    expect(restore(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });

  it.each([
    { type: 'special-rule-confirmed', rule: 'guessed', seat: 0 },
    { type: 'special-rule-confirmed', rule: 'flower-kong', seat: 4 },
    { type: 'special-rule-confirmed', rule: 'flower-kong', seat: 0, actionToken: 'secret' },
    { type: 'mouth-locked', seat: 0, fromSeat: 0, mouths: 2 },
    { type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 1 },
    { type: 'mouth-locked', seat: 1, fromSeat: -1, mouths: 3 },
    { type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3, private: {} },
  ])('rejects damaged special event %j without altering the archive', (fields) => {
    const raw = rawRoom();
    raw.tableEvents = [{ id: 1, sequence: 1, hand: 1, ...fields }];
    raw.nextTableEventId = 2;
    raw.nextTableEventSequence = 2;
    const before = structuredClone(raw);
    expect(() => restore(raw)).toThrow(TableEventArchiveError);
    expect(raw).toEqual(before);
  });

  it.each(['special-rule-confirmed', 'mouth-locked'] as const)(
    'rejects %s in version 1',
    (type) => {
      const room = newRoom('session-0', '东家');
      appendTableEvents(room, [
        type === 'mouth-locked'
          ? { type, hand: 1, seat: 1, fromSeat: 0, mouths: 3 }
          : { type, hand: 1, seat: 0, rule: 'follow-discard' },
      ]);
      room.tableEventSchemaVersion = 1;
      expect(() => restoreRoomRules(room)).toThrow('版本 1');
    },
  );

  it('projects new facts through the whitelist and retains counters after clipping', () => {
    const room = newRoom('session-0', '东家');
    room.members = [0, 1, 2, 3].map((seat) => ({
      session: `session-${seat}`,
      name: `玩家${seat}`,
      ready: true,
      joined: seat,
    }));
    room.nextTableEventSequence = 1000;
    for (let index = 0; index < 105; index++)
      appendTableEvents(room, [
        { type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: index % 4 },
      ]);
    appendTableEvents(room, [{ type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 3 }]);
    expect(room.tableEvents).toHaveLength(100);
    const archived = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    expect([archived.nextTableEventId, archived.nextTableEventSequence]).toEqual([107, 1106]);
    for (const event of room.tableEvents)
      Object.assign(event, { private: { hand: ['hidden'] }, actionToken: 'secret-token' });
    const online = new Set(room.members.map((member) => member!.session));
    for (const member of room.members)
      expect(view(room, member!.session, online, 'secret').tableEvents).toEqual(
        archived.tableEvents,
      );
  });

  it('initializes a new room and round-trips artificial events with independent counters', () => {
    const room = newRoom('session-0', '东家');
    expect(room.tableEventSchemaVersion).toBe(2);
    expect(room.tableEvents).toEqual([]);
    expect([room.nextTableEventId, room.nextTableEventSequence]).toEqual([1, 1]);

    room.nextTableEventId = 10;
    room.nextTableEventSequence = 30;
    appendTableEvents(room, [
      { type: 'tile-drawn', hand: 1, seat: 0 },
      { type: 'tile-discarded', hand: 1, seat: 0, tile },
    ]);
    expect(room.tableEvents.map(({ id, sequence }) => [id, sequence])).toEqual([
      [10, 30],
      [11, 31],
    ]);
    expect([room.nextTableEventId, room.nextTableEventSequence]).toEqual([12, 32]);
    expect(restore(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });

  it('keeps only the latest 100 events without resetting either counter', () => {
    const room = newRoom('session-0', '东家');
    for (let index = 0; index < 101; index++)
      appendTableEvents(room, [{ type: 'tile-drawn', hand: 1, seat: index % 4 }]);
    expect(room.tableEvents).toHaveLength(100);
    expect(room.tableEvents[0]).toMatchObject({ id: 2, sequence: 2 });
    expect(room.tableEvents.at(-1)).toMatchObject({ id: 101, sequence: 101 });
    expect([room.nextTableEventId, room.nextTableEventSequence]).toEqual([102, 102]);
  });

  it('rejects counter exhaustion without partially appending an event', () => {
    const room = newRoom('session-0', '东家');
    room.nextTableEventId = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(room);
    expect(() => appendTableEvents(room, [{ type: 'tile-drawn', hand: 1, seat: 0 }])).toThrow(
      '安全上限',
    );
    expect(room).toEqual(before);
  });

  it('keeps history and counters when moving to the next hand', () => {
    const room = newRoom('session-0', '东家');
    start(room);
    appendTableEvents(room, [{ type: 'tile-drawn', hand: 1, seat: 0 }]);
    const before = {
      events: structuredClone(room.tableEvents),
      id: room.nextTableEventId,
      sequence: room.nextTableEventSequence,
    };
    room.match = {
      ...room.match!,
      currentHand: {
        ...room.match!.currentHand,
        phase: 'ended',
        turnStage: 'hand-ended',
        result: { type: 'draw', reason: 'wall-exhausted' },
      },
    };
    advance(room);
    nextHand(room);
    expect(room.match!.currentHandIndex).toBe(1);
    expect(room.tableEvents.slice(0, before.events.length)).toEqual(before.events);
    expect(
      room.tableEvents
        .slice(before.events.length)
        .some((event) => event.type === 'hand-started' && event.hand === 2),
    ).toBe(true);
    expect(room.nextTableEventId).toBeGreaterThan(before.id);
    expect(room.nextTableEventSequence).toBeGreaterThan(before.sequence);
  });

  it('trims valid oversized history on restore and preserves larger counters', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raw = rawRoom();
    raw.tableEvents = Array.from({ length: 101 }, (_, index) => event(index + 1));
    raw.nextTableEventId = 500;
    raw.nextTableEventSequence = 700;
    const room = restore(raw);
    expect(room.tableEvents).toHaveLength(100);
    expect(room.tableEvents[0]!.id).toBe(2);
    expect([room.nextTableEventId, room.nextTableEventSequence]).toEqual([500, 700]);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('safely initializes a genuine legacy archive without changing existing game state', () => {
    const raw = rawRoom();
    const scores = [{ hand: 1, reason: '既有结算', transfers: [{ from: 0, to: 1, amount: 10 }] }];
    raw.scores = scores;
    delete raw.tableEventSchemaVersion;
    delete raw.tableEvents;
    delete raw.nextTableEventId;
    delete raw.nextTableEventSequence;
    const room = restore(raw);
    expect(room.scores).toEqual(scores);
    expect(room.tableEventSchemaVersion).toBe(1);
    expect(room.tableEvents).toEqual([]);
    expect([room.nextTableEventId, room.nextTableEventSequence]).toEqual([1, 1]);
    expect(view(room, 'session-0', new Set(['session-0']), 'secret').tableEvents).toEqual([]);
  });

  it.each([
    [
      'version missing with event data',
      (raw: Record<string, unknown>) => {
        delete raw.tableEventSchemaVersion;
      },
      'missing',
    ],
    [
      'unsupported version',
      (raw: Record<string, unknown>) => {
        raw.tableEventSchemaVersion = 3;
      },
      'unsupported',
    ],
    [
      'one counter missing',
      (raw: Record<string, unknown>) => {
        delete raw.nextTableEventId;
      },
      'missing',
    ],
    [
      'trimmed history counter missing',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = Array.from({ length: 100 }, (_, index) => event(index + 2));
        raw.nextTableEventId = 102;
        raw.nextTableEventSequence = 102;
        delete raw.nextTableEventSequence;
      },
      'missing',
    ],
    [
      'empty rematch history counter missing',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [];
        raw.nextTableEventId = 20;
        raw.nextTableEventSequence = 20;
        delete raw.nextTableEventId;
      },
      'missing',
    ],
    [
      'history missing with valid counters',
      (raw: Record<string, unknown>) => {
        delete raw.tableEvents;
      },
      'missing',
    ],
    [
      'null history',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = null;
      },
      'corrupt',
    ],
    [
      'invalid counter',
      (raw: Record<string, unknown>) => {
        raw.nextTableEventId = 0;
      },
      'corrupt',
    ],
    [
      'duplicate id',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [event(1), event(1, 2)];
        raw.nextTableEventId = 3;
        raw.nextTableEventSequence = 3;
      },
      'corrupt',
    ],
    [
      'reverse sequence',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [event(1, 2), event(2, 1)];
        raw.nextTableEventId = 3;
        raw.nextTableEventSequence = 3;
      },
      'corrupt',
    ],
    [
      'unknown type',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [{ ...event(1), type: 'internal-draw', tile: { id: 'secret' } }];
        raw.nextTableEventId = 2;
        raw.nextTableEventSequence = 2;
      },
      'corrupt',
    ],
    [
      'wrong event field type',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [{ ...event(1), seat: 'east' }];
        raw.nextTableEventId = 2;
        raw.nextTableEventSequence = 2;
      },
      'corrupt',
    ],
    [
      'counter conflict',
      (raw: Record<string, unknown>) => {
        raw.tableEvents = [event(1)];
        raw.nextTableEventId = 1;
        raw.nextTableEventSequence = 2;
      },
      'corrupt',
    ],
  ] as const)('rejects %s without mutating the supplied archive', (_name, damage, kind) => {
    const raw = rawRoom();
    raw.tableEvents = [event(1)];
    raw.nextTableEventId = 2;
    raw.nextTableEventSequence = 2;
    damage(raw);
    const before = structuredClone(raw);
    try {
      restore(raw);
      throw new Error('expected restore to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TableEventArchiveError);
      expect((error as TableEventArchiveError).kind).toBe(kind);
    }
    expect(raw).toEqual(before);
  });

  it('projects the same public event list to every seat without object sharing', () => {
    const room = newRoom('session-0', '东家');
    room.members = Array.from({ length: 4 }, (_, seat) => ({
      session: `session-${seat}`,
      name: `玩家${seat}`,
      ready: false,
      joined: seat,
    }));
    appendTableEvents(room, [
      { type: 'tile-drawn', hand: 1, seat: 0 },
      { type: 'tile-discarded', hand: 1, seat: 0, tile },
    ]);
    const internal = room.tableEvents[0] as TableEvent & Record<string, unknown>;
    internal.privateTile = { id: 'hidden-tile' };
    internal.actionToken = 'hidden-token';
    const online = new Set(room.members.map((member) => member!.session));
    const views = room.members.map((member) => view(room, member!.session, online, 'secret'));
    expect(views.map(({ tableEvents }) => tableEvents)).toEqual(
      Array.from({ length: 4 }, () => views[0]!.tableEvents),
    );
    expect(JSON.stringify(views)).not.toContain('hidden-tile');
    expect(JSON.stringify(views)).not.toContain('hidden-token');
    expect(views[0]!.tableEvents).not.toBe(room.tableEvents);
    expect(views[0]!.tableEvents[0]).not.toBe(room.tableEvents[0]);
  });
});
