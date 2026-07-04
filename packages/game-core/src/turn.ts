import { SEATS } from './player';

export function nextSeatIndex(currentPlayerIndex: number): number {
  return (currentPlayerIndex + 1) % SEATS.length;
}
