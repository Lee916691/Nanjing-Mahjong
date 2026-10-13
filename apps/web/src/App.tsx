import { useEffect, useRef, useState } from 'react';
import { io } from './cloud-socket';
import type { CloudSocket as Socket } from './cloud-socket';
import type { RoomView, RoomEvent, RoomCommand, CommandAck } from '@nanjing-mahjong/shared-types';

import { MahjongTile as Tile } from './MahjongTile';
import { MahjongTable } from './MahjongTable';
import { ScoreDetails } from './ScoreDetails';

const seats = ['东', '南', '西', '北'];
const labels: Record<string, string> = {
  'men-qing': '门清',
  'all-pungs': '对对胡',
  'global-single-wait': '全球独钓',
  'mixed-one-suit': '混一色',
  'pure-one-suit': '清一色',
  'seven-pairs': '七对',
  'dragon-seven-pairs': '龙七对',
  'no-flower': '无花果',
  'pressure-absolute': '压绝',
  'di-hu': '地胡',
  'tian-hu': '天胡',
  'hua-kai': '花开',
  'gang-kai': '杠开',
  'an-gang-created': '暗杠',
  'ming-gang-created': '明杠',
  'bu-gang-created': '补杠',
  'flower-kong-created': '花杠',
  'follow-discard': '跟打一圈',
  'four-identical-discards': '同牌四打',
  'four-winds-gathered': '四风归齐',
  'package-resolved': '包子结算',
  'three-mouth': '三嘴包子',
  'three-pure': '三清包子',
  global: '全球包子',
  discard: '点炮',
  'self-draw': '自摸',
  'rob-bu-gang': '抢补杠胡',
};
function readable(value: string) {
  return value
    .split('、')
    .map((v) => labels[v] ?? v)
    .join(' · ');
}
let sessionRequest: Promise<{ roomId: string | null }> | undefined;
function openSession() {
  sessionRequest ??= fetch('/api/session', { method: 'POST' }).then(async (response) => {
    if (!response.ok) throw new Error('无法建立会话');
    return (await response.json()) as { roomId: string | null };
  });
  return sessionRequest;
}
export function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('mj_name') ?? '');
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get('room') ?? '',
  );
  const [page, setPage] = useState<'create' | 'join' | 'guide'>(() =>
    new URLSearchParams(location.search).has('room') ? 'join' : 'create',
  );
  const [customCode, setCustomCode] = useState('');
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [roomOptions, setRoomOptions] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [away, setAway] = useState(() => sessionStorage.getItem('mj_away') === '1');
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<RoomView | null>(null);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState<{ event: RoomEvent; cmd: RoomCommand } | null>(null);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    let disposed = false;
    let socket: Socket | undefined;
    void openSession()
      .then((data) => {
        if (disposed) return;
        if (data.roomId) {
          setRoomId(data.roomId);
          history.replaceState(null, '', `?room=${data.roomId}`);
        }
        socket = io({ autoConnect: false });
        socketRef.current = socket;
        socket.on('connect', () => {
          setConnected(true);
          setMessage('');
        });
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', () => setMessage('连接失败，正在重试；请确认游戏服务已启动'));
        socket.on('session:replaced', () => {
          socket?.disconnect();
          setMessage('你的座位已在另一页面打开。关闭另一页面后刷新可接管。');
        });
        socket.on('room:state', (value: RoomView) => {
          roomRef.current = value;
          setRoom(value);
          setRoomId(value.id);
          history.replaceState(null, '', `?room=${value.id}`);
        });
        socket.on('room:expired', () =>
          setMessage('房间已因 30 分钟无操作自动解散，可以创建或加入新房间。'),
        );
        socket.on('room:left', () => {
          roomRef.current = null;
          setRoom(null);
          setAway(false);
          sessionStorage.removeItem('mj_away');
          setRoomId('');
          history.replaceState(null, '', location.pathname);
        });
        if (sessionStorage.getItem('mj_away') !== '1' || !data.roomId) {
          sessionStorage.removeItem('mj_away');
          setAway(false);
          socket.connect();
        }
      })
      .catch(() => setMessage('服务连接失败，请刷新页面重试'));
    return () => {
      disposed = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);
  function transmit(event: RoomEvent, cmd: RoomCommand) {
    if (inFlight.current || !connected) return;
    inFlight.current = true;
    setPending(true);
    setMessage('');
    setRetry(null);
    socketRef.current?.timeout(6000).emit(event, cmd, (error: Error | null, ack?: CommandAck) => {
      inFlight.current = false;
      setPending(false);
      if (error || !ack) {
        setMessage('尚未收到确认。请重试同一操作，系统会避免重复处理。');
        setRetry({ event, cmd });
        return;
      }
      if (!ack.ok) {
        setMessage(ack.error?.message ?? '操作失败');
        return;
      }
      if (event === 'room:leave' && roomRef.current?.status === 'playing') {
        sessionStorage.setItem('mj_away', '1');
        setAway(true);
        setMessage('');
        history.replaceState(null, '', location.pathname);
      }
      if (event === 'room:create' || event === 'room:join')
        localStorage.setItem('mj_name', name.trim());
    });
  }
  function command(event: RoomEvent, extra: Partial<RoomCommand> = {}) {
    transmit(event, {
      commandId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join(''),
      roomId: roomRef.current?.id ?? (roomId || undefined),
      ...extra,
    });
  }
  const me = room?.players[room.self];
  const enabled = connected && !pending && !room?.paused;
  const finished = room?.status === 'completed' || room?.status === 'ended';
  async function share() {
    const url = new URL(location.href);
    url.search = `?room=${room!.id}`;
    try {
      await navigator.clipboard.writeText(url.href);
      setMessage('邀请链接已复制');
    } catch {
      setMessage('请复制地址栏中的房间链接发给朋友');
    }
  }
  return (
    <main className={room?.status === 'playing' && !away ? 'game-shell' : 'shell'}>
      <header className="header">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            if (room) e.preventDefault();
          }}
        >
          <span className="brand-mark">南</span>
          <span>
            南京麻将<small>敞开头 · 好友局</small>
          </span>
        </a>
        {!room && (
          <nav className="lobby-nav" aria-label="大厅导航">
            {(
              [
                ['create', '创建房间'],
                ['join', '加入房间'],
                ['guide', '玩法指南'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-current={page === key ? 'page' : undefined}
                onClick={() => {
                  setPage(key);
                  setMessage('');
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        <span className={connected ? 'connection online' : 'connection'}>
          {away ? '已暂离牌桌' : connected ? '已连接' : '连接中 / 已离线'}
        </span>
      </header>
      {message && (
        <div className="notice" role="status">
          {message}
          {retry && (
            <button
              disabled={!connected || pending}
              onClick={() => transmit(retry.event, retry.cmd)}
            >
              重试操作
            </button>
          )}
        </div>
      )}
      {away ? (
        <section className="away-panel">
          <span className="eyebrow">好友大厅 · 座位已保留</span>
          <h1>歇一会，牌桌等你。</h1>
          <p>
            你已暂离房间 <strong>{roomId}</strong>。牌局暂停，已结算分数和手牌保留。
          </p>
          <p>返回原房间后可继续。如果不想再打，可提前结束本将，再退出房间或创建新房间。</p>
          <button
            className="primary"
            onClick={() => {
              sessionStorage.removeItem('mj_away');
              setAway(false);
              setMessage('');
              socketRef.current?.connect();
            }}
          >
            返回原房间
          </button>
        </section>
      ) : !room && page === 'guide' ? (
        <section className="guide-panel">
          <span className="eyebrow">好友局指南</span>
          <h1>落座之前，先聊两句。</h1>
          <div className="guide-grid">
            <article>
              <b>01 · 约朋友</b>
              <h2>一个号码，一张牌桌</h2>
              <p>
                创建房间后发送邀请链接，或让朋友输入房间号加入。自定义号码为 6～12
                位数字，已使用的号码无法重复创建。
              </p>
            </article>
            <article>
              <b>02 · 开一将</b>
              <h2>四人准备，房主开局</h2>
              <p>
                南京敞开头 V1.0.8。每人从 1000 分开始，一将按 16
                个有效庄次推进；连庄时手数与庄次不同。
              </p>
            </article>
            <article>
              <b>03 · 看结算</b>
              <h2>胡什么，怎么算，都清楚</h2>
              <p>
                胡牌结算展示获胜牌面、胡张与逐项计分。单局结算保留 45
                秒，付款关系可在结算明细中回看。
              </p>
            </article>
            <article>
              <b>04 · 安心续局</b>
              <h2>断线等你，不替你出牌</h2>
              <p>
                掉线时全桌暂停，用原浏览器回来继续。不要清除浏览器数据；同一浏览器的另一个页面会接管座位。
              </p>
            </article>
          </div>
          <button className="primary" onClick={() => setPage('create')}>
            去创建房间
          </button>
        </section>
      ) : !room ? (
        <section className="landing">
          <div className="intro">
            <span className="eyebrow">一张牌桌，四位老友</span>
            <h1>
              凑齐四人，
              <br />
              开一将。
            </h1>
            <p>
              熟悉的南京敞开头。发个链接，就能坐在一起。
              <br />
              无须注册，记分、补花与结算交给牌桌。
            </p>
            <div className="sample-tiles">
              {[
                { id: 'a', label: '南', family: 'wind' },
                { id: 'b', label: '京', family: 'wind' },
                { id: 'c', label: '麻', family: 'wan' },
                { id: 'd', label: '将', family: 'wan' },
              ].map((t) => (
                <Tile key={t.id} tile={t} />
              ))}
            </div>
            <div className="features">
              <span>四人好友房</span>
              <span>完整 16 庄次</span>
              <span>掉线可续局</span>
            </div>
          </div>
          <form
            className="entry-card"
            onSubmit={(e) => {
              e.preventDefault();
              command(page === 'join' ? 'room:join' : 'room:create', {
                name,
                roomId: (page === 'join' ? roomId.trim() : customCode.trim()) || undefined,
              });
            }}
          >
            <span className="eyebrow">{page === 'join' ? '朋友正在等你' : '准备入座'}</span>
            <h2>{page === 'join' ? '加入好友房间' : '创建一张牌桌'}</h2>
            <label htmlFor="name">你的昵称</label>
            <input
              id="name"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="朋友们怎么称呼你？"
              autoComplete="nickname"
            />
            <label htmlFor="room-code">{page === 'join' ? '房间号' : '自定义房间号（可选）'}</label>
            <input
              id="room-code"
              value={page === 'join' ? roomId : customCode}
              onChange={(e) =>
                page === 'join' ? setRoomId(e.target.value) : setCustomCode(e.target.value)
              }
              maxLength={12}
              minLength={6}
              pattern={page === 'join' ? '[A-Za-z0-9_-]{6,12}' : '[0-9]{6,12}'}
              required={page === 'join'}
              inputMode={page === 'join' ? 'text' : 'numeric'}
              placeholder={page === 'join' ? '输入好友分享的房间号' : '6～12 位数字，留空自动生成'}
              autoComplete="off"
            />
            <p className="entry-hint">
              {page === 'join'
                ? '旧房间号区分大小写，请完整输入。'
                : '选个好记的号码，和朋友约好就入座。'}
            </p>
            <button className="primary" disabled={!connected || pending || !name.trim()}>
              {pending ? '正在入座…' : page === 'join' ? '加入房间' : '创建房间'}
            </button>
            <p className="muted">
              电脑浏览器体验最佳。同一浏览器刷新可恢复座位。复制房间链接即可邀请朋友。
            </p>
          </form>
        </section>
      ) : (
        <>
          <section className="room-bar">
            <div>
              <span className="eyebrow">好友房 · {room.id}</span>
              <h2>
                {room.status === 'waiting'
                  ? '等朋友，开好局'
                  : finished
                    ? room.status === 'ended'
                      ? '本将已提前结束'
                      : '一将圆满结束'
                    : `第 ${room.hand} 手 · 第 ${room.effectiveTurn} / 16 有效庄次`}
              </h2>
            </div>
            <div className="buttons">
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(room.id).then(
                    () => setMessage('房间号已复制'),
                    () => setMessage('房间号：' + room.id),
                  )
                }
              >
                复制房间号
              </button>
              <button onClick={() => void share()}>复制邀请链接</button>
              <button className="room-options-trigger" onClick={() => setRoomOptions(true)}>
                房间选项
              </button>
              {room.status === 'playing' && (
                <button className="quiet" onClick={() => setConfirmEnd(true)}>
                  提前结束
                </button>
              )}
              {room.status !== 'playing' && (
                <button onClick={() => command('room:leave')} disabled={!connected || pending}>
                  离开房间
                </button>
              )}
            </div>
          </section>
          {room.status === 'waiting' ? (
            <section className="waiting">
              <div className="seat-grid">
                {room.players.map((player, i) => (
                  <article className={'seat-card ' + (i === room.self ? 'you' : '')} key={i}>
                    <span className="seat-wind">{seats[i]}</span>
                    <h3>{player?.name ?? '虚位以待'}</h3>
                    <p>
                      {player
                        ? player.connected
                          ? player.ready
                            ? '已准备'
                            : '尚未准备'
                          : '暂时离线'
                        : '等待好友加入'}
                    </p>
                    <small>
                      {i === room.host ? '房主 ' : ''}
                      {i === room.self ? '你' : ''}
                    </small>
                  </article>
                ))}
              </div>
              <div className="waiting-actions">
                <button
                  className="primary"
                  disabled={!enabled}
                  onClick={() => command('room:ready', { ready: !me?.ready })}
                >
                  {me?.ready ? '取消准备' : '准备好了'}
                </button>
                {room.self === room.host && (
                  <button
                    disabled={!enabled || room.players.some((p) => !p?.connected || !p.ready)}
                    onClick={() => command('room:start')}
                  >
                    四人开局
                  </button>
                )}
              </div>
              <p className="muted centered">
                四人在线并准备后，由房主开局。开局庄家随机，分数从 1000 开始。
              </p>
            </section>
          ) : (
            <>
              {room.paused && (
                <div className="pause-banner" role="alert">
                  牌局已暂停 · 等待{' '}
                  {room.players
                    .filter((p) => p && !p.connected)
                    .map((p) => p!.name)
                    .join('、')}{' '}
                  回来，座位和牌局已保留。
                </div>
              )}
              {finished ? (
                <section className="final-panel">
                  <h2>本将积分</h2>
                  <div className="ranking">
                    {room.players
                      .filter((p) => p !== null)
                      .sort((a, b) => b.score - a.score)
                      .map((p) => (
                        <div key={p.seat}>
                          <span>
                            第 {1 + room.players.filter((o) => o && o.score > p.score).length} 名
                          </span>
                          <strong>{p.name}</strong>
                          <b>{p.score}</b>
                          <small>
                            {p.score - 1000 >= 0 ? '+' : ''}
                            {p.score - 1000}
                          </small>
                        </div>
                      ))}
                  </div>
                  {room.scores.some((score) => score.hand === room.hand) && (
                    <section className="final-hand-details">
                      <h3>最后一手计分明细</h3>
                      {room.scores
                        .filter((score) => score.hand === room.hand)
                        .map((score, i) => (
                          <ScoreDetails
                            key={i}
                            score={score}
                            players={room.players}
                            readable={readable}
                          />
                        ))}
                    </section>
                  )}
                  {room.self === room.host && (
                    <button
                      className="primary"
                      disabled={!connected || pending}
                      onClick={() => command('room:rematch')}
                    >
                      再来一将
                    </button>
                  )}
                </section>
              ) : (
                <MahjongTable
                  key={`${room.id}-${room.hand}`}
                  room={room}
                  connected={connected}
                  pending={pending}
                  onAction={(choice) => command('game:action', { token: choice.token })}
                  readable={readable}
                  onRoomOptions={() => setRoomOptions(true)}
                  onNextHand={() => command('room:next-ready', { token: room.nextHandToken })}
                />
              )}
              <details className="score-log">
                <summary>结算明细 · 最近 {room.scores.length} 项</summary>
                {[...room.scores].reverse().map((s, i) => (
                  <ScoreDetails
                    key={i}
                    score={s}
                    players={room.players}
                    readable={readable}
                    showHand
                  />
                ))}
              </details>
            </>
          )}
        </>
      )}
      {roomOptions && room && !away && (
        <div className="modal-backdrop" onClick={() => setRoomOptions(false)}>
          <section
            className="confirm room-options-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-options-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="room-options-title">房间选项</h2>
            <p>
              房间 {room.id} ·{' '}
              {room.self === room.host ? '你是房主' : '房主：' + room.players[room.host]?.name}
            </p>
            <div className="room-option-list">
              <button onClick={() => void share()}>复制邀请链接</button>
              {room.status === 'playing' && (
                <button
                  className="danger"
                  disabled={!connected || pending}
                  onClick={() => {
                    setRoomOptions(false);
                    setConfirmEnd(true);
                  }}
                >
                  提前结束本将
                </button>
              )}
              <button
                disabled={!connected || pending}
                onClick={() => {
                  setRoomOptions(false);
                  if (room.status === 'playing') setConfirmLeave(true);
                  else command('room:leave');
                }}
              >
                {room.status === 'playing' ? '暂离房间，返回大厅' : '退出房间，返回大厅'}
              </button>
              <button onClick={() => setRoomOptions(false)}>返回牌桌</button>
            </div>
            {room.status === 'playing' && (
              <p className="muted">
                暂离会保留座位并暂停牌局；房内每位玩家均可提前结束本将，已结算分数保留。30
                分钟无人操作将自动解散房间。
              </p>
            )}
          </section>
        </div>
      )}
      {confirmLeave && (
        <div className="modal-backdrop">
          <section
            className="confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-title"
          >
            <h2 id="leave-title">暂离房间？</h2>
            <p>你将返回大厅，座位和牌局保留。其他三位玩家需要等待你回来，或提前结束本将。</p>
            <div className="buttons">
              <button onClick={() => setConfirmLeave(false)}>继续打牌</button>
              <button
                disabled={!connected || pending}
                onClick={() => {
                  command('room:leave');
                  setConfirmLeave(false);
                }}
              >
                确认暂离
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmEnd && (
        <div className="modal-backdrop">
          <section className="confirm" role="dialog" aria-modal="true" aria-labelledby="end-title">
            <h2 id="end-title">提前结束这一将？</h2>
            <p>
              此操作会立即结束所有人的本将牌局。已结算分数保留，当前未完成的手牌不追加胡牌分。结果会标注为提前结束。
            </p>
            <div className="buttons">
              <button onClick={() => setConfirmEnd(false)}>继续打牌</button>
              <button
                className="danger"
                disabled={!connected || pending}
                onClick={() => {
                  command('room:end');
                  setConfirmEnd(false);
                }}
              >
                确认结束
              </button>
            </div>
          </section>
        </div>
      )}
      <footer>
        南京麻将 · 敞开头 V1.0.8 <span>好友相聚，轻松一将</span>
      </footer>
    </main>
  );
}
