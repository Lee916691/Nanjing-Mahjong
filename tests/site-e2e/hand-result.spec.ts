import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RoomCommand, RoomEvent } from '@nanjing-mahjong/shared-types';
import { view } from '../../apps/server/src/table';
import { execute, tick } from '../../cloud/commands';
import { settlementRoom } from '../web/hand-result-fixture';

async function mount(
  page: Page,
  mode: Parameters<typeof settlementRoom>[0] = 'three-mouth',
  long = false,
) {
  const room = {
    ...settlementRoom(mode),
    cloudFormat: 1 as const,
    secret: 'hand-result-fixture',
    clockAt: null as number | null,
    lastActivity: Date.now(),
  };
  if (long) {
    room.members.forEach((member, seat) => {
      member!.name = `${seat}甲乙丙丁戊己庚辛壬癸子丑寅卯辰`;
    });
    // Layout-only extension of an existing public formula snapshot; never recalculated by the UI.
    room.scores.forEach((score) => {
      if (score.calculation) score.calculation.formula += '（已保存的长公式说明）'.repeat(30);
    });
  }
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  const commands: RoomEvent[] = [];
  const control = { network: true, ticking: true };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
    if (!control.network) return route.abort();
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    if (path === '/api/command') {
      const data = route.request().postDataJSON() as { event: RoomEvent; command: RoomCommand };
      commands.push(data.event);
      execute(room, data.event, data.command, 'p0', online);
      return route.fulfill({
        json: {
          ack: { commandId: data.command.commandId, ok: true },
          state: view(room, 'p0', online, room.secret),
        },
      });
    }
    if (control.ticking) tick(room, online, Date.now());
    return route.fulfill({ json: { state: view(room, 'p0', online, room.secret) } });
  });
  await page.goto('/');
  await expect(page.locator('.hand-result')).toBeVisible();
  return { room, online, commands, control };
}

test('details preserve snapshots and clock, keep confirmation usable and honor pause and reconnect', async ({
  page,
}) => {
  const { room, online, commands, control } = await mount(page);
  const details = page.locator('.hand-score-details');
  const toggle = details.locator('summary');
  const facts = JSON.stringify({
    match: room.match,
    scores: room.scores,
    events: room.tableEvents,
    ready: room.nextHandReady,
  });
  const remaining = room.remainingMs!;
  await expect(details).not.toHaveAttribute('open');
  await expect(page.locator('.hand-result code')).not.toBeVisible();
  await toggle.click();
  await expect(page.locator('.hand-result code')).toHaveText(room.scores[0]!.calculation!.formula);
  await expect(details).toContainText('玩家2触发本次结算， 由玩家0承包三份付款。');
  await expect.poll(() => room.remainingMs!).toBeLessThan(remaining - 1000);
  await expect(details).toHaveAttribute('open');
  await toggle.click();
  await expect(page.locator('.hand-result code')).not.toBeVisible();
  await toggle.click();
  expect(commands).toEqual([]);
  expect(
    JSON.stringify({
      match: room.match,
      scores: room.scores,
      events: room.tableEvents,
      ready: room.nextHandReady,
    }),
  ).toBe(facts);
  expect(room.remainingMs!).toBeLessThan(remaining);
  const next = page.getByRole('button', { name: /开始下一把/ });
  online.delete('p2');
  await expect(next).toBeDisabled();
  await expect(page.locator('.result-bottom')).toContainText('等待玩家2重连');
  online.add('p2');
  await expect(next).toBeEnabled();
  control.network = false;
  await expect(page.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
  await expect(next).toBeDisabled();
  control.network = true;
  await expect(page.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByRole('button', { name: '已准备 · 1/4' })).toBeDisabled();
  expect(commands).toEqual(['room:next-ready']);
  expect(room.nextHandReady).toEqual([0]);
  await page.getByRole('button', { name: '查看牌桌', exact: true }).click();
  await expect(page.locator('.hand-result')).toHaveCount(0);
  await page.locator('.reopen-result').click();
  await expect(page.locator('.hand-result')).toBeVisible();
  await expect(details).not.toHaveAttribute('open');
});

test('all winners, long formulas and names fit desktop, narrow and expanded history with accessible actions', async ({
  page,
}, info) => {
  const { room, control, commands } = await mount(page, 'discard', true);
  control.ticking = false;
  const dialog = page.locator('.hand-result');
  await expect(dialog.locator('.result-winners p')).toHaveCount(3);
  for (const seat of [1, 2, 3])
    await expect(dialog.locator('.result-winners')).toContainText(room.members[seat]!.name);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await dialog.locator('.hand-result-content').evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect(dialog.locator('h2')).toBeVisible();
    await expect(page.getByRole('button', { name: /开始下一把/ })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`settlement-${width}-summary.png`) });
    await page.locator('.table-history > summary').click();
    await dialog.locator('.hand-score-details > summary').click();
    const content = dialog.locator('.hand-result-content');
    expect(await content.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await content.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const next = page.getByRole('button', { name: /开始下一把/ });
    await expect(next).toBeVisible();
    await expect(next).toBeEnabled();
    const [board, result, footer, history] = await Promise.all([
      page.locator('.table-board').boundingBox(),
      dialog.boundingBox(),
      page.locator('.result-bottom').boundingBox(),
      page.locator('.table-history').boundingBox(),
    ]);
    expect(result!.y).toBeGreaterThanOrEqual(history!.y + history!.height);
    expect(result!.y + result!.height).toBeLessThanOrEqual(board!.y + board!.height);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(result!.y + result!.height);
    expect(await content.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      await page
        .locator('.result-actions')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`settlement-${width}-history-details.png`) });
    await dialog.locator('.hand-score-details > summary').click();
    await page.locator('.table-history > summary').click();
  }
  expect(commands).toEqual([]);
  await page.getByRole('button', { name: /开始下一把/ }).click();
  await expect(page.getByRole('button', { name: '已准备 · 1/4' })).toBeDisabled();
});

test('legacy payments stay readable and final match ranking, details and rematch are unchanged', async ({
  page,
}) => {
  const { room, control, commands } = await mount(page, 'discard');
  control.ticking = false;
  room.tableEvents = [];
  room.scores.forEach((score) => {
    delete score.calculation;
    delete score.winningHand;
  });
  room.revision++;
  await expect(page.locator('.result-winners')).toContainText('当前快照未提供胡牌玩家或方式');
  await expect(page.locator('.hand-deltas strong')).toHaveText([
    '未提供',
    '未提供',
    '未提供',
    '未提供',
  ]);
  await page.locator('.hand-score-details > summary').click();
  await expect(page.locator('.hand-result .score-legacy')).toHaveCount(3);
  await expect(page.locator('.hand-result code')).toHaveCount(0);
  room.status = 'completed';
  room.revision++;
  await expect(page.locator('.final-panel')).toBeVisible();
  await expect(page.locator('.hand-result')).toHaveCount(0);
  await expect(page.locator('.ranking > div')).toHaveCount(4);
  await expect(page.locator('.final-hand-details .score-legacy')).toHaveCount(3);
  for (const seat of [0, 1, 2, 3])
    await expect(page.locator('.ranking')).toContainText(
      String(room.match!.cumulativeScores[seat]),
    );
  await page.getByRole('button', { name: '再来一将', exact: true }).click();
  await expect(page.locator('.waiting')).toBeVisible();
  expect(commands).toEqual(['room:rematch']);
});
