import type { Meld } from './meld.js';
import type { FlowerTile, OrdinaryHandTile } from './state.js';

export interface DiscardRecord {
  readonly tile: OrdinaryHandTile;
  readonly claimedByMeldId?: string;
}

export interface BuGangDrawProvenance {
  readonly targetMeldId: string;
  readonly tileId: OrdinaryHandTile['id'];
}

export const SEATS = ['east', 'south', 'west', 'north'] as const;
export type Seat = (typeof SEATS)[number];

export interface PlayerState {
  readonly id: number;
  readonly seat: Seat;
  readonly hand: readonly OrdinaryHandTile[];
  readonly flowers: readonly FlowerTile[];
  readonly melds: readonly Meld[];
  readonly discardPile: readonly DiscardRecord[];
  readonly isDealer: boolean;
  readonly passHu: boolean;
  readonly buGangDrawProvenance: readonly BuGangDrawProvenance[];
}

export function createInitialPlayers(dealerIndex = 0, playerCount = 4): PlayerState[] {
  if ((playerCount !== 2 && playerCount !== 4) || dealerIndex < 0 || dealerIndex >= playerCount)
    throw new Error('Invalid player count or dealer');
  return SEATS.slice(0, playerCount).map((seat, index): PlayerState => ({
    id: index,
    seat,
    hand: [],
    flowers: [],
    melds: [],
    discardPile: [],
    isDealer: index === dealerIndex,
    passHu: false,
    buGangDrawProvenance: [],
  }));
}

export function copyPlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.map((player) => ({
    ...player,
    hand: [...player.hand],
    flowers: [...player.flowers],
    melds: [...player.melds],
    discardPile: [...player.discardPile],
    buGangDrawProvenance: [...player.buGangDrawProvenance],
  }));
}
