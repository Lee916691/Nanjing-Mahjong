import type { PublicTableTile, TileView } from '@nanjing-mahjong/shared-types';
import { tileGlyphs } from './assets/tile-glyphs';
import { bambooGlyphs } from './assets/bamboo-glyphs';
import { classicGlyphs } from './assets/classic-glyphs';

const ink = { navy: '#294657', jade: '#246a4b', red: '#ad453c' };
function Face({ tile }: { tile: PublicTableTile }) {
  const rank = Number(/^([1-9])[万条筒]$/.exec(tile.label)?.[1] ?? 0);
  const family = tile.family;
  const artwork: Partial<Record<keyof typeof ink, string>> | undefined =
    family === 'tiao' && rank
      ? bambooGlyphs[rank]
      : classicGlyphs[rank ? `${family}-${rank}` : tile.label];
  const fallback = tileGlyphs[tile.label === '将' ? '將' : tile.label];
  return (
    <svg viewBox="0 0 100 136" className="tile-face" aria-hidden="true" focusable="false">
      {artwork ? (
        (Object.keys(ink) as (keyof typeof ink)[]).map((color) =>
          color in artwork ? <path key={color} d={artwork[color]} fill={ink[color]} /> : null,
        )
      ) : fallback ? (
        <svg x="11" y="29" width="78" height="78" viewBox="0 0 100 100">
          <path d={fallback} fill={ink.navy} />
        </svg>
      ) : (
        <text x="50" y="90" textAnchor="middle" fontSize="60" fill={ink.navy}>
          {tile.label}
        </text>
      )}
    </svg>
  );
}
export function MahjongTile({
  tile,
  small = false,
  selected = false,
  highlight = false,
  latest = false,
  drawn = false,
  onClick,
  onHover,
  disabled = false,
  feedbackId,
}: {
  tile: PublicTableTile | TileView;
  small?: boolean;
  selected?: boolean;
  highlight?: boolean;
  latest?: boolean;
  drawn?: boolean;
  onClick?: () => void;
  onHover?: (label: string | null) => void;
  disabled?: boolean;
  feedbackId?: number;
}) {
  const className = [
    'tile',
    small ? 'small' : '',
    selected ? 'selected' : '',
    highlight ? 'matching' : '',
    latest ? 'latest' : '',
    drawn ? 'drawn' : '',
    feedbackId === undefined ? '' : 'feedback-target',
    tile.family,
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <Face tile={tile} />
      {drawn && <span className="draw-label">摸入</span>}
    </>
  );
  if (!onClick)
    return (
      <span
        className={className}
        role="img"
        aria-label={tile.label}
        title={tile.label}
        data-face={tile.label}
        data-feedback-id={feedbackId}
      >
        {content}
      </span>
    );
  return (
    <button
      type="button"
      className={className}
      aria-label={tile.label}
      aria-pressed={selected}
      disabled={disabled}
      data-face={tile.label}
      onClick={onClick}
      onPointerEnter={() => onHover?.(tile.label)}
      onPointerLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(tile.label)}
      onBlur={() => onHover?.(null)}
      title={`选择${tile.label}`}
    >
      {content}
    </button>
  );
}
