import { test, expect } from '@playwright/test';

test('four friends can join, play, refresh, pause, and reconnect', async ({
  browser,
}, testInfo) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1366, height: 768 } })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    const host = pages[0]!;
    await host.goto('/');
    await host.getByLabel('你的昵称').fill('房主');
    const code = String(Date.now()).slice(-12);
    await host.getByLabel('自定义房间号（可选）').fill(code);
    await host.screenshot({ path: testInfo.outputPath('lobby.png'), fullPage: true });
    await host.locator('form').getByRole('button', { name: '创建房间', exact: true }).click();
    await expect(host.getByRole('heading', { name: '等朋友，开好局' })).toBeVisible();
    const invite = host.url();
    for (let i = 1; i < 4; i++) {
      await pages[i]!.goto(i === 1 ? '/' : invite);
      if (i === 1) {
        await pages[i]!.getByRole('navigation').getByRole('button', { name: '加入房间' }).click();
        await pages[i]!.getByLabel('房间号', { exact: true }).fill(code);
      }
      await pages[i]!.getByLabel('你的昵称').fill('朋友' + i);
      await pages[i]!.locator('form')
        .getByRole('button', { name: '加入房间', exact: true })
        .click();
    }
    for (const page of pages)
      await page.getByRole('button', { name: '准备好了', exact: true }).click();
    await host.getByRole('button', { name: '四人开局', exact: true }).click();
    for (const page of pages) await expect(page.getByLabel('麻将桌')).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath('table.png'), fullPage: true });
    // Advance decisions through the actual user interface without a test-only game endpoint.
    for (let step = 0; step < 8; step++) {
      let acted = false;
      for (const page of pages) {
        const pass = page.getByRole('button', { name: '不报', exact: true });
        if (await pass.isVisible()) {
          await pass.click();
          await expect(pass).toHaveCount(0);
          acted = true;
          break;
        }
        const tile = page.locator('.hand .tile:not([disabled])').first();
        if (await tile.count()) {
          await tile.click();
          await page.getByRole('button', { name: '出牌', exact: true }).click();
          await expect(page.locator('.hand .selected')).toHaveCount(0);
          acted = true;
          break;
        }
        const reaction = page
          .locator('.action-bar')
          .getByRole('button', { name: '过', exact: true });
        if (await reaction.isVisible()) {
          await reaction.click();
          await expect(reaction).toHaveCount(0);
          acted = true;
          break;
        }
      }
      if (!acted) await host.waitForTimeout(200);
    }
    await pages[1]!.getByRole('button', { name: '房间选项', exact: true }).last().click();
    await pages[1]!.getByRole('button', { name: '暂离房间，返回大厅' }).click();
    await pages[1]!.getByRole('button', { name: '确认暂离' }).click();
    await expect(pages[1]!.getByRole('button', { name: '返回原房间' })).toBeVisible();
    await expect(host.getByRole('alert')).toContainText('牌局已暂停', { timeout: 15000 });
    await pages[1]!.reload();
    await expect(pages[1]!.getByRole('button', { name: '返回原房间' })).toBeVisible();
    await pages[1]!.getByRole('button', { name: '返回原房间' }).click();
    await expect(host.getByRole('alert')).toHaveCount(0, { timeout: 15000 });
    await pages[1]!.reload();
    await expect(pages[1]!.getByLabel('麻将桌')).toBeVisible();
    await contexts[3]!.setOffline(true);
    await expect(host.getByRole('alert')).toContainText('牌局已暂停', { timeout: 50000 });
    await contexts[3]!.setOffline(false);
    await expect(host.getByRole('alert')).toHaveCount(0, { timeout: 15000 });
    await pages[2]!.getByRole('button', { name: '房间选项', exact: true }).last().click();
    await pages[2]!.getByRole('button', { name: '提前结束本将', exact: true }).click();
    await pages[2]!.getByRole('button', { name: '确认结束', exact: true }).click();
    for (const page of pages)
      await expect(page.getByRole('heading', { name: '本将已提前结束' })).toBeVisible();
    await host.getByRole('button', { name: '再来一将' }).click();
    await expect(host.getByRole('heading', { name: '等朋友，开好局' })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
