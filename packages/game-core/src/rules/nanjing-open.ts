import type { ReactionResponseType } from '../actions';
import type {
  GameState,
  MahjongTile,
  OrdinaryHandTile,
  ReactionAvailability,
  ReactionWindow,
} from '../state';
import type { RuleSet } from './RuleSet';

export const NANJING_OPEN_RULE_SET: RuleSet = {
  id: 'nanjing-open',
  displayName: '\u5357\u4eac\u9ebb\u5c06\u657e\u5f00\u5934',
  totalEffectiveDealerTurns: 16,
  validateAction: () => true,
  applyAction: (state) => state,
  getAvailableReactions: getNanjingOpenAvailableReactions,
};

function getNanjingOpenAvailableReactions(
  state: GameState,
  reactionWindow: ReactionWindow,
): ReactionAvailability[] {
  return reactionWindow.responderOrder.map((responder) => {
    const player = state.players[responder.playerIndex];

    if (!player) {
      throw new Error(`Invalid reaction responder index ${responder.playerIndex}`);
    }

    const responseTypes: ReactionResponseType[] = ['pass'];

    if (isOrdinaryHandTile(reactionWindow.discardedTile)) {
      const discardedTile = reactionWindow.discardedTile;
      const matchingTileCount = player.hand.filter((tile) =>
        isSameOrdinaryTileFace(tile, discardedTile),
      ).length;

      if (matchingTileCount >= 2) {
        responseTypes.push('peng');
      }

      if (matchingTileCount >= 3) {
        responseTypes.push('ming-gang');
      }
    }

    return {
      playerIndex: responder.playerIndex,
      seat: responder.seat,
      responseTypes,
    };
  });
}

function isOrdinaryHandTile(tile: MahjongTile): tile is OrdinaryHandTile {
  return tile.category === 'number' || tile.category === 'wind';
}

function isSameOrdinaryTileFace(left: OrdinaryHandTile, right: OrdinaryHandTile): boolean {
  if (left.category === 'number' && right.category === 'number') {
    return left.suit === right.suit && left.rank === right.rank;
  }

  if (left.category === 'wind' && right.category === 'wind') {
    return left.wind === right.wind;
  }

  return false;
}
