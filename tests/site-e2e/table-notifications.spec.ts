import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RoomCommand, RoomEvent, RoomView } from '@nanjing-mahjong/shared-types';
import { appendTableEvents, apply, view } from '../../apps/server/src/table';
import {
  buGangRoom,
  eventRoom,
  ordinary,
  setEventHand,
} from '../../apps/server/test/event-fixture';
import { execute } from '../../cloud/commands';

async function mount(page: Page, source = buGangRoom(), seat = 0) {
  const room = {
    ...source,
    cloudFormat: 1 as const,
    secret: 'notification-fixture',
    clockAt: null,
  };
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  const control = { network: true, snapshot: null as RoomView | null, reject: false };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
    if (!control.network) return route.abort();
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    if (path === '/api/command') {
      const data = route.request().postDataJSON() as { event: RoomEvent; command: RoomCommand };
      if (control.reject)
        return route.fulfill({
          json: {
            ack: {
              commandId: data.command.commandId,
              ok: false,
              error: { code: 'STALE_ACTION', message: '操作已失效，请重新选择' },
            },
          },
        });
      execute(room, data.event, data.command, `p${seat}`, online);
      return route.fulfill({
        json: {
          ack: { commandId: data.command.commandId, ok: true },
          state: view(room, `p${seat}`, online, room.secret),
        },
      });
    }
    return route.fulfill({
      json: { state: control.snapshot ?? view(room, `p${seat}`, online, room.secret) },
    });
  });
  await page.goto('/');
  await expect(page.locator('.table')).toBeVisible();
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  const publish = (events: Parameters<typeof appendTableEvents>[1]) => {
    appendTableEvents(room, events);
    room.revision++;
  };
  return { room, control, online, publish };
}

test('queues ordered live facts through React updates and keeps history silent on refresh', async ({
  page,
}) => {
  const { room, control, publish } = await mount(page);
  const old = view(room, 'p0', new Set(['p0', 'p1', 'p2', 'p3']), room.secret);
  publish([
    { type: 'tile-discarded', hand: 1, seat: 1, tile: { family: 'wan', label: '1万' } },
    { type: 'peng', hand: 1, seat: 2, fromSeat: 1, tile: { family: 'wan', label: '1万' } },
    { type: 'ming-gang', hand: 1, seat: 3, fromSeat: 2, tile: { family: 'tong', label: '9筒' } },
  ]);
  const notice = page.locator('.table-event-notice');
  await expect(notice).toHaveText('玩家1（南位）打出 1万');
  // An older snapshot must not erase the current queue or repeat the first fact.
  control.snapshot = old;
  await expect(notice).toHaveText('玩家2（西位）碰牌成立：1万', { timeout: 6000 });
  control.snapshot = null;
  await expect(notice).toHaveText('玩家3（北位）明杠成立：9筒', { timeout: 6000 });
  await expect(notice).toHaveCount(0, { timeout: 6000 });
  await page.reload();
  await expect(page.locator('.turn-banner')).toHaveText('轮到你出牌');
  await expect(notice).toHaveCount(0);
  publish([
    { type: 'an-gang', hand: 1, seat: 1, tile: { family: 'wan', label: 'private-face-sentinel' } },
  ]);
  await expect(notice).toHaveText('玩家1（南位）暗杠成立');
  await expect(notice).not.toContainText('private-face-sentinel');
});

test('special confirmations and mouth upgrades display once without relying on score changes', async ({
  page,
}) => {
  const { publish } = await mount(page);
  publish([
    { type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: 0 },
    { type: 'special-rule-confirmed', hand: 1, rule: 'four-winds-gathered', seat: 1 },
    { type: 'special-rule-confirmed', hand: 1, rule: 'follow-discard', seat: 2 },
    { type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 2 },
    { type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 3 },
  ]);
  const notice = page.locator('.table-event-notice');
  for (const text of [
    '玩家0（东位）花杠成立',
    '玩家1（南位）四风归齐成立',
    '玩家2（西位）跟打一圈成立',
    '玩家1（南位）已锁定玩家0（东位）两嘴',
    '玩家1（南位）已锁定玩家0（东位）三嘴',
  ]) {
    await expect(notice).toHaveText(text, { timeout: 8000 });
  }
  publish([
    {
      type: 'score-changed',
      hand: 1,
      reason: 'flower-kong-created',
      changes: [{ seat: 0, delta: 60 }],
    },
  ]);
  await expect(notice).toHaveCount(0, { timeout: 8000 });
});

