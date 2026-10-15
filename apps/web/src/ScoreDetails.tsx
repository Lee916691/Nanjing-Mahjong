import { MahjongTile } from './MahjongTile';
import type { PlayerGameView, ScoreLine } from '@nanjing-mahjong/shared-types';

export function ScoreDetails({
  score,
  players,
  readable,
  showHand = false,
}: {
  score: ScoreLine;
  players: (PlayerGameView | null)[];
  readable: (value: string) => string;
  showHand?: boolean;
}) {
  const calculation = score.calculation;
  return (
    <article className="score-detail">
      <div className="score-detail-heading">
        <strong>
          {calculation?.winner !== undefined
            ? `${players[calculation.winner]?.name ?? '玩家'} · `
            : ''}
          {readable(score.reason)}
        </strong>
        {showHand && <span>第 {score.hand} 手</span>}
      </div>
      {score.responsibility && (
        <p className="score-factors">
          {players[score.responsibility.trigger]?.name ?? '玩家'}触发本次结算， 由
          {players[score.responsibility.payer]?.name ?? '玩家'}承包三份付款。
        </p>
      )}
      {score.winningHand && (
        <section className="winning-hand" aria-label="胡牌牌面">
          <div className="winning-rack">
            <div className="winning-group">
              {score.winningHand.concealed.map((tile) => (
                <MahjongTile key={tile.id} tile={tile} small />
              ))}
            </div>
            <div className="winning-tile">
              <span>胡张</span>
              <MahjongTile tile={score.winningHand.winningTile} small highlight />
            </div>
          </div>
          {score.winningHand.melds.length > 0 && (
            <div className="winning-rack">
              <span className="rack-label">副露</span>
              {score.winningHand.melds.map((meld, i) => (
                <div className="winning-group meld-group" key={i}>
                  {meld.tiles.map((tile) => (
                    <MahjongTile key={tile.id} tile={tile} small />
                  ))}
                </div>
              ))}
            </div>
          )}
          {score.winningHand.flowers.length > 0 && (
            <div className="winning-rack">
              <span className="rack-label">花牌</span>
              <div className="winning-group">
                {score.winningHand.flowers.map((tile) => (
                  <MahjongTile key={tile.id} tile={tile} small />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {calculation ? (
        <div className="score-calculation">
          <div className="score-terms">
            {calculation.terms.map((term, i) => (
              <div key={i}>
                <span>{term.label}</span>
                <b>+{term.points}</b>
              </div>
            ))}
          </div>
          <div className="score-equation">
            <code>{calculation.formula}</code>
            <span>每笔 {calculation.perPayment} 分</span>
          </div>
          {calculation.factors.length > 0 && (
            <p className="score-factors">
              {calculation.factors.map((f) => `${f.label} ×${f.value}`).join(' · ')}
            </p>
          )}
          <div className="score-total">
            <span>本项合计</span>
            <strong>
              {calculation.total} <small>分</small>
            </strong>
            <span>{calculation.payments} 笔付款</span>
          </div>
        </div>
      ) : (
        <p className="score-legacy">本条记录仅保存了付款金额</p>
      )}
      <ul className="score-payments">
        {score.transfers.map((transfer, i) => (
          <li key={i}>
            <span>{players[transfer.from]?.name ?? '玩家'}</span>
            <i aria-label="支付给">→</i>
            <span>{players[transfer.to]?.name ?? '玩家'}</span>
            <b>
              {transfer.amount}
              <small> 分</small>
            </b>
          </li>
        ))}
      </ul>
    </article>
  );
}
