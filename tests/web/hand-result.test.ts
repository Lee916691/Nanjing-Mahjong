import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RoomView } from '@nanjing-mahjong/shared-types';
import { view } from '../../apps/server/src/table';
import { HandResult } from '../../apps/web/src/HandResult';
import { ScoreDetails } from '../../apps/web/src/ScoreDetails';
import { tableStatus } from '../../apps/web/src/table-status';
import { settlementRoom } from './hand-result-fixture';

const state = (mode: Parameters<typeof settlementRoom>[0] = 'discard') =>
  view(settlementRoom(mode), 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'private-token');
const readable = (value: string) => `已存原因：${value}`;
function render(room: RoomView, extra = {}) {
  return renderToStaticMarkup(
    createElement(HandResult, {
      room,
      connected: true,
      pending: false,
      confirmationUnknown: false,
      hint: tableStatus(room, true, false).hint,
      readable,
      onClose: () => {},
      ...extra,
    }),
  );
}
const summary = (html: string) => html.split('<details')[0]!;

describe('hand result summary and snapshots', () => {
  it.each([
    ['self-draw', '自摸胡', [0]],
    ['discard', '点炮胡', [1, 2, 3]],
    ['rob-bu-gang', '抢补杠胡', [1, 2, 3]],
    ['draw', '流局', []],
    ['three-mouth', '点炮胡', [1]],
    ['three-pure', '三清胡牌', [1]],
  ] as const)('shows authoritative %s outcome and every winner', (mode, title, winners) => {
    const room = state(mode);
    const html = render(room);
    expect(html).toContain(`<h2 id="hand-result-title">${title}</h2>`);
    expect((summary(html).match(/胡牌玩家：/g) ?? []).length).toBe(winners.length);
    for (const seat of winners)
      expect(summary(html)).toContain(`胡牌玩家：<strong>玩家${seat}</strong>`);
    const settled = room.tableEvents.find((event) => event.type === 'hand-settled')!;
    for (const { seat, delta } of settled.changes) {
      const card = html.match(new RegExp(`<div data-seat="${seat}">(.*?)</div>`))![1]!;
      expect(card).toContain('本手变化');
      expect(card).toContain(
        `${delta > 0 ? '+' : ''}${delta} 分（${delta > 0 ? '增加' : delta < 0 ? '减少' : '无变化'}）`,
      );
      expect(card).toContain(`累计分：${room.players[seat]!.score} 分`);
    }
  });

  it('uses the settled delta directly instead of recalculating from amounts or a cropped ledger', () => {
    const room = state();
    const before = render(room).match(/<div class="hand-deltas">(.*?)<details/s)![1];
    room.scores = [];
    expect(render(room).match(/<div class="hand-deltas">(.*?)<details/s)![1]).toBe(before);
  });

  it('keeps winner, trigger and payer distinct for three-mouth settlement', () => {
    const html = render(state('three-mouth'));
    expect(summary(html)).toContain('胡牌玩家：<strong>玩家1</strong>');
    expect(summary(html)).not.toContain('胡牌玩家：<strong>玩家0</strong>');
    expect(summary(html)).not.toContain('胡牌玩家：<strong>玩家2</strong>');
    expect(html).toContain('玩家2触发本次结算， 由玩家0承包三份付款。');
  });

  it('keeps all ScoreDetails information unchanged inside a collapsed native details element', () => {
    const room = state('three-mouth');
    const before = structuredClone(room);
    const html = render(room);
    expect(html).toContain('<details class="hand-score-details">');
    expect(html).not.toContain('<details class="hand-score-details" open');
    for (const score of room.scores) {
      const original = renderToStaticMarkup(
        createElement(ScoreDetails, { score, players: room.players, readable }),
      );
      expect(html).toContain(original);
    }
    expect(html).toContain('aria-label="胡牌牌面"');
    expect(html).toContain('胡张');
    expect(html).toContain('副露');
    expect(html).toContain('score-terms');
    expect(html).toContain('score-equation');
    expect(html).toContain('score-factors');
    expect(html).toContain('score-payments');
    expect(room).toEqual(before);
    expect(html).not.toContain(room.nextHandToken!);
  });

  it('supports legacy payments without inventing formulas, winners, deltas or optional fields', () => {
    const room = state('three-mouth');
    room.tableEvents = [];
    room.scores.forEach((score) => {
      delete score.calculation;
      delete score.winningHand;
    });
    const html = render(room);
    expect(summary(html)).toContain('当前快照未提供胡牌玩家或方式');
    expect(summary(html).match(/未提供<\/strong>/g)).toHaveLength(4);
    expect(html).toContain('本条记录仅保存了付款金额');
    expect(html).not.toContain('score-equation');
    for (const payment of room.scores[0]!.transfers)
      expect(html).toContain(`${payment.amount}<small> 分</small>`);
  });

  it('preserves an existing public flower rack and every stored calculation field', () => {
    const room = state('self-draw');
    const score = room.scores[0]!;
    score.winningHand!.flowers.push({ family: 'flower', label: '梅' });
    const html = render(room);
    expect(html).toContain('花牌');
    expect(html).toContain('aria-label="梅"');
    const original = renderToStaticMarkup(
      createElement(ScoreDetails, { score, players: room.players, readable }),
    );
    expect(html).toContain(original);
    expect(html).toContain(score.calculation!.formula);
    for (const factor of score.calculation!.factors)
      expect(html).toContain(`${factor.label} ×${factor.value}`);
  });

  it('falls back only to explicit legacy calculation winners and saved reasons', () => {
    const room = state();
    room.tableEvents = [];
    const html = summary(render(room));
    for (const seat of [1, 2, 3]) expect(html).toContain(`胡牌玩家：<strong>玩家${seat}</strong>`);
    expect(html).toContain('已存原因：discard');
    expect(html).not.toContain('胡牌玩家：<strong>玩家0</strong>');
    expect(html).not.toContain('0 分（无变化）');
  });

  it('does not turn missing seat changes, missing players or missing details into exact defaults', () => {
    const room = state('draw');
    const event = room.tableEvents.find((entry) => entry.type === 'hand-settled')!;
    event.changes = [{ seat: 0, delta: 0 }];
    room.players[1] = null;
    const html = render(room);
    expect(html).toContain('0 分（无变化）');
    expect(html).toContain('累计分：未提供');
    expect(html).toContain('当前快照未提供计分明细');
    expect(html.match(/未提供<\/strong>/g)).toHaveLength(3);
  });

  it('ignores earlier hand facts and preserves an otherwise unsupported result verbatim', () => {
    const room = state();
    room.hand++;
    room.result = '已有其他结算结果';
    const html = render(room);
    expect(html).toContain('已有其他结算结果');
    expect(summary(html)).not.toContain('胡牌玩家：');
    expect(html).toContain('当前快照未提供计分明细');
  });

  it('uses hu facts when the optional final event is absent and escapes names and formulas', () => {
    const room = state();
    room.tableEvents = room.tableEvents.filter((event) => event.type !== 'hand-settled');
    room.players[1]!.name = '<script>bad()</script>';
    room.scores[0]!.calculation!.formula = '<img src=x onerror=bad()>';
    const html = render(room);
    expect(html).toContain('点炮胡');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });
});

describe('hand result continuation controls', () => {
  it.each(['offline', 'pending', 'unknown', 'paused', 'ready', 'no-token'])(
    'keeps %s confirmation disabled',
    (mode) => {
      const room = state('draw');
      if (mode === 'paused') room.paused = true;
      if (mode === 'ready') room.nextHandReady = [room.self];
      if (mode === 'no-token') delete room.nextHandToken;
      const html = render(room, {
        connected: mode !== 'offline',
        pending: mode === 'pending',
        confirmationUnknown: mode === 'unknown',
      });
      expect(html).toMatch(/class="primary" disabled=""/);
    },
  );
});
