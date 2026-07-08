import type { FlowerTile, OrdinaryHandTile } from './state';

export const SEATS = ['east', 'south', 'west', 'north'] as const;
export type Seat = (typeof SEATS)[number];

export interface PlayerState {
  readonly id: number;
  readonly seat: Seat;
  readonly hand: readonly OrdinaryHandTile[];
  readonly flowers: readonly FlowerTile[];
  readonly discardPile: readonly OrdinaryHandTile[];
  readonly isDealer: boolean;
}

export function createInitialPlayers(dealerIndex = 0): PlayerState[] {
  return SEATS.map((seat, index): PlayerState => ({
    id: index,
    seat,
    hand: [],
    flowers: [],
    discardPile: [],
    isDealer: index === dealerIndex,
  }));
}

export function copyPlayers(players: readonly PlayerState[]): PlayerState[] {
  return players.map((player) => ({
    ...player,
    hand: [...player.hand],
    flowers: [...player.flowers],
    discardPile: [...player.discardPile],
  }));
}
