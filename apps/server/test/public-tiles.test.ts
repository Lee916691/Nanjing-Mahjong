import { expect, it } from 'vitest';
import { advance, apply, choices, nextHand, restoreRoomRules, view } from '../src/table.js';
import { anGangRoom, buGangRoom, eventTile, ordinary } from './event-fixture.js';

const online = new Set(['p0', 'p1', 'p2', 'p3']);
const gangIds = [1, 2, 3, 4].map((copy) => `wan-1-${copy}`);
const withoutIds = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (key, field) => (key === 'id' ? undefined : field)));

it('projects a real concealed kong as public faces for all four players and after restore', () => {
  const room = { ...anGangRoom(), cloudFormat: 1 as const, secret: 'public-tiles', clockAt: null };
  const action = choices(room, 0, room.secret).find((choice) => choice.view.kind === 'an-gang')!;
  expect(action.view.token).toBeTruthy();
  apply(room, action.action);
  advance(room);
  expect(room.match!.currentHand.players[0]!.melds[0]!.tiles.map((tile) => tile.id)).toEqual(
    gangIds,
  );
  expect(room.scores[0]!.transfers).toEqual([1, 2, 3].map((from) => ({ from, to: 0, amount: 10 })));
  expect(room.match!.cumulativeScores).toEqual([1030, 990, 990, 990]);
  const before = JSON.stringify(room);
  for (const source of [room, restoreRoomRules(JSON.parse(before) as typeof room)]) {
    for (const seat of [0, 1, 2, 3]) {
      const received = JSON.parse(JSON.stringify(view(source, `p${seat}`, online, room.secret)));
      expect(received.players[0].melds).toEqual([
        {
          kind: 'an-gang',
          tiles: Array.from({ length: 4 }, () => ({ family: 'wan', label: '1万' })),
        },
      ]);
      const event = received.tableEvents.find((item: { type: string }) => item.type === 'an-gang');
      expect(event).toMatchObject({
        id: 1,
        sequence: 1,
        seat: 0,
        tile: { family: 'wan', label: '1万' },
      });
      for (const id of gangIds) expect(JSON.stringify(received)).not.toContain(id);
      if (seat === 0) {
        expect(received.players[0].drawnTileId).toBe('wind-east-2');
        expect(
          received.players[0].hand.some((tile: { id: string }) => tile.id === 'wind-east-2'),
        ).toBe(true);
        expect(
          received.actions.choices.some(
            (choice: { tileId?: string }) => choice.tileId === 'wind-east-2',
          ),
        ).toBe(true);
      } else expect(received.players[0].hand).toBeUndefined();
    }
  }
  expect(JSON.stringify(room)).toBe(before);
});

it('projects saved flower and rack faces without IDs while preserving the stored entities', () => {
  const room = anGangRoom();
  const flower = eventTile('flower-plum-1');
  if (flower.category !== 'flower') throw new Error('Expected flower fixture');
  room.match!.currentHand.players = room.match!.currentHand.players.map((player, seat) =>
    seat === 1 ? { ...player, flowers: [flower] } : player,
  );
  room.match!.currentHand.globalRacks = {
    2: {
      tile: ordinary('tong-5-1'),
      wait: { category: 'number', suit: 'tong', rank: 6 },
      active: true,
    },
  };
  const saved = JSON.stringify(room);
  const restored = restoreRoomRules(JSON.parse(saved) as typeof room);
  for (const seat of [0, 1, 2, 3]) {
    const received = view(restored, `p${seat}`, online, 'public-tiles');
    expect(received.players[1]!.flowers).toEqual([{ family: 'flower', label: '梅' }]);
    expect(received.players[2]!.rack).toEqual({ family: 'tong', label: '5筒' });
    expect(JSON.stringify(received)).not.toContain('flower-plum-1');
    expect(JSON.stringify(received)).not.toContain('tong-5-1');
  }
  expect(JSON.stringify(restored)).toBe(saved);
});

it('keeps all winning faces and stored amounts but no public settlement tile IDs across final states', () => {
  const room = anGangRoom();
  apply(room, {
    type: 'DECLARE_AN_GANG',
    playerIndex: 0,
    tileFace: { category: 'number', suit: 'wan', rank: 1 },
  });
  apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
  advance(room);
  const before = JSON.stringify(room);
  const winner = room.scores.find((score) => score.winningHand)!;
  expect(winner.winningHand!.melds[0]!.tiles.map((tile) => tile.id)).toEqual(gangIds);
  for (const status of ['playing', 'completed', 'ended'] as const) {
    const source = restoreRoomRules({ ...JSON.parse(before), status } as typeof room);
    for (const seat of [0, 1, 2, 3]) {
      const received = JSON.parse(JSON.stringify(view(source, `p${seat}`, online, 'public-tiles')));
      expect(received.scores).toEqual(withoutIds(room.scores));
      expect(JSON.stringify(received.scores)).not.toMatch(/"id"\s*:/);
      for (const id of gangIds) expect(JSON.stringify(received)).not.toContain(id);
      expect(
        received.scores.find((score: { winningHand?: unknown }) => score.winningHand).winningHand
          .melds[0].tiles,
      ).toEqual(Array.from({ length: 4 }, () => ({ family: 'wan', label: '1万' })));
    }
  }
  expect(JSON.stringify(room)).toBe(before);
  const continued = restoreRoomRules(JSON.parse(before) as typeof room);
  nextHand(continued);
  expect(continued.match!.currentHandIndex).toBe(room.match!.currentHandIndex + 1);
  expect(view(continued, 'p1', online, 'public-tiles').scores).toEqual(withoutIds(room.scores));
});

it('replaces claimed entity IDs with a stable tile position and keeps necessary discard IDs', () => {
  const room = buGangRoom();
  const initial = view(room, 'p0', online, 'public-tiles');
  expect(initial.players[0]!.melds[0]).toEqual({
    kind: 'peng',
    fromSeat: 2,
    claimedTileIndex: 2,
    tiles: Array.from({ length: 3 }, () => ({ family: 'wan', label: '7万' })),
  });
  apply(room, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
  room.reactions = { '1': 'pass', '2': 'pass', '3': 'pass' };
  advance(room);
  const upgraded = view(room, 'p0', online, 'public-tiles');
  expect(upgraded.players[0]!.melds[0]).toMatchObject({
    kind: 'bu-gang',
    fromSeat: 2,
    claimedTileIndex: 2,
  });
  expect(upgraded.players[0]!.melds[0]!.tiles).toHaveLength(4);
  expect(JSON.stringify(upgraded.players[0]!.melds)).not.toContain('wan-7-');
  const discard = choices(room, 0, 'public-tiles').find(
    (choice) => choice.view.kind === 'discard',
  )!;
  apply(room, discard.action);
  const received = view(room, 'p0', online, 'public-tiles');
  expect(received.lastDiscard!.id).toBe(discard.view.tileId);
  expect(received.players[0]!.discards.at(-1)!.id).toBe(discard.view.tileId);
});
