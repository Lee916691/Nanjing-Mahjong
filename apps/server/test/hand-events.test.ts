import { describe, expect, it } from 'vitest';
import { createGame } from '@nanjing-mahjong/game-core';
import { advance, apply, newRoom, restoreRoomRules, start, view } from '../src/table.js';
import { buGangRoom, eventRoom, eventTile, ordinary, setEventHand } from './event-fixture.js';
import { threeMouthRoom } from './three-mouth-fixture.js';

const factTypes = (room: ReturnType<typeof eventRoom>) =>
  room.tableEvents.filter((event) => event.type !== 'score-changed').map((event) => event.type);

describe('authoritative hand events: base actions', () => {
  it('starts once and preserves public history across views and restore', () => {
    const room = eventRoom();
    start(room);
    expect(room.tableEvents[0]).toMatchObject({
      type: 'hand-started',
      dealer: room.match!.dealerIndex,
    });
    expect(room.tableEvents.filter((event) => event.type === 'hand-started')).toHaveLength(1);
    const saved = structuredClone(room);
    const online = new Set(['p0', 'p1', 'p2', 'p3']);
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    for (const seat of [0, 1, 2, 3]) {
      expect(view(restored, `p${seat}`, online, 'secret').tableEvents).toEqual(saved.tableEvents);
      view(restored, `p${seat}`, online, 'secret');
    }
    expect(restored).toEqual(saved);
  });

  it('records head draw and consecutive tail flowers in actual order without hidden tiles', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: ['flower-plum-1', 'wan-9-1', 'flower-orchid-1', 'flower-bamboo-1'].map(eventTile),
    });
    apply(room, { type: 'DRAW_TILE' });
    expect(room.tableEvents.map((event) => event.type)).toEqual([
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
    ]);
    expect(
      room.tableEvents
        .filter((event) => event.type === 'flower-replaced')
        .map((event) => event.flower.label),
    ).toEqual(['梅', '竹', '兰']);
    for (const event of room.tableEvents.filter((event) => event.type === 'tile-drawn'))
      expect(Object.keys(event).sort()).toEqual(['hand', 'id', 'seat', 'sequence', 'type']);
    expect(JSON.stringify(room.tableEvents)).not.toContain('9万');
    expect(JSON.stringify(room.tableEvents)).not.toContain('wan-9-1');
    expect(room.match!.currentHand.players[0]!.hand.map((tile) => tile.id)).toEqual(['wan-9-1']);
  });

  it('publishes initial flowers and replacement draws without publishing initial hands', () => {
    const room = newRoom('p0', '玩家0');
    const base = createGame();
    const wall = [...base.wall];
    const flowerIndex = wall.findIndex((tile) => tile.id === 'flower-plum-1');
    [wall[0], wall[flowerIndex]] = [wall[flowerIndex]!, wall[0]!];
    const tailIndex = wall.findIndex((tile) => tile.id === 'flower-orchid-1');
    [wall[wall.length - 1], wall[tailIndex]] = [wall[tailIndex]!, wall[wall.length - 1]!];
    room.match = { ...eventRoom().match!, currentHand: { ...base, wall } };
    apply(room, { type: 'START_GAME' });
    expect(room.tableEvents[0]!.type).toBe('hand-started');
    expect(
      room.tableEvents.some(
        (event) => event.type === 'flower-replaced' && event.flower.label === '梅',
      ),
    ).toBe(true);
    const orchid = room.tableEvents.findIndex(
      (event) => event.type === 'flower-replaced' && event.flower.label === '兰',
    );
    expect(room.tableEvents[orchid - 1]!.type).toBe('tile-drawn');
  });

  it('records only accepted discards and automatic draws after resolution', () => {
    const room = eventRoom();
    setEventHand(room, 0, [ordinary('wan-1-1')]);
    const before = structuredClone(room);
    expect(() => apply(room, { type: 'DISCARD_TILE', tileId: 'missing' })).toThrow();
    expect(room).toEqual(before);
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
    advance(room);
    expect(room.tableEvents.map((event) => event.type)).toEqual(['tile-discarded', 'tile-drawn']);
    expect(room.tableEvents[0]).toMatchObject({ seat: 0, tile: { family: 'wan', label: '1万' } });
  });
});

