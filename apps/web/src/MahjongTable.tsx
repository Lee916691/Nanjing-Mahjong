import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ActionChoice, PlayerGameView, RoomView } from '@nanjing-mahjong/shared-types';
import { MahjongTile } from './MahjongTile';
import { ScoreDetails } from './ScoreDetails';

const winds = ['东', '南', '西', '北'];
const meldNames: Record<string, string> = {
  peng: '碰',
  'ming-gang': '明杠',
  'an-gang': '暗杠',
  'bu-gang': '补杠',
};
function Meld({
  meld,
  seat,
  matching,
}: {
  meld: PlayerGameView['melds'][number];
  seat: number;
  matching: string | null;
}) {
  const claimed = meld.tiles.find((t) => t.id === meld.claimedTileId);
  const other = meld.tiles.filter((t) => t.id !== meld.claimedTileId);
  const from = meld.fromSeat === undefined ? 0 : (meld.fromSeat - seat + 4) % 4;
  const claimPosition = from === 3 ? 0 : from === 2 ? 1 : 2;
  const upgrade = meld.kind === 'bu-gang' && claimed ? other.pop() : undefined;
  const content = other.map((t) => ({ tile: t, called: false }));
  if (claimed)
    content.splice(Math.min(claimPosition, content.length), 0, { tile: claimed, called: true });
  return (
    <div className="meld" aria-label={meldNames[meld.kind] ?? meld.kind}>
      {content.map(({ tile, called }) => (
        <span className={called ? 'meld-slot called' : 'meld-slot'} key={tile.id}>
          <MahjongTile tile={tile} small highlight={matching === tile.label} />
          {called && upgrade && (
            <span className="added-kong">
              <MahjongTile tile={upgrade} small highlight={matching === upgrade.label} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
function PlayerOpen({
  player,
  self,
  matching,
}: {
  player: PlayerGameView;
  self: boolean;
  matching: string | null;
}) {
  return (
    <div className="player-open" aria-label={`${player.name}的公开牌区`}>
      <div className="owned-flowers">
        <span className="owned-label">
          {self ? '我的' : player.name} · 花牌 <b>{player.flowers.length}</b>
        </span>
        <div className="flower-tiles">
          {player.flowers.length ? (
            player.flowers.map((tile) => <MahjongTile key={tile.id} tile={tile} small />)
          ) : (
            <span className="open-empty">暂无花牌</span>
          )}
        </div>
      </div>
      <div className="owned-melds">
        <span className="owned-label">{self ? '我的' : player.name} · 碰 / 杠</span>
        <div className="meld-zone">
          {player.melds.length ? (
            player.melds.map((meld, i) => (
              <Meld key={i} meld={meld} seat={player.seat} matching={matching} />
            ))
          ) : (
            <span className="open-empty">暂无副露</span>
          )}
        </div>
      </div>
      {player.rack && (
        <div className="rack-marker">
          <span>架牌</span>
          <MahjongTile tile={player.rack} small />
        </div>
      )}
    </div>
  );
}
function PlayerBadge({
  player,
  relative,
  dealer,
  active,
  self,
}: {
  player: PlayerGameView;
  relative: number;
  dealer: boolean;
  active: boolean;
  self: boolean;
}) {
  return (
    <article
      className={`player-badge badge--${relative} ${active ? 'active' : ''} ${!player.connected ? 'offline' : ''}`}
      aria-label={`${player.name}，${winds[player.seat]}位，${player.score}分`}
    >
      <div className="player-avatar" aria-hidden="true">
        {player.name.slice(0, 1)}
        <i className={player.connected ? 'presence online' : 'presence'} />
      </div>
      <div className="player-identity">
        <strong title={player.name}>
          {player.name}
          {self && <small>你</small>}
        </strong>
        <div className="player-tags">
          <span>{winds[player.seat]}位</span>
          {dealer && <em>庄</em>}
          {player.diHu && <em>地胡</em>}
          <span>{!player.connected ? '离线' : active ? '行动中' : '在线'}</span>
          {!self && <span>{player.handCount}张</span>}
        </div>
        <b>
          {player.score.toLocaleString()}
          <small>分</small>
        </b>
      </div>
    </article>
  );
}
export function MahjongTable({
  room,
  connected,
  pending,
  onAction,
  readable,
  onRoomOptions,
  onNextHand,
}: {
  room: RoomView;
  connected: boolean;
  pending: boolean;
  onAction: (choice: ActionChoice) => void;
  readable: (value: string) => string;
  onRoomOptions?: () => void;
  onNextHand?: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [hideResult, setHideResult] = useState(false);
  const [fullScreenError, setFullScreenError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === viewport.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(entry.contentRect.width / 1280, entry.contentRect.height / 760));
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  const self = room.players[room.self];
  const hand = self?.hand ?? [];
  const drawn = hand.find((t) => t.id === self?.drawnTileId);
  const sortedHand = drawn ? [...hand.filter((t) => t.id !== drawn.id), drawn] : hand;
  const matching = hovered ?? hand.find((t) => t.id === selected)?.label ?? null;
  const enabled = connected && !pending && !room.paused && !room.result;
  const discard = room.actions.choices.find((a) => a.kind === 'discard' && a.tileId === selected);
  const canDiscard = room.actions.choices.some((a) => a.kind === 'discard');
  const act = (choice: ActionChoice) => {
    setSelected('');
    setHovered(null);
    onAction(choice);
  };
  const phase = room.paused
    ? '等待重连'
    : !connected
      ? '正在重连'
      : (room.result ??
        (room.phase === 'waiting-for-reaction'
          ? '等待碰 · 杠 · 胡响应'
          : room.phase === 'waiting-for-di-hu-decision'
            ? '开局确认中'
            : room.current === room.self
              ? '轮到你出牌'
              : `等待 ${room.players[room.current ?? 0]?.name ?? '玩家'}`));
  const handScores = room.scores.filter((s) => s.hand === room.hand);
  async function fullScreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewport.current?.requestFullscreen();
    } catch {
      setFullScreenError('浏览器暂不支持全屏，可使用 F11 放大牌桌');
    }
  }
  return (
    <section className="table" aria-label="麻将桌" ref={viewport}>
      <div className="table-stage" style={{ '--table-scale': scale } as CSSProperties}>
        <div className="table-trim" aria-hidden="true" />
        <div className="table-emblem" aria-hidden="true">
          南京
        </div>
        <div className="table-tools">
          <button onClick={() => setHelp(!help)} aria-expanded={help}>
            牌面说明
          </button>
          {onRoomOptions && (
            <button
              onClick={() => {
                if (document.fullscreenElement) {
                  void document
                    .exitFullscreen()
                    .then(onRoomOptions)
                    .catch(() => setFullScreenError('请先退出全屏，再打开房间选项'));
                } else onRoomOptions();
              }}
            >
              房间选项
            </button>
          )}
          <button onClick={() => void fullScreen()}>{isFullscreen ? '退出全屏' : '全屏'}</button>
        </div>
        <div className="table-edition">
          金陵好友局 <span>NANJING MAHJONG</span>
        </div>
        {room.players.map((player, seat) => {
          if (!player) return null;
          const relative = (seat - room.self + 4) % 4;
          const active =
            !room.paused &&
            !room.result &&
            (room.current === seat || (seat === room.self && room.actions.choices.length > 0));
          return (
            <div key={seat} className={`seat-region seat-region--${relative}`}>
              <PlayerBadge
                player={player}
                relative={relative}
                dealer={seat === room.dealer}
                active={active}
                self={seat === room.self}
              />
              {relative !== 0 && (
                <div className={`opponent-station station--${relative}`} data-owner={seat}>
                  <PlayerOpen player={player} self={false} matching={matching} />
                  <div
                    className="opponent-hand"
                    aria-label={`${player.name}的暗手，共${player.handCount}张`}
                  >
                    {Array.from({ length: player.handCount }, (_, n) => (
                      <span className="tile-back" key={n} aria-hidden="true" />
                    ))}
                  </div>
                </div>
              )}
              {relative === 0 && (
                <div className="self-open" data-owner={seat}>
                  <PlayerOpen player={player} self matching={matching} />
                </div>
              )}
              <div
                className={`river river--${relative}`}
                data-relative={relative}
                aria-label={`${player.name}的弃牌`}
              >
                <div className="discard-grid">
                  {player.discards.map((tile) => (
                    <MahjongTile
                      key={tile.id}
                      tile={tile}
                      small
                      highlight={matching === tile.label}
                      latest={tile.id === room.lastDiscard?.id}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div
          className="table-center"
          aria-label={`第${room.hand}手，第${room.effectiveTurn}有效庄次，余${room.remaining}张`}
        >
          {room.players.map(
            (player, seat) =>
              player && (
                <div
                  key={seat}
                  className={`compass compass--${(seat - room.self + 4) % 4} ${room.current === seat && !room.paused && !room.result ? 'active' : ''}`}
                >
                  {winds[seat]}
                  {seat === room.dealer && <i />}
                </div>
              ),
          )}
          <span className="round-label">
            第 {Math.ceil(room.effectiveTurn / 4)} 圈 · 第 {((room.effectiveTurn - 1) % 4) + 1} 庄
          </span>
          <strong className="remaining-tiles">
            {room.remaining}
            <small>余牌</small>
          </strong>
          <span className="hand-index">
            第 {room.hand} 手 <i /> 敞开头
          </span>
          <div className="round-progress">
            <span style={{ width: `${(room.effectiveTurn / 16) * 100}%` }} />
          </div>
        </div>
        <div className={`turn-banner ${canDiscard ? 'your-turn' : ''}`} role="status">
          <i />
          {phase}
        </div>
        {room.lastDiscard && (
          <div className="last-discard-note">
            最新弃牌 <b>{room.lastDiscard.label}</b>
            <span>金框标记</span>
          </div>
        )}
        <div className="hand-area">
          <div className="hand" aria-label="你的手牌">
            {sortedHand.map((tile) => (
              <MahjongTile
                key={tile.id}
                tile={tile}
                selected={selected === tile.id}
                drawn={tile.id === drawn?.id}
                onClick={() => setSelected(selected === tile.id ? '' : tile.id)}
                onHover={setHovered}
                disabled={!enabled || !room.actions.choices.some((a) => a.tileId === tile.id)}
              />
            ))}
          </div>
        </div>
        <div className="action-bar">
          <span className="action-hint">
            {pending
              ? '正在确认…'
              : room.paused
                ? '座位与牌局已保留'
                : room.actions.choices.length
                  ? canDiscard
                    ? '请选出一张手牌'
                    : '请选择响应操作'
                  : '等待其他玩家'}
          </span>
          {canDiscard && (
            <button
              className="primary discard-action"
              disabled={!enabled || !discard}
              onClick={() => discard && act(discard)}
            >
              出牌
            </button>
          )}
          {room.actions.choices
            .filter((a) => a.kind !== 'discard')
            .map((choice) => (
              <button
                key={choice.token}
                className={`reaction-action ${choice.kind === 'hu' ? 'win-action' : choice.kind === 'pass' ? 'pass-action' : ''}`}
                disabled={!enabled}
                onClick={() => act(choice)}
              >
                {choice.label}
              </button>
            ))}
        </div>
        {room.result && !hideResult && (
          <div className="hand-result" role="dialog" aria-labelledby="hand-result-title">
            <span className="result-eyebrow">第 {room.hand} 手 · 结算</span>
            <h2 id="hand-result-title">{room.result}</h2>
            <div className="hand-deltas">
              {room.players.map((player, seat) => {
                if (!player) return null;
                const delta = handScores.reduce(
                  (sum, score) =>
                    sum +
                    score.transfers.reduce(
                      (total, t) =>
                        total + (t.to === seat ? t.amount : 0) - (t.from === seat ? t.amount : 0),
                      0,
                    ),
                  0,
                );
                return (
                  <div key={seat}>
                    <span>{player.name}</span>
                    <strong className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>
                      {delta > 0 ? '+' : ''}
                      {delta}
                    </strong>
                    <small>{player.score} 分</small>
                  </div>
                );
              })}
            </div>
            <div className="hand-transfers">
              {handScores.map((score, i) => (
                <ScoreDetails key={i} score={score} players={room.players} readable={readable} />
              ))}
            </div>
            <div className="result-bottom">
              <span>
                {room.paused ? '重连后继续' : `${room.nextHandSeconds ?? 0} 秒后开始下一手`}
              </span>
              <button
                className="primary"
                disabled={
                  !connected ||
                  pending ||
                  room.paused ||
                  room.nextHandReady?.includes(room.self) ||
                  !room.nextHandToken
                }
                onClick={onNextHand}
              >
                {room.nextHandReady?.includes(room.self) ? '已准备' : '开始下一把'} ·{' '}
                {room.nextHandReady?.length ?? 0}/4
              </button>
              <button onClick={() => setHideResult(true)}>查看牌桌</button>
            </div>
          </div>
        )}
        {room.result && hideResult && (
          <button className="reopen-result" onClick={() => setHideResult(false)}>
            查看本局结算 · {room.nextHandSeconds ?? 0}s
          </button>
        )}
        {help && (
          <div className="tile-help" role="dialog" aria-label="牌面说明">
            <button className="help-close" onClick={() => setHelp(false)} aria-label="关闭牌面说明">
              ×
            </button>
            <h3>认牌，一眼分明</h3>
            <p>万字、筒点、竹条分别对应万、筒、条。一条以鸟形表示。</p>
            <div className="tile-catalog">
              {(['wan', 'tong', 'tiao'] as const).map((family) => (
                <div className="catalog-row" key={family}>
                  <span>{{ wan: '万', tong: '筒', tiao: '条' }[family]}</span>
                  <div>
                    {Array.from({ length: 9 }, (_, i) => ({
                      id: `${family}-${i + 1}-1`,
                      label: `${i + 1}${{ wan: '万', tong: '筒', tiao: '条' }[family]}`,
                      family,
                    })).map((tile) => (
                      <MahjongTile key={tile.id} tile={tile} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="catalog-row">
                <span>字</span>
                <div>
                  {['东', '南', '西', '北', '中', '发', '白'].map((label, i) => (
                    <MahjongTile
                      key={label}
                      tile={{ id: `catalog-${i}`, label, family: i < 4 ? 'wind' : 'flower' }}
                    />
                  ))}
                </div>
              </div>
              <div className="catalog-row">
                <span>花</span>
                <div>
                  {['梅', '兰', '竹', '菊', '春', '夏', '秋', '冬'].map((label, i) => (
                    <MahjongTile
                      key={label}
                      tile={{ id: `flower-catalog-${i}`, label, family: 'flower' }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p>
              南京敞开头中，<b>中、发、白均作花牌</b>
              ，会放入各家的花牌区。金框表示最新弃牌，横置牌表示碰杠的来源。
            </p>
          </div>
        )}
        {fullScreenError && (
          <div className="fullscreen-error" role="status">
            {fullScreenError}
            <button onClick={() => setFullScreenError('')}>知道了</button>
          </div>
        )}
      </div>
    </section>
  );
}
