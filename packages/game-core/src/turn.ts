export function nextSeatIndex(currentPlayerIndex: number, playerCount = 4): number {
  return (currentPlayerIndex + 1) % playerCount;
}
