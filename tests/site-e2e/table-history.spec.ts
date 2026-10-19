import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RoomView } from '@nanjing-mahjong/shared-types';
import { appendTableEvents, view } from '../../apps/server/src/table';
import { buGangRoom } from '../../apps/server/test/event-fixture';

async function mount(page: Page, count = 3) {
  const source = buGangRoom();
  source.members.forEach((member, seat) => {
    member!.name = `${seat}甲乙丙丁戊己庚辛壬癸子丑寅卯辰`;
  });
  appendTableEvents(
    source,
    Array.from({ length: count }, (_, i) => ({
      type: 'tile-discarded' as const,
      hand: 1,
      seat: i % 4,
      tile: { family: 'wan', label: `${(i % 9) + 1}万` },
    })),
  );
  const control = {
    network: true,
    room: view(source, 'p0', new Set(['p0', 'p1', 'p2', 'p3']), 'private-token'),
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: source.id } });
    if (!control.network) return route.abort();
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: { state: control.room } });
  });
  await page.goto('/');
  await expect(page.locator('.table')).toBeVisible();
  const panel = page.locator('.table-history');
  const records = panel.locator('li');
  const toggle = panel.locator('summary');
  return { control, panel, records, toggle };
}

test('initial history, refresh and reconnect restore authoritative records without notice replay', async ({
  page,
}) => {
  const { control, panel, records, toggle } = await mount(page);
  await expect(panel).not.toHaveAttribute('open');
  await toggle.click();
  await expect(records).toHaveCount(3);
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  await toggle.click();
  await expect(panel.locator('.table-history-scroll')).not.toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(records).toHaveCount(3);
  await page.reload();
  await toggle.click();
  await expect(records).toHaveCount(3);
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  control.network = false;
  await expect(page.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
  await expect(records).toHaveCount(3);
  control.room = {
    ...control.room,
    revision: control.room.revision + 1,
    tableEvents: [
      ...control.room.tableEvents,
      { id: 99, sequence: 99, hand: 1, type: 'mouth-locked', seat: 1, fromSeat: 0, mouths: 3 },
    ],
  };
  control.network = true;
  await expect(page.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
  await expect(records).toHaveCount(4);
  await expect(records.last()).toContainText(
    '1甲乙丙丁戊己庚辛壬癸子丑寅卯辰（南位）已锁定0甲乙丙丁戊己庚辛壬癸子丑寅卯辰（东位）三嘴',
  );
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  // A duplicate-ID update cannot add another record, and viewing it cannot consume live notices.
  control.room = {
    ...control.room,
    revision: control.room.revision + 1,
    tableEvents: [...control.room.tableEvents, control.room.tableEvents.at(-1)!],
  };
  await expect(records).toHaveCount(4);
  control.room = {
    ...control.room,
    revision: control.room.revision + 1,
    tableEvents: [
      ...control.room.tableEvents,
      {
        id: 100,
        sequence: 100,
        hand: 1,
        type: 'special-rule-confirmed',
        seat: 2,
        rule: 'flower-kong',
      },
    ],
  };
  await expect(records).toHaveCount(5);
  await expect(page.locator('.table-event-notice')).toContainText('花杠成立');
  await toggle.click();
  await toggle.click();
  await expect(page.locator('.table-event-notice')).toContainText('花杠成立');
});

test('old snapshots cannot erase history; trim, rematch, skipped waiting and room switching replace it', async ({
  page,
}) => {
  const { control, panel, records, toggle } = await mount(page);
  const old = structuredClone(control.room);
  control.room = {
    ...control.room,
    revision: control.room.revision + 2,
    tableEvents: [
      {
        id: 31,
        sequence: 31,
        hand: 1,
        type: 'an-gang',
        seat: 0,
        tile: { family: 'wan', label: '1万' },
      },
      {
        id: 32,
        sequence: 32,
        hand: 1,
        type: 'future-event',
        token: 'private-token',
      } as unknown as RoomView['tableEvents'][number],
    ],
  };
  await toggle.click();
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('暗杠成立');
  const latest = structuredClone(control.room);
  control.room = old;
  await expect.poll(() => page.locator('.turn-banner').textContent()).toContain('轮到你出牌');
  // Wait for an explicit marker from the stale snapshot to prove it was delivered.
  control.room = { ...old, remaining: 42 };
  await expect(page.locator('.remaining-tiles')).toContainText('42');
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('暗杠成立');
  await expect(panel).toContainText('暗杠成立：1万');
  await expect(panel).not.toContainText('private-token');
  control.room = { ...latest, revision: latest.revision + 1, status: 'ended' };
  await expect(page.locator('.final-panel')).toBeVisible();
  await page.locator('.table-history summary').click();
  await expect(page.locator('.table-history li')).toHaveCount(1);
  control.room = { ...latest, revision: latest.revision + 2, status: 'waiting', tableEvents: [] };
  await expect(page.locator('.waiting')).toBeVisible();
  control.room = {
    ...latest,
    revision: latest.revision + 3,
    tableEvents: [{ id: 40, sequence: 40, hand: 1, type: 'hand-started', dealer: 0 }],
  };
  await expect(page.locator('.table')).toBeVisible();
  await toggle.click();
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('第 1 手开始');
  // Simulate a rematch whose waiting snapshot was missed while disconnected.
  control.room = {
    ...control.room,
    revision: control.room.revision + 1,
    tableEvents: [
      { id: 50, sequence: 50, hand: 1, type: 'mouth-locked', seat: 2, fromSeat: 3, mouths: 2 },
    ],
  };
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('两嘴');
  control.room = { ...control.room, id: 'another-room', revision: 1, tableEvents: [] };
  await expect(panel).not.toHaveAttribute('open');
  await toggle.click();
  await expect(panel).toContainText('暂无公开记录');
  await expect(records).toHaveCount(0);
});

test('100 events show the latest twenty, scroll and long names fit desktop and narrow playable layouts', async ({
  page,
}, info) => {
  const { panel, records, toggle } = await mount(page, 100);
  await toggle.click();
  await expect(records).toHaveCount(20);
  await expect(records.first()).toHaveAttribute('data-event-id', '81');
  await expect(records.last()).toHaveAttribute('data-event-id', '100');
  const scroll = panel.locator('.table-history-scroll');
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await expect
      .poll(async () => {
        const [history, hand, action] = await Promise.all([
          panel.boundingBox(),
          page.locator('.hand').boundingBox(),
          page.locator('.action-bar').boundingBox(),
        ]);
        return (
          !!history &&
          !!hand &&
          !!action &&
          history.y + history.height <= hand.y &&
          history.y + history.height <= action.y
        );
      })
      .toBe(true);
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await scroll.evaluate((node) => node.scrollTop > 0)).toBe(true);
    await page.screenshot({ path: info.outputPath(`history-${width}.png`) });
    await toggle.click();
    await expect(scroll).not.toBeVisible();
    await toggle.click();
  }
  await page.locator('.hand button').last().click();
  await expect(page.getByRole('button', { name: '出牌', exact: true })).toBeEnabled();
});
