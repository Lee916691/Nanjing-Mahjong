import { expect, test } from '@playwright/test';
import type { RoomCommand, RoomEvent } from '@nanjing-mahjong/shared-types';
import { anGangRoom } from '../../apps/server/test/event-fixture';
import { restoreRoomRules, view } from '../../apps/server/src/table';
import { execute } from '../../cloud/commands';

test('four viewpoints share public kong faces and back/face/face/back through recovery and settlement', async ({
  browser,
}, info) => {
  const room = {
    ...anGangRoom(),
    cloudFormat: 1 as const,
    secret: 'public-tiles-browser',
    clockAt: null,
  };
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const network = { enabled: true };
  const responses: string[] = [];
  try {
    const pages = await Promise.all(
      contexts.map(async (context, seat) => {
        await context.route('**/api/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
          if (!network.enabled) return route.abort();
          if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
          let ack;
          if (path === '/api/command') {
            const data = route.request().postDataJSON() as {
              event: RoomEvent;
              command: RoomCommand;
            };
            execute(room, data.event, data.command, `p${seat}`, online);
            ack = { commandId: data.command.commandId, ok: true };
          }
          const raw = JSON.stringify({
            state: view(room, `p${seat}`, online, room.secret),
            ...(ack ? { ack } : {}),
          });
          if (room.match!.currentHand.players[0]!.melds.length) responses.push(raw);
          return route.fulfill({ contentType: 'application/json', body: raw });
        });
        const page = await context.newPage();
        await page.goto('/');
        return page;
      }),
    );
    await pages[0]!.getByRole('button', { name: '暗杠 1万', exact: true }).click();
    for (const page of pages) {
      const meld = page.locator('[data-owner="0"] .meld[aria-label="暗杠 1万"]');
      await expect(meld).toBeVisible();
      await expect(meld.locator('.meld-slot')).toHaveCount(4);
      expect(
        await meld
          .locator('.meld-slot')
          .evaluateAll((slots) =>
            slots.map((slot) =>
              slot.querySelector('.tile-back')
                ? 'back'
                : slot.querySelector('[data-face]')?.getAttribute('data-face'),
            ),
          ),
      ).toEqual(['back', '1万', '1万', 'back']);
      expect(await meld.evaluate((node) => getComputedStyle(node).flexDirection)).toBe('row');
      await expect(meld.locator('.tile-face path').first()).toBeVisible();
      await page.locator('.table-history > summary').click();
      await expect(page.locator('.table-history')).toContainText('暗杠成立：1万');
    }
    await pages[0]!.screenshot({ path: info.outputPath('concealed-kong-self.png') });
    await pages[1]!.screenshot({ path: info.outputPath('concealed-kong-opponent.png') });
    Object.assign(room, restoreRoomRules(JSON.parse(JSON.stringify(room)) as typeof room));
    await pages[1]!.reload();
    await expect(
      pages[1]!.locator('[data-owner="0"] .meld[aria-label="暗杠 1万"] .tile-back'),
    ).toHaveCount(2);
    network.enabled = false;
    await expect(pages[2]!.locator('.connection')).toContainText('正在重连', { timeout: 8000 });
    network.enabled = true;
    await expect(pages[2]!.locator('.connection')).toHaveText('已连接', { timeout: 8000 });
    await expect(
      pages[2]!.locator('[data-owner="0"] .meld[aria-label="暗杠 1万"] .tile-back'),
    ).toHaveCount(2);
    for (const raw of responses) {
      expect(raw).not.toMatch(/wan-1-[1-4]/);
      const state = JSON.parse(raw).state;
      expect(
        JSON.stringify(state.players.flatMap((player: { melds: unknown[] }) => player.melds)),
      ).not.toMatch(/"id"\s*:/);
    }
    await pages[0]!.getByRole('button', { name: '自摸胡', exact: true }).click();
    for (const page of pages) {
      await expect(page.locator('.hand-result')).toBeVisible();
      await page.locator('.hand-score-details > summary').click();
      await expect(page.locator('.hand-result .meld-group [data-face="1万"]')).toHaveCount(4);
    }
    room.status = 'completed';
    room.revision++;
    for (const page of pages) {
      await expect(page.locator('.final-panel')).toBeVisible();
      await expect(page.locator('.final-hand-details .meld-group [data-face="1万"]')).toHaveCount(
        4,
      );
    }
    for (const raw of responses) {
      expect(raw).not.toMatch(/wan-1-[1-4]/);
      expect(JSON.stringify(JSON.parse(raw).state.scores)).not.toMatch(/"id"\s*:/);
    }
    expect(
      room.scores.find((score) => score.winningHand)!.winningHand!.melds[0]!.tiles[0]!.id,
    ).toBe('wan-1-1');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('necessary hand IDs still select and submit a real discard after a concealed kong', async ({
  page,
}) => {
  const room = {
    ...anGangRoom(),
    cloudFormat: 1 as const,
    secret: 'public-tiles-discard',
    clockAt: null,
  };
  const online = new Set(['p0', 'p1', 'p2', 'p3']);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
    if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
    let ack;
    if (path === '/api/command') {
      const data = route.request().postDataJSON() as { event: RoomEvent; command: RoomCommand };
      execute(room, data.event, data.command, 'p0', online);
      ack = { commandId: data.command.commandId, ok: true };
    }
    return route.fulfill({
      json: { state: view(room, 'p0', online, room.secret), ...(ack ? { ack } : {}) },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '暗杠 1万', exact: true }).click();
  await page.locator('.hand').getByRole('button', { name: '东', exact: true }).last().click();
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await expect(page.locator('.tile.latest')).toHaveAttribute('data-face', '东');
  expect(room.tableEvents.some((event) => event.type === 'tile-discarded')).toBe(true);
  expect(room.match!.currentHand.players[0]!.melds[0]!.tiles.map((tile) => tile.id)).toEqual(
    [1, 2, 3, 4].map((copy) => `wan-1-${copy}`),
  );
});
