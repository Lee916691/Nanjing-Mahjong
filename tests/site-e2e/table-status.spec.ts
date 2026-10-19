import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RoomCommand, RoomEvent, CommandAck } from '@nanjing-mahjong/shared-types';
import { buGangRoom } from '../../apps/server/test/event-fixture';
import { view, advance } from '../../apps/server/src/table';
import { execute, PublicError } from '../../cloud/commands';

async function mount(page: Page) {
  const room = {
    ...buGangRoom(),
    cloudFormat: 1 as const,
    secret: 'browser-fixture',
    clockAt: null,
  };
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  const control = { network: true, hold: null as Promise<void> | null, reject: false, drop: false };
  const ids: string[] = [];
  const receipts = new Map<string, CommandAck>();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
    if (!control.network) return route.abort();
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    if (path === '/api/command') {
      const { event, command } = route.request().postDataJSON() as {
        event: RoomEvent;
        command: RoomCommand;
      };
      ids.push(command.commandId);
      await control.hold;
      let ack = receipts.get(command.commandId);
      if (!ack) {
        if (control.reject) room.epoch++;
        try {
          execute(room, event, command, 'p0', online);
          ack = { commandId: command.commandId, ok: true };
          receipts.set(command.commandId, ack);
        } catch (error) {
          if (!(error instanceof PublicError)) throw error;
          ack = {
            commandId: command.commandId,
            ok: false,
            error: { code: error.code, message: error.message },
          };
        }
      }
      if (control.drop) {
        control.drop = false;
        return route.abort();
      }
      return route.fulfill({ json: { ack, state: view(room, 'p0', online, room.secret) } });
    }
    return route.fulfill({ json: { state: view(room, 'p0', online, room.secret) } });
  });
  await page.goto('/');
  await expect(page.locator('.turn-banner')).toHaveText('轮到你出牌');
  return { room, online, control, ids };
}

test('submission waits for confirmation, then follows the authoritative rob-kong window', async ({
  page,
}) => {
  const { control } = await mount(page);
  let release!: () => void;
  control.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.turn-banner')).toHaveText('正在提交操作…');
  await expect(page.locator('.action-hint')).toContainText('等待服务端确认');
  await expect(page.getByRole('button', { name: '补杠 7万', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.turn-banner')).toContainText('玩家0声明补杠 · 等待抢补杠胡响应');
  await expect(page.locator('.action-hint')).toContainText('等待其他玩家响应');
  await expect(page.locator('.notice')).toHaveCount(0);
});

test('server rejection restores the stage while a lost acknowledgement uses the same command', async ({
  page,
}) => {
  const { control, ids } = await mount(page);
  control.reject = true;
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('操作已失效');
  await expect(page.locator('.turn-banner')).toHaveText('轮到你出牌');
  control.reject = false;
  control.drop = true;
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('尚未收到确认');
  await expect(page.locator('.turn-banner')).toHaveText('尚未收到操作确认');
  await expect(page.locator('.action-bar button:enabled')).toHaveCount(0);
  await page.getByRole('button', { name: '重试操作' }).click();
  await expect(page.locator('.turn-banner')).toContainText('等待抢补杠胡响应');
  await expect(page.locator('.notice')).toHaveCount(0);
  expect(ids[1]).toBe(ids[2]);
});

test('pause, reconnect, restored turn and review replace old hints without actionable stale state', async ({
  page,
}, testInfo) => {
  const { room, online, control } = await mount(page);
  online.delete('p2');
  await expect(page.locator('.turn-banner')).toHaveText('牌局已暂停 · 等待重连');
  await expect(page.locator('.action-hint')).toContainText('等待玩家2重连');
  await expect(page.locator('.action-bar button:enabled')).toHaveCount(0);
  control.network = false;
  await expect(page.locator('.turn-banner')).toHaveText('正在重连并恢复房间状态');
  await expect(page.locator('.player-badge.active')).toHaveCount(0);
  online.add('p2');
  control.network = true;
  await expect(page.locator('.turn-banner')).toHaveText('轮到你出牌');
  await expect(page.locator('.action-hint')).not.toContainText('重连');
  room.match!.currentHand = {
    ...room.match!.currentHand,
    phase: 'ended',
    turnStage: 'hand-ended',
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
  advance(room);
  room.members.forEach((member, seat) => {
    if (member) member.name = `${seat}甲乙丙丁戊己庚辛壬癸子丑寅卯辰`;
  });
  await expect(page.locator('.turn-banner')).toContainText('等待下一手确认');
  await page.getByRole('button', { name: /开始下一把/ }).click();
  await expect(page.locator('.result-bottom')).toContainText('你已确认 · 1/4');
  await expect(page.getByRole('button', { name: /已准备/ })).toBeDisabled();
  const screenshot = testInfo.outputPath('table-status-review.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('review with long names', { path: screenshot, contentType: 'image/png' });
});
