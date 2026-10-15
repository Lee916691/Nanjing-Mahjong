import { test, expect } from '@playwright/test';
import { createRoom, execute } from '../../cloud/commands';
import { advance, apply, view } from '../../apps/server/src/table';
import { threeMouthRoom } from '../../apps/server/test/three-mouth-fixture';
import type { RoomCommand, RoomEvent } from '@nanjing-mahjong/shared-types';

for (const selfDraw of [false, true]) {
  test(`three-mouth ${selfDraw ? 'self-draw' : 'discard'} choices survive refresh and show the responsible payer`, async ({
    browser,
  }, info) => {
    const sessions = ['p0', 'p1', 'p2', 'p3'],
      online = new Set(sessions);
    const room = { ...createRoom('p0', '玩家0'), ...threeMouthRoom(selfDraw) };
    if (!selfDraw) {
      apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
      advance(room);
    }
    const contexts = await Promise.all(sessions.map(() => browser.newContext()));
    try {
      const pages = await Promise.all(
        contexts.map(async (context, i) => {
          await context.route('**/api/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path === '/api/stream') return route.fulfill({ status: 404, json: {} });
            if (path === '/api/session') return route.fulfill({ json: { roomId: room.id } });
            if (path === '/api/command') {
              const data = route.request().postDataJSON() as {
                event: RoomEvent;
                command: RoomCommand;
              };
              execute(room, data.event, data.command, sessions[i]!, online);
              return route.fulfill({
                json: {
                  ack: { commandId: data.command.commandId, ok: true },
                  state: view(room, sessions[i]!, online, room.secret),
                },
              });
            }
            return route.fulfill({
              json: { state: view(room, sessions[i]!, online, room.secret) },
            });
          });
          const page = await context.newPage();
          await page.goto('/');
          return page;
        }),
      );
      const actor = pages[1]!;
      await actor.reload();
      await expect(
        actor.getByRole('button', { name: selfDraw ? '自摸胡' : '胡', exact: true }),
      ).toBeVisible();
      await expect(actor.getByRole('button', { name: /^(暗杠|明杠|碰)/ })).toHaveCount(0);
      if (!selfDraw)
        await expect(actor.getByRole('button', { name: '过', exact: true })).toBeVisible();
      await actor.getByRole('button', { name: selfDraw ? '自摸胡' : '胡', exact: true }).click();
      for (const page of pages) {
        await expect(page.getByText('三嘴包子', { exact: false }).first()).toBeVisible();
        await expect(page.getByText(/由玩家0承包三份付款/).first()).toBeVisible();
      }
      await actor.screenshot({
        path: info.outputPath('three-mouth-settlement.png'),
        fullPage: true,
      });
      expect(room.match!.currentHand.players[1]!.melds).toHaveLength(3);
      expect(room.scores).toHaveLength(1);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
}
