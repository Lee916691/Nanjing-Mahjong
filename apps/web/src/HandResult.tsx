import type { RoomView } from '@nanjing-mahjong/shared-types';
import { ScoreDetails } from './ScoreDetails';

export function HandResult({
  room,
  connected,
  pending,
  confirmationUnknown,
  hint,
  readable,
  onNextHand,
  onClose,
  feedbackId,
}: {
  room: RoomView;
  connected: boolean;
  pending: boolean;
  confirmationUnknown: boolean;
  hint: string;
  readable: (value: string) => string;
  onNextHand?: () => void;
  onClose: () => void;
  feedbackId?: number;
}) {
  const scores = room.scores.filter((score) => score.hand === room.hand);
  const events = room.tableEvents
    .filter((event) => event.hand === room.hand)
    .sort((a, b) => a.sequence - b.sequence);
  const settled = events.filter((event) => event.type === 'hand-settled').at(-1);
  const hu = events.filter((event) => event.type === 'hu');
  const draw = events.filter((event) => event.type === 'draw').at(-1);
  const isDraw = settled ? settled.result === 'draw' : !!draw || room.result === '流局';
  const winners = isDraw
    ? []
    : (settled?.winnerSeats ??
      (hu.length
        ? hu.flatMap((event) => event.winnerSeats)
        : scores.flatMap((score) =>
            score.calculation?.winner === undefined ? [] : [score.calculation.winner],
          )));
  const name = (seat: number) =>
    room.players[seat]?.name || `${['东', '南', '西', '北'][seat]}位玩家`;
  const title = isDraw ? '流局' : (settled?.summary ?? hu.at(-1)?.summary ?? room.result);
  return (
    <div className="hand-result" role="dialog" aria-labelledby="hand-result-title">
      <div className="hand-result-content" tabIndex={0} aria-label="本手结算内容">
        <span className="result-eyebrow">第 {room.hand} 手 · 结算</span>
        <h2
          id="hand-result-title"
          className={feedbackId === undefined ? undefined : 'feedback-target'}
          data-feedback-id={feedbackId}
        >
          {title}
        </h2>
        {isDraw && (settled?.summary || draw?.summary) && (
          <p className="result-summary">{settled?.summary ?? draw?.summary}</p>
        )}
        {!isDraw && (
          <div className="result-winners">
            {winners.length ? (
              [...new Set(winners)].map((seat) => {
                const score = scores.find((line) => line.calculation?.winner === seat);
                const method = hu.find((event) => event.winnerSeats.includes(seat))?.summary;
                return (
                  <p key={seat}>
                    胡牌玩家：<strong>{name(seat)}</strong>
                    {(method || settled?.summary) && <span> · {method ?? settled?.summary}</span>}
                    {score && <small>计分摘要：{readable(score.reason)}</small>}
                  </p>
                );
              })
            ) : (
              <p>当前快照未提供胡牌玩家或方式</p>
            )}
          </div>
        )}
        <div className="hand-deltas">
          {[0, 1, 2, 3].map((seat) => {
            const player = room.players[seat];
            const delta = settled?.changes.find((change) => change.seat === seat)?.delta;
            return (
              <div key={seat} data-seat={seat}>
                <span>{name(seat)}</span>
                <small>本手变化</small>
                <strong
                  className={
                    delta === undefined ? '' : delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''
                  }
                >
                  {delta === undefined
                    ? '未提供'
                    : `${delta > 0 ? '+' : ''}${delta} 分（${delta > 0 ? '增加' : delta < 0 ? '减少' : '无变化'}）`}
                </strong>
                <small>累计分：{player ? `${player.score} 分` : '未提供'}</small>
              </div>
            );
          })}
        </div>
        <details className="hand-score-details">
          <summary>查看计分详情 · {scores.length} 项</summary>
          <div className="hand-transfers">
            {scores.length ? (
              scores.map((score, i) => (
                <ScoreDetails key={i} score={score} players={room.players} readable={readable} />
              ))
            ) : (
              <p>当前快照未提供计分明细</p>
            )}
          </div>
        </details>
      </div>
      <div className="result-bottom">
        <span>{hint}</span>
        <div className="result-actions">
          <button
            className="primary"
            disabled={
              !connected ||
              pending ||
              confirmationUnknown ||
              room.paused ||
              room.nextHandReady?.includes(room.self) ||
              !room.nextHandToken
            }
            onClick={onNextHand}
          >
            {room.nextHandReady?.includes(room.self) ? '已准备' : '开始下一把'} ·{' '}
            {room.nextHandReady?.length ?? 0}/4
          </button>
          <button onClick={onClose}>查看牌桌</button>
        </div>
      </div>
    </div>
  );
}
