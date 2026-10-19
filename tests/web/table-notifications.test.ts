import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TableEvent } from '@nanjing-mahjong/shared-types';
import {
  collectTableNotices,
  createNotificationCursor,
  notificationForEvent,
} from '../../apps/web/src/table-notifications';
import { TableNotification } from '../../apps/web/src/TableNotification';
import { view } from '../../apps/server/src/table';
import { eventRoom } from '../../apps/server/test/event-fixture';

const state = () => view(eventRoom(), 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'secret');
const base = { id: 1, sequence: 1, hand: 2 };
const tile = { family: 'wan', label: '1万' };
const event = (id: number, sequence = id): TableEvent => ({
  ...base,
  id,
  sequence,
  type: 'tile-discarded',
  seat: 0,
  tile,
});

describe('public event notification wording', () => {
  it.each([
    [{ type: 'hand-started', dealer: 0 }, '第 2 手开始，玩家0（东位）坐庄'],
    [{ type: 'tile-discarded', seat: 0, tile }, '玩家0（东位）打出 1万'],
    [{ type: 'peng', seat: 1, fromSeat: 0, tile }, '玩家1（南位）碰牌成立：1万'],
    [{ type: 'ming-gang', seat: 1, fromSeat: 0, tile }, '玩家1（南位）明杠成立：1万'],
    [{ type: 'an-gang', seat: 1, tile }, '玩家1（南位）暗杠成立'],
    [{ type: 'bu-gang', seat: 1, fromSeat: 0, tile }, '玩家1（南位）补杠成立：1万'],
    [{ type: 'hu', winnerSeats: [1], fromSeat: null, summary: '自摸胡' }, '玩家1（南位）自摸胡牌'],
    [
      { type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' },
      '玩家1（南位）点炮胡牌（来源：玩家0（东位））',
    ],
    [
      { type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '抢补杠胡' },
      '玩家1（南位）抢补杠胡牌（来源：玩家0（东位））',
    ],
    [
      { type: 'hu', winnerSeats: [1, 2], fromSeat: 0, summary: '点炮胡' },
      '多家胡牌：玩家1（南位）、玩家2（西位）（点炮胡牌；来源：玩家0（东位））',
    ],
    [{ type: 'draw', summary: '牌墙耗尽，流局' }, '流局：牌墙耗尽，流局'],
    [
      { type: 'hand-settled', result: 'draw', winnerSeats: [], changes: [], summary: '流局' },
      '第 2 手结算完成',
    ],
    [
      { type: 'hand-settled', result: 'hu', winnerSeats: [1, 2], changes: [], summary: '点炮胡' },
      '多家胡牌：玩家1（南位）、玩家2（西位）；本手结算完成',
    ],
    [{ type: 'special-rule-confirmed', rule: 'flower-kong', seat: 1 }, '玩家1（南位）花杠成立'],
    [
      { type: 'special-rule-confirmed', rule: 'four-winds-gathered', seat: 1 },
      '玩家1（南位）四风归齐成立',
    ],
    [
      { type: 'special-rule-confirmed', rule: 'follow-discard', seat: 1 },
      '玩家1（南位）跟打一圈成立',
    ],
    [
      { type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 2 },
      '玩家1（南位）已锁定玩家0（东位）两嘴',
    ],
    [
      { type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 },
      '玩家1（南位）已锁定玩家0（东位）三嘴',
    ],
  ] as const)('maps %j from public fields', (fields, text) => {
    const room = state();
    const notice = notificationForEvent({ ...base, ...fields } as TableEvent, room.players);
    expect(notice?.text).toBe(text);
    expect(notice?.id).toBe(1);
  });

  it('suppresses draws, ordinary flowers and scoring even with a special scoring reason', () => {
    const players = state().players;
    for (const fields of [
      { type: 'tile-drawn', seat: 0 },
      { type: 'flower-replaced', seat: 0, flower: { family: 'flower', label: '梅' } },
      { type: 'score-changed', reason: 'flower-kong-created', changes: [{ seat: 0, delta: 60 }] },
    ])
      expect(notificationForEvent({ ...base, ...fields } as TableEvent, players)).toBeNull();
  });

  it('uses safe seat fallbacks, escapes names and never prints concealed kong faces', () => {
    const room = state();
    room.players[1] = null;
    expect(
      notificationForEvent(
        { ...base, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 2 },
        room.players,
      )?.text,
    ).toBe('南位玩家已锁定玩家0（东位）两嘴');
    room.players[0]!.seat = 3;
    expect(notificationForEvent(event(1), room.players)?.text).toBe('东位玩家打出 1万');
    expect(notificationForEvent({ ...event(1), seat: 9 }, room.players)?.text).toBe('玩家打出 1万');
    room.players[0]!.seat = 0;
    room.players[0]!.name = '<img src=x onerror=alert(1)>';
    const notice = notificationForEvent(
      { ...base, type: 'an-gang', seat: 0, tile: { family: 'wan', label: 'hidden-face' } },
      room.players,
    )!;
    expect(notice.text).not.toContain('hidden-face');
    const html = renderToStaticMarkup(createElement(TableNotification, { notice }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('aria-live="polite"');
  });

  it('uses identical public facts for every viewpoint and longer reading time for important facts', () => {
    const room = eventRoom();
    const lock: TableEvent = { ...base, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 };
    const messages = [0, 1, 2, 3].map((seat) =>
      notificationForEvent(
        lock,
        view(room, `p${seat}`, new Set(['p0', 'p1', 'p2', 'p3']), 'secret').players,
      ),
    );
    expect(messages.every((notice) => notice?.text === messages[0]?.text)).toBe(true);
    expect(messages[0]!.duration).toBe(4800);
    expect(notificationForEvent(event(1), state().players)!.duration).toBe(1600);
  });
});

describe('notification cursor and recovery', () => {
  it('baselines history, sorts independent sequences and suppresses IDs and stale snapshots', () => {
    const cursor = createNotificationCursor();
    const room = state();
    room.tableEvents = [event(10, 100)];
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents = [event(12, 102), event(10, 100), event(11, 101)];
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([11, 12]);
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents = [event(10, 100)];
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents = [event(12, 102), event(13, 103)];
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([13]);
  });

  it('reconnect or reload establishes a fresh baseline and room switching does not mix histories', () => {
    let cursor = createNotificationCursor();
    const room = state();
    collectTableNotices(cursor, room);
    room.tableEvents = [event(1)];
    expect(collectTableNotices(cursor, room)).toHaveLength(1);
    cursor = createNotificationCursor();
    room.tableEvents = [event(1), event(2)];
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents.push(event(3));
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([3]);
    room.id = 'another-room';
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents.push(event(4));
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([4]);
  });

  it('keeps upgrades, terminal facts and multiple winners, but not later scoring duplicates', () => {
    const cursor = createNotificationCursor();
    const room = state();
    collectTableNotices(cursor, room);
    room.tableEvents = [
      { ...base, id: 1, sequence: 1, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 2 },
      { ...base, id: 2, sequence: 2, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 },
      { ...base, id: 3, sequence: 3, type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' },
      { ...base, id: 4, sequence: 4, type: 'hu', winnerSeats: [2], fromSeat: 0, summary: '点炮胡' },
      {
        ...base,
        id: 5,
        sequence: 5,
        type: 'score-changed',
        changes: [{ seat: 0, delta: -100 }],
        reason: 'three-mouth',
      },
      {
        ...base,
        id: 6,
        sequence: 6,
        type: 'hand-settled',
        result: 'hu',
        winnerSeats: [1, 2],
        changes: [],
        summary: '点炮胡',
      },
    ];
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([1, 2, 3, 4, 6]);
    room.tableEvents = [];
    room.status = 'waiting';
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.tableEvents = [event(7, 7)];
    expect(collectTableNotices(cursor, room)).toHaveLength(1);
  });
});
