export interface HealthResponse {
  status: 'ok';
}

export type RoomRuleSetId = 'nanjing-open' | 'nanjing-open-duo';

export interface TileView {
  id: string;
  label: string;
  family: string;
}
export interface ActionChoice {
  token: string;
  label: string;
  kind: string;
  tileId?: string;
}
export interface AvailableActions {
  choices: ActionChoice[];
}
export interface PlayerGameView {
  seat: number;
  name: string;
  connected: boolean;
  ready: boolean;
  handCount: number;
  hand?: TileView[];
  /** Only included in the receiving player's private view. */
  drawnTileId?: string;
  flowers: PublicTableTile[];
  melds: { kind: string; tiles: PublicTableTile[]; claimedTileIndex?: number; fromSeat?: number }[];
  discards: TileView[];
  diHu: boolean;
  score: number;
  rack?: PublicTableTile;
}
export interface ScoreLine {
  responsibility?: { trigger: number; payer: number };
  winningHand?: {
    concealed: TileView[];
    melds: { kind: string; tiles: TileView[] }[];
    flowers: TileView[];
    winningTile: TileView;
  };
  calculation?: {
    terms: { label: string; points: number }[];
    factors: { label: string; value: number }[];
    formula: string;
    perPayment: number;
    payments: number;
    total: number;
    winner?: number;
  };
  hand: number;
  reason: string;
  transfers: { from: number; to: number; amount: number }[];
}
export type TableEventType =
  | 'hand-started'
  | 'tile-drawn'
  | 'tile-discarded'
  | 'flower-replaced'
  | 'peng'
  | 'ming-gang'
  | 'an-gang'
  | 'bu-gang'
  | 'hu'
  | 'draw'
  | 'score-changed'
  | 'special-rule-confirmed'
  | 'mouth-locked'
  | 'hand-settled';
export interface PublicTableTile {
  family: string;
  label: string;
}
/** Display-only score snapshot; internal ScoreLine archives retain entity IDs. */
export type PublicScoreLine = Omit<ScoreLine, 'winningHand'> & {
  winningHand?: {
    concealed: PublicTableTile[];
    melds: { kind: string; tiles: PublicTableTile[] }[];
    flowers: PublicTableTile[];
    winningTile: PublicTableTile;
  };
};
export interface TableScoreChange {
  seat: number;
  delta: number;
}
interface TableEventBase {
  id: number;
  sequence: number;
  type: TableEventType;
  hand: number;
}
export type TableEvent =
  | (TableEventBase & {
      type: 'special-rule-confirmed';
      rule: 'flower-kong' | 'four-winds-gathered' | 'follow-discard';
      seat: number;
    })
  | (TableEventBase & {
      type: 'mouth-locked';
      seat: number;
      fromSeat: number;
      mouths: 2 | 3;
    })
  | (TableEventBase & { type: 'hand-started'; dealer: number })
  | (TableEventBase & { type: 'tile-drawn'; seat: number })
  | (TableEventBase & { type: 'tile-discarded'; seat: number; tile: PublicTableTile })
  | (TableEventBase & { type: 'flower-replaced'; seat: number; flower: PublicTableTile })
  | (TableEventBase & {
      type: 'peng' | 'ming-gang';
      seat: number;
      fromSeat: number;
      tile: PublicTableTile;
    })
  | (TableEventBase & { type: 'an-gang'; seat: number; tile: PublicTableTile })
  | (TableEventBase & {
      type: 'bu-gang';
      seat: number;
      fromSeat: number;
      tile: PublicTableTile;
    })
  | (TableEventBase & {
      type: 'hu';
      winnerSeats: number[];
      fromSeat: number | null;
      responsibleSeat?: number;
      summary: string;
    })
  | (TableEventBase & { type: 'draw'; summary: string })
  | (TableEventBase & {
      type: 'score-changed';
      changes: TableScoreChange[];
      reason: string;
    })
  | (TableEventBase & {
      type: 'hand-settled';
      result: 'hu' | 'draw';
      winnerSeats: number[];
      changes: TableScoreChange[];
      summary: string;
    });
export interface RoomView {
  ruleSetId: RoomRuleSetId;
  totalEffectiveDealerTurns: number;
  id: string;
  revision: number;
  self: number;
  host: number;
  status: 'waiting' | 'playing' | 'completed' | 'ended';
  paused: boolean;
  players: (PlayerGameView | null)[];
  hand: number;
  effectiveTurn: number;
  dealer: number;
  current: number | null;
  remaining: number;
  phase: string;
  /** Public trigger only; never includes responder identities or private choices. */
  responseWindow?: { source: 'discard' | 'bu-gang'; actorSeat: number };
  actions: AvailableActions;
  scores: PublicScoreLine[];
  tableEvents: TableEvent[];
  result: string | null;
  nextHandSeconds: number | null;
  nextHandReady?: number[];
  nextHandToken?: string;
  lastDiscard?: TileView;
}
export interface RoomCommand {
  ruleSetId?: RoomRuleSetId;
  commandId: string;
  roomId?: string;
  name?: string;
  ready?: boolean;
  token?: string;
}
export interface CommandAck {
  commandId: string;
  ok: boolean;
  roomId?: string;
  revision?: number;
  error?: { code: string; message: string };
}
export type RoomEvent =
  | 'room:create'
  | 'room:join'
  | 'room:leave'
  | 'room:ready'
  | 'room:start'
  | 'room:end'
  | 'room:rematch'
  | 'room:next-ready'
  | 'game:action';
