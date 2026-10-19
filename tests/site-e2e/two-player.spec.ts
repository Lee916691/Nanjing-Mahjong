import { test, expect } from '@playwright/test';
import { createRoom, execute } from '../../cloud/commands';
import { apply, start, view } from '../../apps/server/src/table';
import { prepareTwoPlayerWin } from '../../apps/server/test/two-player-fixture';
import type { RoomCommand, RoomEvent } from '@nanjing-mahjong/shared-types';

test('two friends create a fixed two-seat room, play, refresh and resume', async ({
  browser,
}, testInfo) => {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1366, height: 768 } }),
    browser.newContext({ viewport: { width: 1366, height: 768 } }),
    browser.newContext({ viewport: { width: 1366, height: 768 } }),
  ]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const [host, opponent, third] = pages;
    await host!.goto('/');
    await host!.getByLabel('玩法模式').selectOption('nanjing-open-duo');
    await host!.getByLabel('你的昵称').fill('双人房主');
    await host!.getByLabel('自定义房间号（可选）').fill(String(Date.now()).slice(-12));
    await host!.locator('form').getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host!.getByRole('heading', { name: '等朋友，开好局' })).toBeVisible();
    await expect(host!.locator('.seat-card')).toHaveCount(2);
    const invite = host!.url();
    await opponent!.goto(invite);
    await opponent!.getByLabel('你的昵称').fill('双人对手');
    await opponent!.locator('form').getByRole('button', { name: '加入房间', exact: true }).click();
    await expect(opponent!.locator('.seat-card')).toHaveCount(2);
    await third!.goto(invite);
    await third!.getByLabel('你的昵称').fill('第三位好友');
    await third!.locator('form').getByRole('button', { name: '加入房间', exact: true }).click();
    await expect(third!.getByRole('status')).toContainText('房间已满');
    for (const page of [host!, opponent!])
      await page.getByRole('button', { name: '准备好了', exact: true }).click();
    await host!.getByRole('button', { name: '双人开局', exact: true }).click();
    for (const page of [host!, opponent!]) {
      await expect(page.getByLabel('麻将桌')).toBeVisible();
      await expect(page.locator('.seat-region')).toHaveCount(2);
      await expect(page.locator('.seat-region--2')).toHaveCount(1);
      await expect(page.locator('.room-bar')).toContainText('/ 8 有效庄次');
    }
    for (let step = 0; step < 8; step++) {
      for (const page of [host!, opponent!]) {
        const passInitial = page.getByRole('button', { name: '不报', exact: true });
        const pass = page.locator('.action-bar').getByRole('button', { name: '过', exact: true });
        if (await passInitial.isVisible()) {
          await passInitial.click();
          break;
        }
        if (await pass.isVisible()) {
          await pass.click();
          break;
        }
        const tile = page.locator('.hand .tile:not([disabled])').first();
        if (await tile.count()) {
          await tile.click();
          await page.getByRole('button', { name: '出牌', exact: true }).click();
          break;
        }
      }
      await host!.waitForTimeout(100);
    }
    await opponent!.reload();
    await expect(opponent!.getByLabel('麻将桌')).toBeVisible();
    await expect(opponent!.locator('.seat-region--2')).toHaveCount(1);
    await host!.screenshot({ path: testInfo.outputPath('two-player-desktop.png'), fullPage: true });
    await opponent!.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => (await opponent!.locator('.hand .tile').first().boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(36);
    expect(await opponent!.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await opponent!.screenshot({
      path: testInfo.outputPath('two-player-narrow.png'),
      fullPage: true,
    });
    await contexts[1]!.setOffline(true);
    await expect(host!.getByRole('alert')).toContainText('牌局已暂停', { timeout: 20000 });
    await contexts[1]!.setOffline(false);
    await expect(host!.getByRole('alert')).toHaveCount(0, { timeout: 20000 });
    await host!.getByRole('button', { name: '提前结束', exact: true }).click();
    await host!.getByRole('button', { name: '确认结束', exact: true }).click();
    await expect(host!.locator('.final-panel')).toBeVisible();
    await host!.getByRole('button', { name: '再来一将', exact: true }).click();
    await expect(host!.locator('.seat-card')).toHaveCount(2);
    await expect(host!.getByRole('button', { name: '双人开局', exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('legal two-player fixtures continue the eighth turn, then finish with two confirmations and the saved bonus', async ({
  browser,
}) => {
  const sessions = ['duo-a', 'duo-b'];
  const online = new Set(sessions);
  const room = createRoom(sessions[0]!, '玩家一', 'nanjing-open-duo');
  room.members[1] = { session: sessions[1]!, name: '玩家二', ready: true, joined: 1 };
  start(room);
  const contexts = await Promise.all(sessions.map(() => browser.newContext()));
  try {
    const pages = await Promise.all(
      contexts.map(async (context, index) => {
        await context.route('**/api/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
          if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
          if (path === '/api/command') {
            const data = route.request().postDataJSON() as {
              event: RoomEvent;
              command: RoomCommand;
            };
            execute(room, data.event, data.command, sessions[index]!, online);
            return route.fulfill({
              json: {
                ack: { commandId: data.command.commandId, ok: true },
                state: view(room, sessions[index]!, online, room.secret),
              },
            });
          }
          return route.fulfill({
            json: { state: view(room, sessions[index]!, online, room.secret) },
          });
        });
        const page = await context.newPage();
        await page.goto('/');
        return page;
      }),
    );
    for (let hand = 1; hand <= 9; hand++) {
      const turn = Math.min(hand, 8);
      expect(room.match!.effectiveDealerTurn).toBe(turn);
      const winner = prepareTwoPlayerWin(room, hand === 8);
      apply(room, { type: 'DRAW_TILE' });
      room.epoch++;
      room.revision++;
      await expect(pages[winner]!.locator('.hand .tile')).toHaveCount(14);
      await pages[winner]!.getByRole('button', { name: '自摸胡', exact: true }).click();
      if (hand === 9) break;
      if (hand === 8) {
        expect(room.match!.effectiveDealerTurn).toBe(8);
        expect(room.match!.completedHands.at(-1)?.reason).toBe('final-turn-continuation');
      }
      for (const page of pages) {
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.locator('.hand-deltas > div')).toHaveCount(2);
        await page.locator('.hand-score-details > summary').click();
        await expect(
          page.getByRole('dialog').getByText('自摸加花 2 花', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: '开始下一把 · 0/2', exact: true }),
        ).toBeVisible();
      }
      await pages[0]!.getByRole('button', { name: /开始下一把/ }).click();
      await expect(
        pages[1]!.getByRole('button', { name: '开始下一把 · 1/2', exact: true }),
      ).toBeVisible();
      await pages[1]!.reload();
      await expect(
        pages[1]!.getByRole('button', { name: '开始下一把 · 1/2', exact: true }),
      ).toBeVisible();
      await pages[1]!.getByRole('button', { name: /开始下一把/ }).click();
      for (const page of pages)
        await expect(page.locator('.room-bar')).toContainText(`第 ${hand + 1} 手`);
    }
    for (const page of pages) await expect(page.locator('.final-panel')).toBeVisible();
    expect(room.status).toBe('completed');
    expect(room.match!.completedHands).toHaveLength(9);
    expect(room.match!.effectiveDealerTurn).toBe(8);
    expect(room.match!.cumulativeScores.reduce((sum, score) => sum + score, 0)).toBe(2000);
    expect(room.remainingMs).toBeNull();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
