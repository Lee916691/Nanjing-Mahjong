import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRoom, view } from '../../apps/server/src/table';
import { MahjongTable } from '../../apps/web/src/MahjongTable';
import { HandResult } from '../../apps/web/src/HandResult';
import { tableStatus } from '../../apps/web/src/table-status';
import { isSupportedRoomMode } from '../../apps/web/src/room-mode';

function state() {
  const room = newRoom('p0', '你', 'nanjing-open-duo');
  room.members[1] = { session: 'p1', name: '朋友', ready: true, joined: 1 };
  return view(room, 'p0', new Set(['p0', 'p1']), 'private');
}

describe('two-player views', () => {
  it('accepts only consistent known mode metadata', () => {
    const room = state();
    expect(isSupportedRoomMode(room)).toBe(true);
    for (const invalid of [
      { ...room, ruleSetId: 'unknown' },
      { ...room, totalEffectiveDealerTurns: 16 },
      { ...room, players: [...room.players, null] },
      { ...room, self: 2 },
    ])
      expect(isSupportedRoomMode(invalid as never)).toBe(false);
  });

  it('places the opponent opposite the player and displays four circles with eight turns', () => {
    const room = state();
    room.status = 'playing';
    room.effectiveTurn = 8;
    const html = renderToStaticMarkup(
      createElement(MahjongTable, {
        room,
        connected: true,
        pending: false,
        onAction: () => {},
        readable: (value) => value,
      }),
    );
    expect(html).toContain('seat-region--0');
    expect(html).toContain('seat-region--2');
    expect(html).not.toContain('seat-region--1');
    expect(html).not.toContain('seat-region--3');
    expect(html).toContain('第 4 圈 · 第 2 庄');
    expect(html).toContain('第8庄 · 末庄');
    expect(html).not.toContain('第16庄');
  });

  it('renders exactly two settlement cards, one package payment and a two-person confirmation', () => {
    const room = state();
    room.result = '本局结算';
    room.nextHandReady = [0];
    room.nextHandToken = 'private-review';
    room.nextHandSeconds = 30;
    room.scores = [
      {
        hand: 1,
        reason: '三嘴包子',
        responsibility: { trigger: 0, payer: 0 },
        transfers: [{ from: 0, to: 1, amount: 196 }],
        calculation: {
          terms: [{ label: '自摸加花 2 花', points: 4 }],
          factors: [{ label: '比下胡', value: 2 }],
          formula: '已保存的公式',
          perPayment: 196,
          payments: 1,
          total: 196,
          winner: 1,
        },
      },
    ];
    const hint = tableStatus(room, true, false).hint;
    expect(hint).toContain('1/2 已确认');
    const html = renderToStaticMarkup(
      createElement(HandResult, {
        room,
        connected: true,
        pending: false,
        confirmationUnknown: false,
        hint,
        readable: (value) => value,
        onClose: () => {},
      }),
    );
    expect(html.match(/data-seat=/g) ?? []).toHaveLength(2);
    expect(html).toContain('承包一份付款');
    expect(html).toContain('自摸加花 2 花');
    expect(html).not.toContain('承包三份');
    expect(html).not.toContain('/4');
  });
});
