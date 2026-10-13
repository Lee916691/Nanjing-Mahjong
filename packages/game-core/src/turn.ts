import { SEATS } from './player.js';

export function nextSeatIndex(currentPlayerIndex: number): number {
  return (currentPlayerIndex + 1) % SEATS.length;
}