test('disconnect recovery baselines offline history and room changes reset the queue', async ({
  page,
}) => {
  const { room, control, publish } = await mount(page);
  publish([{ type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 2 }]);
  await expect(page.locator('.table-event-notice')).toContainText('两嘴');
  control.network = false;
  await expect(page.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  publish([{ type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 3 }]);
  control.network = true;
  await expect(page.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  publish([{ type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: 2 }]);
  await expect(page.locator('.table-event-notice')).toContainText('玩家2（西位）花杠成立');
  room.id = 'new-room-fixture';
  room.revision++;
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  publish([{ type: 'special-rule-confirmed', hand: 1, rule: 'four-winds-gathered', seat: 3 }]);
  await expect(page.locator('.table-event-notice')).toContainText('玩家3（北位）四风归齐成立');
});

test('pause and errors keep priority, then draw and settlement remain readable beside the result', async ({
  page,
}, info) => {
  const { room, control, online, publish } = await mount(page);
  publish([{ type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: 0 }]);
  await expect(page.locator('.table-event-notice')).toContainText('花杠成立');
  online.delete('p2');
  await expect(page.locator('.turn-banner')).toHaveText('牌局已暂停 · 等待重连');
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  online.add('p2');
  await expect(page.locator('.table-event-notice')).toContainText('花杠成立');
  control.reject = true;
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('操作已失效');
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  // Reconnect clears the error and baselines past facts rather than replaying them.
  control.network = false;
  await expect(page.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
  control.network = true;
  await expect(page.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
  room.match!.currentHand = {
    ...room.match!.currentHand,
    phase: 'ended',
    turnStage: 'hand-ended',
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
  publish([
    { type: 'draw', hand: 1, summary: '牌墙耗尽，流局' },
    {
      type: 'hand-settled',
      hand: 1,
      result: 'draw',
      winnerSeats: [],
      changes: [],
      summary: '牌墙耗尽，流局',
    },
  ]);
  await expect(page.locator('.table-event-notice')).toHaveText('流局：牌墙耗尽，流局');
  await expect(page.locator('.hand-result')).toBeVisible();
  await page.screenshot({ path: info.outputPath('notification-settlement.png') });
  await expect(page.locator('.table-event-notice')).toHaveText('第 1 手结算完成', {
    timeout: 8000,
  });
});

test('robbed bu-gang only notifies authoritative hu, and final match notices survive the result page', async ({
  page,
}) => {
  const { room, online, publish } = await mount(page);
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.turn-banner')).toContainText('等待抢补杠胡响应');
  await expect(page.locator('.table-event-notice')).toHaveCount(0);
  for (const seat of [1, 2, 3]) {
    const choice = view(room, `p${seat}`, online, room.secret).actions.choices.find(
      (choice) => choice.kind === (seat === 1 ? 'hu' : 'pass'),
    )!;
    execute(
      room,
      'game:action',
      { commandId: `response-${seat}`, roomId: room.id, token: choice.token },
      `p${seat}`,
      online,
    );
  }
  expect(room.tableEvents.some((event) => event.type === 'bu-gang')).toBe(false);
  await expect(page.locator('.table-event-notice')).toContainText('玩家1（南位）抢补杠胡牌');
  room.status = 'completed';
  publish([]);
  await expect(page.locator('.final-panel')).toBeVisible();
  await expect(page.locator('.table-event-notice')).toContainText('玩家1（南位）抢补杠胡牌');
});

test('four viewpoints share lock direction and long names remain clear above a narrow playable table', async ({
  browser,
}, info) => {
  const source = eventRoom();
  const game = source.match!.currentHand;
  game.threeMouthState = [
    game.threeMouthState[0],
    { status: 'tracking', mouthCount: 1, lockedPayerPlayerIndex: 0 },
    game.threeMouthState[2],
    game.threeMouthState[3],
  ];
  setEventHand(source, 0, [ordinary('wan-1-1')]);
  setEventHand(source, 1, [ordinary('wan-1-2'), ordinary('wan-1-3'), ordinary('tong-9-1')]);
  source.members.forEach((member, seat) => {
    member!.name = `${seat}甲乙丙丁戊己庚辛壬癸子丑寅卯辰`;
  });
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1366, height: 768 } })),
  );
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const fixtures = await Promise.all(pages.map((page, seat) => mount(page, source, seat)));
    apply(source, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    for (const seat of [1, 2, 3])
      apply(source, {
        type: 'SUBMIT_REACTION',
        playerIndex: seat,
        responseType: seat === 1 ? 'peng' : 'pass',
      });
    apply(source, { type: 'RESOLVE_REACTION_WINDOW' });
    for (const fixture of fixtures) {
      fixture.room.match = source.match;
      fixture.room.tableEvents = source.tableEvents;
      fixture.room.revision++;
    }
    await Promise.all(
      pages.map((page) =>
        expect(page.locator('.table-event-notice')).toContainText('已锁定', { timeout: 8000 }),
      ),
    );
    const texts = await Promise.all(
      pages.map((page) => page.locator('.table-event-notice').innerText()),
    );
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toMatch(/^1甲.*（南位）已锁定0甲.*（东位）两嘴$/);
    await pages[1]!.screenshot({ path: info.outputPath('notification-desktop.png') });
    await pages[1]!.setViewportSize({ width: 390, height: 844 });
    const notice = pages[1]!.locator('.table-event-notice');
    const action = pages[1]!.getByRole('button', { name: '出牌', exact: true });
    await expect(action).toBeVisible();
    const rectangles = await Promise.all([
      notice.boundingBox(),
      action.boundingBox(),
      pages[1]!.locator('.hand').boundingBox(),
    ]);
    expect(rectangles[0]!.y + rectangles[0]!.height).toBeLessThan(rectangles[1]!.y);
    expect(rectangles[0]!.y + rectangles[0]!.height).toBeLessThan(rectangles[2]!.y);
    expect(await notice.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await pages[1]!.screenshot({ path: info.outputPath('notification-narrow.png') });
    await pages[1]!.locator('.hand button').last().click();
    await expect(action).toBeEnabled();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
