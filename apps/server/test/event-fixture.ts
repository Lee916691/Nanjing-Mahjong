import { createGame, createMatch, createNanjingMahjongDeck } from '@nanjing-mahjong/game-core';
import type { GameState, OrdinaryHandTile, Tile } from '@nanjing-mahjong/game-core';
import { newRoom } from '../src/table.js';
import type { SavedRoom } from '../src/table.js';

const deck = createNanjingMahjongDeck();
export const eventTile = (id: string): Tile => {
  const tile = deck.find((candidate) => candidate.id === id);
  if (!tile) throw new Error(`Unknown fixture tile ${id}`);
  return tile;
};
export const ordinary = (id: string): OrdinaryHandTile => {
  const tile = eventTile(id);
  if (tile.category === 'flower') throw new Error('Expected ordinary fixture tile');
  return tile;
};
export function setEventHand(room: SavedRoom, seat: number, hand: OrdinaryHandTile[]) {
  const game = room.match!.currentHand;
  game.players = game.players.map((player, index) =>
    index === seat ? { ...player, hand } : player,
  );
}
export function eventRoom(options: Partial<GameState> = {}) {
  const room = newRoom('p0', '玩家0');
  room.members = [0, 1, 2, 3].map((seat) => ({
    session: `p${seat}`,
    name: `玩家${seat}`,
    ready: true,
    joined: seat,
  }));
  room.status = 'playing';
  room.match = {
    ...createMatch(),
    status: 'playing',
    currentHandStatus: 'playing',
    currentHand: {
      ...createGame(),
      phase: 'playing',
      turnStage: 'waiting-for-discard',
      pendingAction: { type: 'discard', playerIndex: 0, seat: 'east' },
      wall: [ordinary('tong-9-4')],
      ...options,
    },
  };
  return room;
}

export function buGangRoom() {
  const room = eventRoom({ nextMeldSequence: 2 });
  const game = room.match!.currentHand;
  game.players = game.players.map((player, seat) => ({
    ...player,
    hand:
      seat === 0
        ? [ordinary('wan-7-4')]
        : [
            `wan-5-${seat}`,
            `wan-6-${seat}`,
            `tiao-1-${seat}`,
            `tiao-2-${seat}`,
            `tiao-3-${seat}`,
            `tiao-4-${seat}`,
            `tiao-5-${seat}`,
            `tiao-6-${seat}`,
            `tong-1-${seat}`,
            `tong-2-${seat}`,
            `tong-3-${seat}`,
            `wind-${['east', 'south', 'west'][seat - 1]}-1`,
            `wind-${['east', 'south', 'west'][seat - 1]}-2`,
          ].map(ordinary),
    melds:
      seat === 0
        ? [
            {
              id: 'meld-1',
              type: 'peng',
              fromPlayerIndex: 2,
              claimedTileId: 'wan-7-3',
              tiles: [1, 2, 3].map((copy) => ordinary(`wan-7-${copy}`)),
            },
          ]
        : [],
    buGangDrawProvenance: seat === 0 ? [{ targetMeldId: 'meld-1', tileId: 'wan-7-4' }] : [],
  }));
  return room;
}

/** A legal concealed kong followed by a winning tail tile, with identifiable internal IDs. */
export function anGangRoom() {
  const room = eventRoom({ wall: [ordinary('wind-east-2')] });
  setEventHand(
    room,
    0,
    [
      'wan-1-1',
      'wan-1-2',
      'wan-1-3',
      'wan-1-4',
      'wan-2-1',
      'wan-3-1',
      'wan-4-1',
      'tiao-2-1',
      'tiao-3-1',
      'tiao-4-1',
      'tong-2-1',
      'tong-3-1',
      'tong-4-1',
      'wind-east-1',
    ].map(ordinary),
  );
  return room;
}

export function specialRuleRoom(rule: 'flower-kong' | 'four-winds-gathered' | 'follow-discard') {
  const room = eventRoom({ wall: ['tong-9-4', 'wan-9-4'].map(ordinary) });
  const game = room.match!.currentHand;
  setEventHand(room, 0, [ordinary(rule === 'four-winds-gathered' ? 'wind-north-1' : 'wan-1-1')]);
  if (rule === 'four-winds-gathered')
    game.specialDiscardTracking = {
      ...game.specialDiscardTracking,
      windSequences: game.specialDiscardTracking.windSequences.map((sequence, seat) =>
        seat === 0 ? { playerIndex: 0, winds: ['east', 'south', 'west'] } : sequence,
      ),
    };
  else if (rule === 'follow-discard')
    game.specialDiscardTracking = {
      ...game.specialDiscardTracking,
      followDiscard: {
        initiatorPlayerIndex: 1,
        expectedPlayerIndex: 0,
        followerCount: 2,
        tileFace: { category: 'number', suit: 'wan', rank: 1 },
      },
    };
  else {
    game.wall = ['flower-red-center-4', 'wan-9-4'].map(eventTile);
    game.players = game.players.map((player, seat) =>
      seat === 1
        ? {
            ...player,
            flowers: deck
              .filter((tile) => tile.category === 'flower')
              .filter((tile) =>
                ['flower-red-center-1', 'flower-red-center-2', 'flower-red-center-3'].includes(
                  tile.id,
                ),
              ),
          }
        : player,
    );
  }
  return room;
}