describe('authoritative hand events: meld resolution', () => {
  it.each(['discard', 'bu-gang'] as const)(
    'projects only the public %s response trigger to all seats',
    (source) => {
      const room = buGangRoom();
      apply(
        room,
        source === 'discard'
          ? { type: 'DISCARD_TILE', tileId: 'wan-7-4' }
          : { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' },
      );
      const online = new Set(['p0', 'p1', 'p2', 'p3']);
      for (const seat of [0, 1, 2, 3])
        expect(view(room, `p${seat}`, online, 'secret').responseWindow).toEqual({
          source,
          actorSeat: 0,
        });
      room.reactions['1'] = 'pass';
      expect(view(room, 'p2', online, 'secret').responseWindow).toEqual({ source, actorSeat: 0 });
      for (const seat of [2, 3]) room.reactions[String(seat)] = 'pass';
      advance(room);
      for (const seat of [0, 1, 2, 3])
        expect(view(room, `p${seat}`, online, 'secret').responseWindow).toBeUndefined();
    },
  );
  it.each(['peng', 'ming-gang'] as const)(
    'records %s only after all responses resolve',
    (responseType) => {
      const room = eventRoom();
      setEventHand(room, 0, [ordinary('wan-1-1')]);
      setEventHand(
        room,
        1,
        [2, 3, 4].map((copy) => ordinary(`wan-1-${copy}`)),
      );
      apply(room, { type: 'DISCARD_TILE', tileId: 'wan-1-1' });
      apply(room, { type: 'SUBMIT_REACTION', playerIndex: 1, responseType });
      expect(room.tableEvents.map((event) => event.type)).toEqual(['tile-discarded']);
      apply(room, { type: 'SUBMIT_REACTION', playerIndex: 2, responseType: 'pass' });
      apply(room, { type: 'SUBMIT_REACTION', playerIndex: 3, responseType: 'pass' });
      advance(room);
      expect(room.tableEvents[1]).toMatchObject({
        type: responseType,
        seat: 1,
        fromSeat: 0,
        tile: { label: '1万', family: 'wan' },
      });
      expect(factTypes(room)).toEqual(
        responseType === 'peng'
          ? ['tile-discarded', 'peng']
          : ['tile-discarded', 'ming-gang', 'tile-drawn'],
      );
    },
  );

  it('records a real concealed kong before its tail replacement and rejects a repeated action', () => {
    const room = eventRoom({ wall: ['tong-9-4', 'flower-plum-1'].map(eventTile) });
    setEventHand(
      room,
      0,
      [1, 2, 3, 4].map((copy) => ordinary(`wan-1-${copy}`)),
    );
    const action = {
      type: 'DECLARE_AN_GANG',
      playerIndex: 0,
      tileFace: { category: 'number', suit: 'wan', rank: 1 },
    } as const;
    apply(room, action);
    expect(factTypes(room)).toEqual(['an-gang', 'tile-drawn', 'flower-replaced', 'tile-drawn']);
    expect(room.tableEvents[0]).toMatchObject({ seat: 0, tile: { family: 'wan', label: '1万' } });
    expect(JSON.stringify(room.tableEvents)).not.toContain('wan-1-');
    const saved = structuredClone(room);
    expect(() => apply(room, action)).toThrow();
    expect(room).toEqual(saved);
    apply(room, { type: 'DISCARD_TILE', tileId: 'tong-9-4' });
    expect(room.scores).toEqual(saved.scores);
    expect(room.tableEvents.filter((event) => event.type === 'score-changed')).toHaveLength(1);
  });

  it.each([false, true])('records bu-gang only if robbing hu is absent (%s)', (robbed) => {
    const room = buGangRoom();
    apply(room, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
    expect(room.tableEvents).toEqual([]);
    expect(room.match!.currentHand.turnStage).toBe('waiting-for-reaction');
    for (const seat of [1, 2, 3])
      room.reactions[String(seat)] = robbed && seat === 1 ? 'hu' : 'pass';
    advance(room);
    expect(room.tableEvents.filter((event) => event.type === 'bu-gang')).toHaveLength(
      robbed ? 0 : 1,
    );
    expect(room.match!.currentHand.players[0]!.melds[0]!.type).toBe(robbed ? 'peng' : 'bu-gang');
    if (!robbed) expect(factTypes(room)).toEqual(['bu-gang', 'tile-drawn']);
    const saved = structuredClone(room.tableEvents);
    advance(room);
    expect(room.tableEvents).toEqual(saved);
  });
});

describe('authoritative hand events: results and settlement', () => {
  function verifySettlement(room: ReturnType<typeof eventRoom>, winners: number[]) {
    expect(room.match!.currentHandStatus).toBe('completed');
    const settled = room.tableEvents.filter((event) => event.type === 'hand-settled');
    expect(settled).toHaveLength(1);
    expect(settled[0]!.winnerSeats).toEqual(winners);
    expect(settled[0]!.changes).toEqual(
      room.match!.cumulativeScores.map((score, seat) => ({ seat, delta: score - 1000 })),
    );
    expect(room.tableEvents.filter((event) => event.type === 'score-changed')).toHaveLength(
      room.scores.length,
    );
    const restored = restoreRoomRules(JSON.parse(JSON.stringify(room)));
    const saved = structuredClone(restored);
    advance(restored);
    advance(restored);
    expect(restored).toEqual(saved);
    const online = new Set(['p0', 'p1', 'p2', 'p3']);
    for (const seat of [0, 1, 2, 3]) {
      const events = view(restored, `p${seat}`, online, 'secret').tableEvents;
      expect(events).toEqual(saved.tableEvents);
      const json = JSON.stringify(events);
      for (const privateField of [
        'tileId',
        'winningTile',
        'transfers',
        'responses',
        'token',
        'session',
        'evaluation',
      ])
        expect(json).not.toContain(privateField);
    }
  }

  it('records self-draw hu, score application and hand completion once', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: [ordinary('wind-east-2')],
    });
    setEventHand(
      room,
      0,
      [
        'wan-1-1',
        'wan-2-1',
        'wan-3-1',
        'wan-4-1',
        'wan-5-1',
        'wan-6-1',
        'tiao-1-1',
        'tiao-2-1',
        'tiao-3-1',
        'tong-1-1',
        'tong-2-1',
        'tong-3-1',
        'wind-east-1',
      ].map(ordinary),
    );
    apply(room, { type: 'DRAW_TILE' });
    apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 0 });
    expect(room.tableEvents.map((event) => event.type)).toEqual([
      'tile-drawn',
      'hu',
      'score-changed',
    ]);
    expect(room.tableEvents[1]).toMatchObject({
      fromSeat: null,
      winnerSeats: [0],
      summary: '自摸胡',
    });
    advance(room);
    verifySettlement(room, [0]);
  });

  it.each([false, true])('records all actual winners (rob-bu-gang=%s)', (robbed) => {
    const room = buGangRoom();
    if (robbed) apply(room, { type: 'DECLARE_BU_GANG', playerIndex: 0, meldId: 'meld-1' });
    else apply(room, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });
    room.reactions = { '1': 'hu', '2': 'hu', '3': 'hu' };
    advance(room);
    expect(
      room.tableEvents.filter((event) => event.type === 'hu').map((event) => event.winnerSeats),
    ).toEqual([[1], [2], [3]]);
    for (const event of room.tableEvents.filter((event) => event.type === 'hu'))
      expect(event).toMatchObject({ fromSeat: 0, summary: robbed ? '抢补杠胡' : '点炮胡' });
    expect(room.tableEvents.some((event) => event.type === 'bu-gang')).toBe(false);
    verifySettlement(room, [1, 2, 3]);
  });

  it('gives final hu priority over a submitted peng', () => {
    const room = buGangRoom();
    setEventHand(room, 1, [ordinary('wan-7-1'), ordinary('wan-7-2')]);
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-7-4' });
    room.reactions = { '1': 'peng', '2': 'hu', '3': 'pass' };
    advance(room);
    expect(room.tableEvents.some((event) => ['peng', 'ming-gang'].includes(event.type))).toBe(
      false,
    );
    verifySettlement(room, [2]);
  });

  it.each([false, true])(
    'records special three-mouth hu with the actual responsible payer (self-draw=%s)',
    (selfDraw) => {
      const room = threeMouthRoom(selfDraw);
      if (selfDraw) apply(room, { type: 'DECLARE_SELF_DRAW_HU', playerIndex: 1 });
      else {
        apply(room, { type: 'DISCARD_TILE', tileId: 'tong-8-1' });
        room.reactions['1'] = 'hu';
      }
      advance(room);
      expect(room.tableEvents.find((event) => event.type === 'hu')).toMatchObject({
        winnerSeats: [1],
        responsibleSeat: 0,
        fromSeat: selfDraw ? null : 2,
      });
      expect(
        room.tableEvents.some((event) => ['peng', 'ming-gang', 'an-gang'].includes(event.type)),
      ).toBe(false);
      verifySettlement(room, [1]);
    },
  );

  it('distinguishes empty-wall draw from settlement and does not invent a draw tile', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      wall: [],
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
    });
    advance(room);
    expect(room.tableEvents.map((event) => event.type)).toEqual(['draw', 'hand-settled']);
    verifySettlement(room, []);
  });

  it('records the fourth three-pure kong and forced hu without a provisional tail draw', () => {
    const room = threeMouthRoom();
    const game = room.match!.currentHand;
    game.threeMouthState = createGame().threeMouthState;
    game.players = game.players.map((player, seat) =>
      seat === 1
        ? {
            ...player,
            hand: [2, 3, 4].map((copy) => ordinary(`wan-4-${copy}`)).concat(ordinary('tiao-7-1')),
            melds: player.melds.map((meld, index) => ({
              ...meld,
              type: 'ming-gang',
              tiles: [1, 2, 3, 4].map((copy) => ordinary(`wan-${index + 1}-${copy}`)),
            })),
          }
        : seat === 2
          ? { ...player, hand: [ordinary('wan-4-1')] }
          : player,
    );
    const wall = structuredClone(game.wall);
    apply(room, { type: 'DISCARD_TILE', tileId: 'wan-4-1' });
    room.reactions['1'] = 'ming-gang';
    advance(room);
    expect(room.match!.currentHand.wall).toEqual(wall);
    expect(factTypes(room)).toEqual(['tile-discarded', 'ming-gang', 'hu', 'hand-settled']);
    expect(room.tableEvents.find((event) => event.type === 'hu')).toMatchObject({
      winnerSeats: [1],
      fromSeat: 2,
      summary: '三清胡牌',
    });
    verifySettlement(room, [1]);
  });

  it('records flower-kong real-time payments from existing score lines', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
      wall: ['flower-red-center-4', 'wan-9-1'].map(eventTile),
    });
    const game = room.match!.currentHand;
    game.players = game.players.map((player, seat) =>
      seat === 0
        ? {
            ...player,
            flowers: [1, 2, 3]
              .map((copy) => eventTile(`flower-red-center-${copy}`))
              .filter((tile) => tile.category === 'flower'),
          }
        : player,
    );
    apply(room, { type: 'DRAW_TILE' });
    expect(room.tableEvents.map((event) => event.type)).toEqual([
      'tile-drawn',
      'flower-replaced',
      'tile-drawn',
      'special-rule-confirmed',
      'score-changed',
    ]);
    const event = room.tableEvents.at(-1)!;
    expect(event.type === 'score-changed' && event.changes).toEqual(
      room.match!.cumulativeScores.map((score, seat) => ({ seat, delta: score - 1000 })),
    );
    expect(room.scores).toHaveLength(1);
  });

  it('records the last flower even when no replacement remains', () => {
    const room = eventRoom({
      turnStage: 'waiting-for-draw',
      wall: [eventTile('flower-plum-1')],
      pendingAction: { type: 'draw', playerIndex: 0, seat: 'east' },
    });
    advance(room);
    expect(room.tableEvents.map((event) => event.type)).toEqual([
      'tile-drawn',
      'flower-replaced',
      'draw',
      'hand-settled',
    ]);
    verifySettlement(room, []);
  });

  it('keeps independent counters increasing when real play trims the history', () => {
    const wall = createGame().wall.filter(
      (tile) => tile.category !== 'flower' && tile.id !== 'wan-1-1',
    );
    const room = eventRoom({ wall });
    room.nextTableEventId = 10;
    room.nextTableEventSequence = 1000;
    setEventHand(room, 0, [ordinary('wan-1-1')]);
    for (let step = 0; step < 90; step++) {
      const game = room.match!.currentHand;
      const tile = game.players[game.currentPlayerIndex]!.hand[0]!;
      apply(room, { type: 'DISCARD_TILE', tileId: tile.id });
      advance(room);
    }
    expect(room.tableEvents).toHaveLength(100);
    expect(room.tableEvents[0]!.id).toBeGreaterThan(10);
    expect(room.tableEvents.at(-1)!.id).toBe(room.nextTableEventId - 1);
    expect(room.tableEvents.at(-1)!.sequence).toBe(room.nextTableEventSequence - 1);
    expect(room.nextTableEventSequence - room.nextTableEventId).toBe(990);
    expect(restoreRoomRules(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });
});
