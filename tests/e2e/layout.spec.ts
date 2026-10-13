import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';
import { createApp } from '../../apps/server/src/app';
import { newRoom, view, HAND_REVIEW_MS } from '../../apps/server/src/table';
import {
  createGame,
  createMatch,
  createNanjingMahjongDeck,
  NANJING_OPEN_RULE_SET,
  explainNanjingScore,
} from '@nanjing-mahjong/game-core';
import type {
  OrdinaryHandTile,
  FlowerTile,
  Meld,
  PendingHuScoringEvent,
} from '@nanjing-mahjong/game-core';

test('four-sided table stays readable with full rivers, melds, flowers and a drawn tile', async ({
  browser,
}, testInfo) => {
  const app = createApp({ dbPath: ':memory:' });
  await new Promise<void>((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  const address = app.http.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const origin = `http://127.0.0.1:${address.port}`;
  const sessions = Array.from({ length: 4 }, () => app.store.session());
  const names = ['金陵闲客', '竹里听风', '秦淮月', '晚来一局'];
  const room = newRoom(sessions[0]!, names[0]!);
  room.members = sessions.map((session, i) => ({
    session,
    name: names[i]!,
    ready: true,
    joined: i,
  }));
  room.status = 'playing';
  const available = createNanjingMahjongDeck();
  const take = (face: string): OrdinaryHandTile => {
    const index = available.findIndex(
      (t) => t.category !== 'flower' && t.id.startsWith(face + '-'),
    );
    if (index < 0) throw new Error('fixture exhausted ' + face);
    return available.splice(index, 1)[0] as OrdinaryHandTile;
  };
  const hand = [
    'wan-1',
    'wan-2',
    'wan-3',
    'wan-5',
    'wan-8',
    'tong-1',
    'tong-3',
    'tong-5',
    'tong-8',
    'tong-9',
    'tiao-1',
    'tiao-5',
    'tiao-8',
    'wind-east',
  ].map(take);
  const meld = (face: string, count: number, kind: Meld['type'], from?: number): Meld => {
    const tiles = Array.from({ length: count }, () => take(face));
    return {
      id: 'fixture-' + face,
      type: kind,
      tiles,
      ...(from === undefined ? {} : { fromPlayerIndex: from, claimedTileId: tiles[0]!.id }),
    };
  };
  const melds: Meld[][] = [
    [],
    [meld('wan-2', 3, 'peng', 0), meld('tong-5', 3, 'peng', 2)],
    [meld('wind-north', 4, 'an-gang')],
    [meld('tiao-6', 4, 'bu-gang', 1)],
  ];
  const base = createGame();
  const players = base.players.map((p, i) => {
    const concealed =
      i === 0
        ? hand
        : Array.from({ length: 13 - melds[i]!.length * 3 }, () => {
            const index = available.findIndex((t) => t.category !== 'flower');
            return available.splice(index, 1)[0] as OrdinaryHandTile;
          });
    const flowers = available
      .filter((t) => t.category === 'flower')
      .filter((_, n) => n % 4 === i)
      .slice(0, 3) as FlowerTile[];
    flowers.forEach((t) =>
      available.splice(
        available.findIndex((c) => c.id === t.id),
        1,
      ),
    );
    return { ...p, hand: concealed, flowers, melds: melds[i]! };
  });
  for (const player of players) {
    player.discardPile = Array.from({ length: 16 }, () => {
      const index = available.findIndex((t) => t.category !== 'flower');
      if (index < 0) throw new Error('not enough discards');
      return { tile: available.splice(index, 1)[0] as OrdinaryHandTile };
    });
  }
  const last = players[3]!.discardPile.at(-1)!.tile;
  room.match = {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHandIndex: 3,
    effectiveDealerTurn: 3,
    cumulativeScores: [1284, 976, 1052, 688],
    currentHand: {
      ...base,
      players,
      wall: available,
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      nextMeldSequence: 5,
      pendingAction: { type: 'discard', playerIndex: 0, seat: 'east' },
      selfDrawProvenance: { playerIndex: 0, tileId: hand.at(-1)!.id, source: 'wall-head' },
      lastDiscard: { tile: last, tileId: last.id, fromPlayerIndex: 3, fromSeat: 'north' },
    },
  };
  app.store.commit(room);
  app.rooms.set(room.id, room);
  const sockets = sessions
    .slice(1)
    .map((session) =>
      io(origin, { extraHeaders: { cookie: `mj_session=${session}` }, reconnection: false }),
    );
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
        }),
    ),
  );
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addCookies([
    { name: 'mj_session', value: sessions[0]!, url: origin, httpOnly: true, sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await expect(page.getByLabel('麻将桌')).toBeVisible();
    await expect(page.locator('.discard-grid .tile')).toHaveCount(64);
    await expect(page.locator('.hand .drawn')).toHaveCount(1);
    await expect(page.locator('.meld .called')).toHaveCount(3);
    await expect(page.locator('.tile.latest')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('table-midgame-1366.png'), fullPage: true });
    const drawn = await page.locator('.hand .drawn').boundingBox();
    const table = await page.getByLabel('麻将桌').boundingBox();
    expect(drawn!.y + drawn!.height).toBeLessThan(table!.y + table!.height);
    expect(table!.y + table!.height).toBeLessThanOrEqual(768);
    const riverRects = await page.locator('.river').evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (let i = 0; i < riverRects.length; i++)
      for (let j = i + 1; j < riverRects.length; j++) {
        const a = riverRects[i]!,
          b = riverRects[j]!;
        expect(
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        ).toBe(true);
      }
    const overlap = await page.evaluate(() => {
      const badges = [...document.querySelectorAll('.player-badge')].map((n) =>
        n.getBoundingClientRect(),
      );
      return [...document.querySelectorAll('.meld-zone .tile')].some((n) => {
        const tile = n.getBoundingClientRect();
        return badges.some(
          (b) =>
            tile.left < b.right &&
            tile.right > b.left &&
            tile.top < b.bottom &&
            tile.bottom > b.top,
        );
      });
    });
    expect(overlap, 'meld tiles must not overlap player names or scores').toBe(false);
    const handTile = page.locator('.hand button[data-face="5筒"]');
    await handTile.hover();
    await expect(page.locator('.meld .tile.matching')).toHaveCount(3);
    await handTile.click();
    await expect(handTile).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '出牌', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '牌面说明', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '牌面说明' })).toContainText(
      '中、发、白均作花牌',
    );
    await page.screenshot({ path: testInfo.outputPath('tile-catalog.png'), fullPage: true });
    await page.getByRole('button', { name: '关闭牌面说明' }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: testInfo.outputPath('table-midgame-1920.png'), fullPage: true });
    await page.getByRole('button', { name: '全屏', exact: true }).click();
    await expect(page.getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    // The score card uses the same rule evaluator and snapshot formatter as production.
    const scoreDeck = createNanjingMahjongDeck();
    const scoreTile = (id: string) => scoreDeck.find((t) => t.id === id) as OrdinaryHandTile;
    const winningTile = scoreTile('wan-9-1');
    const evaluation = NANJING_OPEN_RULE_SET.evaluateHu({
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      playerCount: 4,
      winningTile,
      concealedTiles: [
        'wan-1-1',
        'wan-2-1',
        'wan-3-1',
        'wan-4-1',
        'wan-5-1',
        'wan-6-1',
        'wan-7-1',
        'wan-8-1',
        'tiao-1-1',
        'tiao-2-1',
        'tiao-3-1',
        'tiao-5-1',
        'tiao-5-2',
      ].map(scoreTile),
      melds: [],
      flowers: scoreDeck.filter((t) => t.category === 'flower').slice(0, 3) as FlowerTile[],
      allMelds: [],
      dealerIndex: 0,
    })!;
    const event: PendingHuScoringEvent = {
      type: 'hu-resolved',
      source: 'discard',
      winnerPlayerIndex: 1,
      payerPlayerIndex: 0,
      winningTile,
      evaluation,
      status: 'pending',
      transfers: NANJING_OPEN_RULE_SET.getHuScoreTransfers({
        source: 'discard',
        winnerPlayerIndex: 1,
        payerPlayerIndex: 0,
        playerCount: 4,
        evaluation,
      }),
    };
    room.match = {
      ...room.match!,
      currentHandStatus: 'completed',
      currentHand: {
        ...room.match!.currentHand,
        phase: 'ended',
        turnStage: 'hand-ended',
        result: {
          type: 'win',
          source: 'discard',
          payerPlayerIndex: 0,
          winningTile,
          winners: [{ playerIndex: 1, evaluation }],
        },
      },
    };
    room.remainingMs = HAND_REVIEW_MS;
    room.scores = [
      {
        hand: 4,
        reason: 'discard、men-qing',
        calculation: explainNanjingScore(event),
        transfers: event.transfers.map((t) => ({
          from: t.fromPlayerIndex,
          to: t.toPlayerIndex,
          amount: t.amount,
        })),
      },
    ];
    for (const socket of app.io.sockets.sockets.values()) {
      if (socket.data.session === sessions[0])
        socket.emit('room:state', view(room, sessions[0]!, new Set(sessions), app.store.secret()));
    }
    await expect(page.getByRole('dialog', { name: '本局结算', exact: true })).toBeVisible();
    await expect(page.locator('.hand-result code')).toHaveText('(10+10+6+2)×2=56');
    await expect(page.locator('.hand-result')).toContainText('缺一 1 花');
    await expect(page.locator('.result-bottom')).toContainText(/4[345] 秒后开始下一手/);
    await page.screenshot({ path: testInfo.outputPath('table-settlement.png'), fullPage: true });
    await page.getByRole('button', { name: '查看牌桌', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '本局结算', exact: true })).toHaveCount(0);
    await page.locator('.score-log summary').click();
    await expect(page.locator('.score-log code')).toHaveText('(10+10+6+2)×2=56');
    await page.locator('.score-log summary').click();
    // Switch to the player with two exposed melds to verify their ownership and proximity.
    room.match = {
      ...room.match!,
      currentHandStatus: 'playing',
      currentHand: {
        ...room.match!.currentHand,
        phase: 'playing',
        turnStage: 'waiting-for-discard',
        result: undefined,
      },
    };
    room.remainingMs = null;
    app.rooms.set(room.id, room);
    app.store.commit(room);
    await context.addCookies([
      { name: 'mj_session', value: sessions[1]!, url: origin, httpOnly: true, sameSite: 'Strict' },
    ]);
    await page.reload();
    const replacement = io(origin, {
      extraHeaders: { cookie: `mj_session=${sessions[0]}` },
      reconnection: false,
    });
    sockets.push(replacement);
    await expect(page.getByRole('dialog', { name: '本局结算', exact: true })).toHaveCount(0);
    await expect(page.locator('.self-open')).toHaveAttribute('data-owner', '1');
    await expect(page.locator('.self-open .meld')).toHaveCount(2);
    const ownOpen = await page.locator('.self-open').boundingBox();
    const ownHand = await page.locator('.hand').boundingBox();
    expect(ownHand!.y - (ownOpen!.y + ownOpen!.height)).toBeGreaterThanOrEqual(0);
    expect(ownHand!.y - (ownOpen!.y + ownOpen!.height)).toBeLessThan(30);
    await page.screenshot({ path: testInfo.outputPath('owned-melds-1920.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: testInfo.outputPath('owned-melds-1366.png'), fullPage: true });
  } finally {
    await context.close();
    sockets.forEach((s) => s.disconnect());
    await app.close();
  }
});
