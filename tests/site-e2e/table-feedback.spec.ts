import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RoomCommand, RoomEvent, RoomView } from '@nanjing-mahjong/shared-types';
import { appendTableEvents, apply, view } from '../../apps/server/src/table';
import { buGangRoom } from '../../apps/server/test/event-fixture';
import { execute } from '../../cloud/commands';
import { settlementRoom } from '../web/hand-result-fixture';

declare global {
  interface Window {
    feedbackTest: {
      played: string[];
      targets: string[];
      reject: boolean;
      hold: boolean;
      hidden: boolean;
    };
  }
}

async function mount(page: Page, source = buGangRoom(), savedSound = false) {
  const room = { ...source, cloudFormat: 1 as const, secret: 'feedback-fixture', clockAt: null };
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  const control = { network: true, snapshot: null as RoomView | null, reject: false };
  const commands: RoomEvent[] = [];
  await page.addInitScript((enabled) => {
    if (enabled) localStorage.setItem('mj_sound_muted', '0');
    window.feedbackTest = { played: [], targets: [], reject: false, hold: false, hidden: false };
    Object.defineProperty(document, 'visibilityState', {
      get: () => (window.feedbackTest.hidden ? 'hidden' : 'visible'),
    });
    HTMLMediaElement.prototype.play = function () {
      window.feedbackTest.played.push(new URL(this.src).pathname);
      if (window.feedbackTest.reject) return Promise.reject(new Error('NotAllowedError'));
      if (!window.feedbackTest.hold) setTimeout(() => this.dispatchEvent(new Event('ended')), 35);
      return Promise.resolve();
    };
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((records) => {
        for (const record of records) {
          const nodes = record.type === 'attributes' ? [record.target] : [...record.addedNodes];
          for (const node of nodes) {
            if (!(node instanceof Element)) continue;
            const targets = [node, ...node.querySelectorAll('[data-feedback-id]')];
            for (const target of targets) {
              const id = target.getAttribute('data-feedback-id');
              if (id) window.feedbackTest.targets.push(id);
            }
          }
        }
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-feedback-id'],
      });
    });
  }, savedSound);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
    if (!control.network) return route.abort();
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    if (path === '/api/command') {
      const data = route.request().postDataJSON() as { event: RoomEvent; command: RoomCommand };
      commands.push(data.event);
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
      execute(room, data.event, data.command, 'p0', online);
      return route.fulfill({
        json: {
          ack: { commandId: data.command.commandId, ok: true },
          state: view(room, 'p0', online, room.secret),
        },
      });
    }
    return route.fulfill({
      json: { state: control.snapshot ?? view(room, 'p0', online, room.secret) },
    });
  });
  await page.goto('/');
  await expect(page.locator('.table')).toBeVisible();
  const publish = (events: Parameters<typeof appendTableEvents>[1]) => {
    appendTableEvents(room, events);
    room.revision++;
  };
  return { room, control, online, commands, publish };
}
const peng = {
  type: 'peng',
  hand: 1,
  seat: 0,
  fromSeat: 2,
  tile: { family: 'wan', label: '7万' },
} as const;
const played = (page: Page) => page.evaluate(() => window.feedbackTest.played);
const targets = (page: Page) => page.evaluate(() => window.feedbackTest.targets);

