import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tableStatus } from '../../apps/web/src/table-status';
import { MahjongTable } from '../../apps/web/src/MahjongTable';
import { apply, view } from '../../apps/server/src/table';
import { eventRoom, buGangRoom } from '../../apps/server/test/event-fixture';

const online = new Set(['p0', 'p1', 'p2', 'p3']);
const state = () => view(eventRoom(), 'p0', online, 'secret');

describe('table state wording', () => {
  it('distinguishes self, other player, automatic draw and unknown phases', () => {
    const room = state();
    expect(tableStatus(room, true, false).title).toBe('轮到你出牌');
    room.current = 1;
    expect(tableStatus(room, true, false).title).toBe('等待 玩家1 出牌');
    room.phase = 'waiting-for-draw';
    expect(tableStatus(room, true, false).title).toBe('服务端正在处理摸牌');
    room.phase = 'unknown';
    expect(tableStatus(room, true, false).title).toBe('正在同步牌局状态');
  });

  it('distinguishes public response sources and uses only own available actions', () => {
    const saved = buGangRoom();
    apply(saved, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });
    const actor = view(saved, 'p0', online, 'secret');
    expect(tableStatus(actor, true, false).title).toBe('玩家0已出7万 · 等待弃牌响应');
    expect(tableStatus(actor, true, false).hint).toContain('等待其他玩家响应');
    const responder = view(saved, 'p1', online, 'secret');
    expect(tableStatus(responder, true, false).hint).toBe('请选择响应操作');
    const kong = buGangRoom();
    apply(kong, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
    const rob = view(kong, 'p1', online, 'secret');
    rob.lastDiscard = { id: 'old', label: '9筒', family: 'tong' };
    expect(tableStatus(rob, true, false).title).toBe('玩家0声明补杠 · 等待抢补杠胡响应');
    delete rob.responseWindow;
    expect(tableStatus(rob, true, false).title).toBe('等待牌桌响应');
    expect(tableStatus(rob, true, false).title).not.toContain('9筒');
  });

  it('prioritizes disconnect, pause, submission and unknown confirmation', () => {
    const room = state();
    room.paused = true;
    room.players[2]!.connected = false;
    expect(tableStatus(room, false, true).title).toBe('正在重连并恢复房间状态');
    expect(tableStatus(room, true, true).hint).toContain('等待玩家2重连');
    room.paused = false;
    expect(tableStatus(room, true, true).title).toBe('正在提交操作…');
    expect(tableStatus(room, true, false, true).title).toBe('尚未收到操作确认');
    expect(tableStatus(room, true, false).title).toBe('轮到你出牌');
  });

  it('keeps the private initial decision queue anonymous', () => {
    const room = state();
    room.phase = 'waiting-for-di-hu-decision';
    room.current = null;
    expect(tableStatus(room, true, false).hint).toBe('等待开局确认完成');
    room.actions.choices = [{ kind: 'di-hu', label: '报地胡', token: 'private-token' }];
    expect(tableStatus(room, true, false).hint).toBe('请选择报地胡或不报');
    expect(JSON.stringify(tableStatus(room, true, false))).not.toContain('private-token');
  });

  it('shows review confirmations and suppresses countdowns while paused or disconnected', () => {
    const room = state();
    room.result = '流局';
    room.nextHandToken = 'review';
    room.nextHandReady = [0, 1];
    room.nextHandSeconds = 30;
    expect(tableStatus(room, true, false).hint).toContain(
      '你已确认 · 2/4 已确认，等待玩家2、玩家3',
    );
    expect(tableStatus(room, true, false).hint).toContain('30 秒后自动开始');
    expect(tableStatus(room, false, false).hint).not.toContain('30');
    room.paused = true;
    expect(tableStatus(room, true, false).hint).not.toContain('30');
    room.paused = false;
    room.result = null;
    expect(tableStatus(room, true, false).title).toBe('轮到你出牌');
    expect(tableStatus(room, true, false).hint).not.toContain('已确认');
  });

  it('renders no active turn or enabled action while disconnected or confirmation is unknown', () => {
    const saved = buGangRoom();
    apply(saved, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
    const room = view(saved, 'p1', online, 'secret');
    for (const props of [
      { connected: false, confirmationUnknown: false },
      { connected: true, confirmationUnknown: true },
    ]) {
      const html = renderToStaticMarkup(
        createElement(MahjongTable, {
          room,
          ...props,
          pending: false,
          onAction: () => {},
          readable: (value) => value,
        }),
      );
      expect(html).not.toContain(' active');
      expect(html).toMatch(/disabled=""[^>]*>胡<\/button>/);
      expect(html).not.toContain('your-turn');
    }
  });
});
