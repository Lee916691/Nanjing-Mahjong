import { test, expect } from '@playwright/test';
import { createRoom, execute } from '../../cloud/commands';
import { start, advance, view } from '../../apps/server/src/table';
import type { RoomEvent, RoomCommand } from '@nanjing-mahjong/shared-types';

test('settlement button counts four confirmations and opens the next hand', async ({ browser }) => {
  const sessions = ['a', 'b', 'c', 'd'],
    online = new Set(sessions);
  const room = createRoom('a', '玩家1');
  room.members = sessions.map((session, i) => ({
    session,
    name: '玩家' + (i + 1),
    ready: true,
    joined: i,
  }));
  start(room);
  room.match!.currentHand = {
    ...room.match!.currentHand,
    phase: 'ended',
    turnStage: 'hand-ended',
    result: { type: 'draw', reason: 'wall-exhausted' },
  };
  advance(room);
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
          return route.fulfill({ json: { state: view(room, sessions[i]!, online, room.secret) } });
        });
        const page = await context.newPage();
        await page.goto('/');
        return page;
      }),
    );
    // Native details stay open through ordinary snapshots and do not affect four confirmations.
    for (const page of pages) {
      await page.locator('.hand-score-details > summary').click();
      await expect(page.locator('.hand-score-details')).toHaveAttribute('open');
    }
    for (let i = 0; i < 3; i++) {
      await pages[i]!.getByRole('button', { name: /开始下一把/ }).click();
      await expect(pages[i]!.getByRole('button', { name: /已准备/ })).toBeDisabled();
    }
    await expect(pages[3]!.getByRole('button', { name: '开始下一把 · 3/4' })).toBeVisible();
    await pages[3]!.getByRole('button', { name: /开始下一把/ }).click();
    for (const page of pages)
      await expect(page.getByRole('heading', { name: /第 2 手/ })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