test('local toggle drops pending and muted events, persists and never autoplays on refresh', async ({
  page,
}) => {
  const { room, publish } = await mount(page);
  const toggle = page.getByRole('button', { name: '音效：已静音' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  publish([peng]);
  await expect(page.locator('.meld-zone[data-feedback-id]')).toHaveCount(1);
  expect(await played(page)).toEqual([]);
  await toggle.click();
  await page.evaluate(() => {
    window.feedbackTest.hold = true;
  });
  publish([peng, { ...peng, type: 'bu-gang' }]);
  await expect.poll(() => played(page)).toEqual(['/sounds/operation.wav']);
  await page.getByRole('button', { name: '音效：已开启' }).click();
  publish([{ type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 2 }]);
  await expect.poll(async () => page.locator('.table-history').textContent()).toContain('两嘴');
  await page.getByRole('button', { name: '音效：已静音' }).click();
  await page.waitForTimeout(1300);
  expect(await played(page)).toEqual(['/sounds/operation.wav']);
  await page.reload();
  await expect(page.getByRole('button', { name: '音效：已开启' })).toBeVisible();
  expect(await played(page)).toEqual([]);
  expect(await targets(page)).toEqual([]);
  publish([peng]);
  await expect.poll(() => targets(page)).toContain(String(room.tableEvents.at(-1)!.id));
  expect(await played(page)).toEqual([]); // Enabled preference still requires this page's interaction.
  await page.locator('.table-history > summary').click();
  publish([peng]);
  await expect.poll(() => played(page)).toEqual(['/sounds/operation.wav']);
  await page.getByRole('button', { name: '音效：已开启' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '音效：已静音' })).toBeVisible();
});

test('ordered audio and visual IDs survive duplicate/stale views and history remains passive', async ({
  page,
}) => {
  const { room, publish, control } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  const old = view(room, 'p0', new Set(['p0', 'p1', 'p2', 'p3']), room.secret);
  publish([
    peng,
    { type: 'an-gang', hand: 1, seat: 0, tile: peng.tile },
    { type: 'special-rule-confirmed', hand: 1, rule: 'flower-kong', seat: 0 },
    {
      type: 'score-changed',
      hand: 1,
      reason: 'flower-kong-created',
      changes: [{ seat: 0, delta: 60 }],
    },
  ]);
  const ids = room.tableEvents.slice(0, 2).map((event) => String(event.id));
  await expect
    .poll(() => played(page))
    .toEqual(['/sounds/operation.wav', '/sounds/operation.wav', '/sounds/special.wav']);
  await expect.poll(() => targets(page)).toEqual(ids);
  const before = await played(page);
  const visualBefore = await targets(page);
  for (let i = 0; i < 2; i++) await page.locator('.table-history > summary').click();
  control.snapshot = old;
  await page.waitForTimeout(500);
  control.snapshot = null;
  room.revision++;
  await page.waitForTimeout(800);
  expect(await played(page)).toEqual(before);
  expect(await targets(page)).toEqual(visualBefore);
  await expect(page.locator('[data-feedback-id]')).toHaveCount(0);
});

test('rejected audio never blocks notifications, visual feedback, history or later events', async ({
  page,
}) => {
  const { room, publish } = await mount(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '音效：已静音' }).click();
  await page.evaluate(() => {
    window.feedbackTest.reject = true;
  });
  publish([peng, { type: 'special-rule-confirmed', hand: 1, rule: 'follow-discard', seat: 2 }]);
  await expect(page.locator('.table-event-notice')).toContainText('碰牌成立');
  await expect.poll(() => targets(page)).toContain(String(room.tableEvents[0]!.id));
  await expect.poll(() => played(page)).toHaveLength(2);
  await expect(page.locator('.table-event-notice')).toContainText('跟打一圈成立', {
    timeout: 6000,
  });
  await expect(page.locator('.table-event-notice')).toHaveClass(/notice-emphasis/);
  await expect(page.locator('.table-history')).toContainText('跟打一圈成立');
  await page.evaluate(() => {
    window.feedbackTest.reject = false;
  });
  publish([peng]);
  await expect.poll(() => played(page)).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('both reconnect paths baseline offline events and preserve subsequent live feedback', async ({
  page,
}) => {
  const { room, publish, control } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  publish([peng]);
  await expect.poll(() => played(page)).toHaveLength(1);
  for (const offlineChanges of [false, true]) {
    control.network = false;
    await expect(page.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
    if (offlineChanges) publish([peng]);
    control.network = true;
    await expect(page.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
    await expect(page.locator('[data-feedback-id]')).toHaveCount(0);
    const count = (await played(page)).length;
    const before = await targets(page);
    publish([peng]);
    await expect.poll(() => played(page)).toHaveLength(count + 1);
    await expect
      .poll(() => targets(page))
      .toEqual([...before, String(room.tableEvents.at(-1)!.id)]);
  }
});

test('a real discard is emphasized without blocking reactions; unconfirmed and rejected kong never succeeds early', async ({
  page,
}) => {
  const { room, control } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  control.reject = true;
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('操作已失效');
  expect(await played(page)).toEqual([]);
  expect(await targets(page)).toEqual([]);
  control.reject = false;
  await page.reload();
  await page.getByRole('button', { name: '补杠 7万', exact: true }).click();
  await expect(page.locator('.turn-banner')).toContainText('等待抢补杠胡响应');
  expect(await played(page)).toEqual([]);
  expect(await targets(page)).toEqual([]);
  // A separate authoritative discard fact from the real rules engine.
  const source = buGangRoom();
  apply(source, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });
  room.match = source.match;
  room.tableEvents = source.tableEvents;
  room.nextTableEventId = source.nextTableEventId;
  room.nextTableEventSequence = source.nextTableEventSequence;
  room.revision++;
  await expect.poll(() => targets(page)).toContain(String(source.tableEvents[0]!.id));
  await expect(page.locator('.tile.latest')).toHaveAttribute(
    'data-feedback-id',
    String(source.tableEvents[0]!.id),
  );
  expect(await played(page)).toEqual([]);
});

test('background clears pending sounds and consumes missed events without catch-up', async ({
  page,
}) => {
  const { publish } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  await page.evaluate(() => {
    window.feedbackTest.hold = true;
  });
  publish([peng, peng]);
  await expect.poll(() => played(page)).toHaveLength(1);
  await page.evaluate(() => {
    window.feedbackTest.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  publish([peng]);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.feedbackTest.hidden = false;
    window.feedbackTest.hold = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.table-history > summary').click();
  expect(await played(page)).toHaveLength(1);
  await expect(page.locator('[data-feedback-id]')).toHaveCount(0);
  publish([peng]);
  await expect.poll(() => played(page)).toHaveLength(2);
});

test('reduced motion removes transitions and canceled effects cannot block the next hand', async ({
  page,
}) => {
  const { room, publish, commands } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  // Lengthen only the test transition so cancellation is exercised, not an empty animation list.
  const transitionStyle = await page.addStyleTag({
    content: '.feedback-target { transition-duration: 10s; }',
  });
  publish([peng]);
  const meld = page.locator('.meld-zone[data-feedback-id]');
  await expect(meld).toHaveCount(1);
  expect(
    await meld.evaluate((node) => {
      const animations = node.getAnimations();
      animations.forEach((animation) => animation.cancel());
      return animations.length;
    }),
  ).toBeGreaterThan(0);
  await expect(meld).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Remove the test-only override before checking the production reduced-motion styles.
  await transitionStyle.evaluate((node) => node.remove());
  const result = settlementRoom('draw');
  room.match = result.match;
  room.scores = result.scores;
  room.remainingMs = result.remainingMs;
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
  const title = page.locator('#hand-result-title');
  await expect(title).toHaveAttribute('data-feedback-id');
  expect(await title.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
  expect(await title.evaluate((node) => getComputedStyle(node).filter)).toBe('none');
  await title.evaluate((node) => node.getAnimations().forEach((animation) => animation.cancel()));
  await page.getByRole('button', { name: /开始下一把/ }).click();
  await expect(page.getByRole('button', { name: '已准备 · 1/4' })).toBeDisabled();
  expect(commands).toEqual(['room:next-ready']);
  await expect
    .poll(() => played(page))
    .toEqual(['/sounds/operation.wav', '/sounds/draw.wav', '/sounds/settled.wav']);
  await expect.poll(() => targets(page)).toHaveLength(3);
  await expect(page.locator('[data-feedback-id]')).toHaveCount(0);
});

test('live multi-winner hu highlights the result and plays each fact once, with a distinct settlement cue', async ({
  page,
}) => {
  const { room } = await mount(page);
  await page.getByRole('button', { name: '音效：已静音' }).click();
  const result = settlementRoom('discard');
  room.match = result.match;
  room.scores = result.scores;
  room.remainingMs = result.remainingMs;
  room.tableEvents = result.tableEvents;
  room.nextTableEventId = result.nextTableEventId;
  room.nextTableEventSequence = result.nextTableEventSequence;
  room.revision++;
  await expect(page.locator('.result-winners p')).toHaveCount(3);
  await expect(page.locator('#hand-result-title')).toHaveAttribute('data-feedback-id');
  await expect
    .poll(() => played(page))
    .toEqual(['/sounds/win.wav', '/sounds/win.wav', '/sounds/win.wav', '/sounds/settled.wav']);
  const ids = result.tableEvents
    .filter(
      (event) =>
        event.type === 'tile-discarded' || event.type === 'hu' || event.type === 'hand-settled',
    )
    .map((event) => String(event.id));
  await expect.poll(() => targets(page)).toEqual(ids);
  await expect(page.locator('[data-feedback-id]')).toHaveCount(0);
  room.revision++;
  await page.locator('.table-history > summary').click();
  expect(await played(page)).toHaveLength(4);
  expect(await targets(page)).toEqual(ids);
});

test('long names, multi-winner result and expanded history keep the sound toggle and actions usable', async ({
  page,
}, info) => {
  const source = settlementRoom('discard');
  source.members.forEach((member, seat) => {
    member!.name = `${seat}甲乙丙丁戊己庚辛壬癸子丑寅卯辰`;
  });
  const { publish, commands } = await mount(page, source);
  await expect(page.locator('.result-winners p')).toHaveCount(3);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    const toggle = page.getByRole('button', { name: /音效：/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.locator('.table-history > summary').click();
    await page.locator('.hand-score-details > summary').click();
    publish([{ type: 'mouth-locked', hand: 1, seat: 1, fromSeat: 0, mouths: 3 }]);
    await expect(page.locator('.table-event-notice')).toContainText('三嘴');
    await expect(page.locator('.table-event-notice')).toHaveClass(/notice-emphasis/);
    const next = page.getByRole('button', { name: /开始下一把/ });
    await expect(next).toBeVisible();
    await expect(next).toBeEnabled();
    const [button, dialog, history] = await Promise.all([
      toggle.boundingBox(),
      page.locator('.hand-result').boundingBox(),
      page.locator('.table-history').boundingBox(),
    ]);
    expect(button!.y + button!.height).toBeLessThanOrEqual(history!.y);
    expect(history!.y + history!.height).toBeLessThanOrEqual(dialog!.y);
    for (const selector of [
      '.table',
      '.hand-result-content',
      '.result-actions',
      '.table-event-notice',
    ])
      expect(
        await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    await page.screenshot({ path: info.outputPath(`feedback-${width}-history-settlement.png`) });
    await page.locator('.table-history > summary').click();
    await page.locator('.hand-score-details > summary').click();
    await expect(page.locator('.table-event-notice')).toHaveCount(0, { timeout: 6000 });
  }
  expect(commands).toEqual([]);
  for (const sound of ['operation', 'special', 'win', 'draw', 'settled']) {
    const response = await page.request.get(`/sounds/${sound}.wav`);
    expect(response.ok()).toBe(true);
    const wav = await response.body();
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.length).toBeLessThan(10000);
  }
});
