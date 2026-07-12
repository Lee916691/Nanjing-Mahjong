import type { OrdinaryHandTile, TileId } from './state';

export type MeldType = 'peng' | 'ming-gang' | 'an-gang' | 'bu-gang';

export interface Meld {
  readonly id: string;
  readonly type: MeldType;
  readonly tiles: readonly OrdinaryHandTile[];
  readonly claimedTileId?: TileId;
  readonly fromPlayerIndex?: number;
}
