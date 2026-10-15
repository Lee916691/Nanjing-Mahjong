export interface HealthResponse {
  status: 'ok';
}

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
  flowers: TileView[];
  melds: { kind: string; tiles: TileView[]; claimedTileId?: string; fromSeat?: number }[];
  discards: TileView[];
  diHu: boolean;
  score: number;
  rack?: TileView;
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
export interface RoomView {
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
  actions: AvailableActions;
  scores: ScoreLine[];
  result: string | null;
  nextHandSeconds: number | null;
  nextHandReady?: number[];
  nextHandToken?: string;
  lastDiscard?: TileView;
}
export interface RoomCommand {
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
