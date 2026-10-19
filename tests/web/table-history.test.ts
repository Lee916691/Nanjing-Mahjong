import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TableEvent } from '@nanjing-mahjong/shared-types';
import { view } from '../../apps/server/src/table';
import { eventRoom } from '../../apps/server/test/event-fixture';
import { TableHistory } from '../../apps/web/src/TableHistory';
import { updateTableHistory } from '../../apps/web/src/table-history';
import {
  collectTableNotices,
  createNotificationCursor,
} from '../../apps/web/src/table-notifications';

const state = () => view(eventRoom(), 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'secret');
const base = { id: 1, sequence: 10, hand: 2 };
const tile = { family: 'wan', label: '1万' };
const discard = (id: number, sequence = id): TableEvent => ({
  ...base,
  id,
  sequence,
  type: 'tile-discarded',
  seat: 0,
  tile,
});

describe('history public wording', () => {
  it.each([
    [{ type: 'hand-started', dealer: 0 }, '第 2 手开始，玩家0（东位）坐庄'],
    [{ type: 'tile-discarded', seat: 1, tile }, '玩家1（南位）打出 1万'],
    [{ type: 'peng', seat: 1, fromSeat: 0, tile }, '玩家1（南位）碰牌成立：1万'],
    [{ type: 'ming-gang', seat: 1, fromSeat: 0, tile }, '玩家1（南位）明杠成立：1万'],
    [{ type: 'bu-gang', seat: 1, fromSeat: 0, tile }, '玩家1（南位）补杠成立：1万'],
    [{ type: 'an-gang', seat: 1, tile }, '玩家1（南位）暗杠成立：1万'],
    [{ type: 'hu', winnerSeats: [1], fromSeat: null, summary: '自摸胡' }, '玩家1（南位）自摸胡牌'],
    [
      { type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' },
      '玩家1（南位）点炮胡牌（来源：玩家0（东位））',
    ],
    [
      { type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '抢补杠胡' },
      '玩家1（南位）抢补杠胡牌（来源：玩家0（东位））',
    ],
    [{ type: 'draw', summary: '牌墙耗尽，流局' }, '流局：牌墙耗尽，流局'],
    [
      { type: 'hand-settled', winnerSeats: [], result: 'draw', changes: [], summary: '流局' },
      '第 2 手结算完成',
    ],
    [
      { type: 'hand-settled', winnerSeats: [1], result: 'hu', changes: [], summary: '自摸胡' },
      '第 2 手结算完成',
    ],
    [
      { type: 'hand-settled', winnerSeats: [1, 2], result: 'hu', changes: [], summary: '点炮胡' },
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
  ] as const)('maps %j using the shared public wording', (fields, text) => {
    const room = state();
    room.tableEvents = [{ ...base, ...fields } as TableEvent];
    expect(updateTableHistory(null, room).records).toEqual([
      { id: base.id, sequence: base.sequence, text },
    ]);
  });

  it('keeps each winner and mouth upgrade as separate authoritative facts', () => {
    const room = state();
    room.tableEvents = [
      { ...base, id: 1, sequence: 1, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 2 },
      { ...base, id: 2, sequence: 2, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 },
      { ...base, id: 3, sequence: 3, type: 'hu', winnerSeats: [1], fromSeat: 0, summary: '点炮胡' },
      { ...base, id: 4, sequence: 4, type: 'hu', winnerSeats: [2], fromSeat: 0, summary: '点炮胡' },
    ];
    const records = updateTableHistory(null, room).records;
    expect(records.map((record) => record.id)).toEqual([1, 2, 3, 4]);
    expect(records.map((record) => record.text)).toEqual([
      '玩家1（南位）已锁定玩家0（东位）两嘴',
      '玩家1（南位）已锁定玩家0（东位）三嘴',
      '玩家1（南位）点炮胡牌（来源：玩家0（东位））',
      '玩家2（西位）点炮胡牌（来源：玩家0（东位））',
    ]);
  });

  it('shows the public kong face but ignores entity IDs, private fields, draws and score changes', () => {
    const room = state();
    room.players[0]!.name = '<img src=x onerror=alert(1)>';
    room.tableEvents = [
      { ...base, id: 1, sequence: 1, type: 'future-event', token: 'private-token' },
      { ...base, id: 2, sequence: 2, type: 'tile-drawn', seat: 0, tile: { label: 'draw-secret' } },
      { ...base, id: 3, sequence: 3, type: 'flower-replaced', seat: 0, flower: tile },
      { ...base, id: 4, sequence: 4, type: 'score-changed', changes: [], reason: 'score-secret' },
      {
        ...base,
        id: 5,
        sequence: 5,
        type: 'an-gang',
        seat: 0,
        tile: { family: 'wan', label: '1万', id: 'kong-entity-secret' },
        responses: 'response-secret',
        token: 'private-token',
      },
    ] as unknown as TableEvent[];
    const history = updateTableHistory(null, room);
    expect(history.records).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(TableHistory, { history }));
    for (const secret of [
      'draw-secret',
      'kong-entity-secret',
      'private-token',
      'response-secret',
      'score-secret',
    ])
      expect(html).not.toContain(secret);
    expect(html).not.toContain('<img');
    expect(html).toContain('暗杠成立：1万');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('aria-live');
  });
});

describe('history lifecycle', () => {
  it('sorts by independent sequences, deduplicates IDs and ignores repeated and older snapshots', () => {
    const room = state();
    room.tableEvents = [discard(1, 30), discard(9, 10), discard(2, 20), discard(2, 20)];
    const history = updateTableHistory(null, room);
    expect(history.records.map((record) => record.id)).toEqual([9, 2, 1]);
    expect(updateTableHistory(history, structuredClone(room))).toBe(history);
    room.revision--;
    room.tableEvents = [];
    expect(updateTableHistory(history, room)).toBe(history);
    room.revision += 2;
    room.tableEvents = [discard(3, 40), discard(1, 30)];
    expect(updateTableHistory(history, room).records.map((record) => record.id)).toEqual([1, 3]);
  });

  it('takes twenty displayable records from the current 100-event window and drops server-trimmed history', () => {
    const room = state();
    room.tableEvents = Array.from({ length: 100 }, (_, i) => discard(i + 1));
    let history = updateTableHistory(null, room);
    expect(history.records.map((record) => record.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => 81 + i),
    );
    room.revision++;
    room.tableEvents = [
      discard(101),
      { ...base, id: 102, sequence: 102, type: 'tile-drawn', seat: 1 },
    ];
    history = updateTableHistory(history, room);
    expect(history.records.map((record) => record.id)).toEqual([101]);
    expect(updateTableHistory(null, room)).toEqual(history);
  });

  it('handles cross-hand, rematch with or without waiting, empty archives, leave and room switch', () => {
    const room = state();
    room.tableEvents = [discard(1)];
    const previous = updateTableHistory(null, room);
    room.hand++;
    room.revision++;
    room.tableEvents.push({ ...discard(2), hand: room.hand });
    const nextHand = updateTableHistory(previous, room);
    expect(nextHand.records).toHaveLength(2);
    room.revision++;
    room.status = 'waiting';
    room.tableEvents = [];
    const rematch = updateTableHistory(nextHand, room);
    expect(rematch.records).toEqual([]);
    room.revision++;
    room.status = 'playing';
    room.hand = 1;
    room.tableEvents = [discard(3)];
    expect(updateTableHistory(rematch, room).records.map((record) => record.id)).toEqual([3]);
    expect(updateTableHistory(nextHand, room).records.map((record) => record.id)).toEqual([3]);
    room.id = 'new-room';
    room.revision = 1;
    room.tableEvents = [discard(1)];
    expect(updateTableHistory(previous, room).roomId).toBe('new-room');
    expect(updateTableHistory(null, room).records).toHaveLength(1);
    room.tableEvents = [];
    const empty = updateTableHistory(null, room);
    expect(renderToStaticMarkup(createElement(TableHistory, { history: empty }))).toContain(
      '暂无公开记录',
    );
  });

  it('restores history on refresh and reconnect without touching notification baseline or dedup state', () => {
    const room = state();
    room.tableEvents = [discard(1)];
    let cursor = createNotificationCursor();
    expect(collectTableNotices(cursor, room)).toEqual([]);
    const savedCursor = { ...cursor, seenIds: new Set(cursor.seenIds) };
    const history = updateTableHistory(null, room);
    renderToStaticMarkup(createElement(TableHistory, { history }));
    expect(cursor).toEqual(savedCursor);
    expect(history.records).toHaveLength(1);
    expect(collectTableNotices(cursor, room)).toEqual([]);
    room.revision++;
    room.tableEvents.push(discard(2));
    cursor = createNotificationCursor();
    expect(collectTableNotices(cursor, room)).toEqual([]);
    expect(updateTableHistory(history, room)).toEqual(updateTableHistory(null, room));
    room.revision++;
    room.tableEvents.push(discard(3));
    expect(collectTableNotices(cursor, room).map((notice) => notice.id)).toEqual([3]);
    expect(updateTableHistory(history, room).records.map((record) => record.id)).toEqual([1, 2, 3]);
  });
});
