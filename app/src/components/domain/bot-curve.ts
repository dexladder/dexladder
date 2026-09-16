import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Stat } from '../ui/stat';
import { wilsonHalf } from '../../lib/bots/arena';
import type { Status } from '../../design/tokens';
import type { BotMetrics } from '../../lib/bots/metrics';
import type { Score } from '../../lib/bots/wallet';

export interface CurveProps {
  readonly score: Score;
  readonly m: BotMetrics;
  readonly slipBps: number;
  readonly slipCost: number;
  /** what the slippage setting is doing, in words */
  readonly slipNote: string;
  /** where the run happened — a Worker, or this thread */
  readonly runNote: string;
  fmt(n: number): string;
}

const pct = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) + '%';
const sign = (x: number): Status => (x > 0 ? 'good' : x < 0 ? 'bad' : 'neutral');

const swatch = (token: string, label: string): HTMLElement =>
  h('span', { class: [CX.forkKey] }, h('i', { class: [CX.botSw], vars: { '--c': token } }), label);

/**
 * The curve, then the six figures a desk asks for, each labelled with what it is.
 *
 * MAX DRAWDOWN IS PRINTED FROM `Score.maxDDPct`, not measured off the drawing. The wallet marks
 * its drawdown at every price it sees and accumulates the worst of them BEFORE the equity series
 * is thinned, so past 1,800 marks the drawn trough may be a point that was dropped. The picture is
 * the shape; the score is the number.
 *
 * The win rate carries its Wilson 95% band for the same reason the Arena's does: "60% won" off
 * five trades is a band that spans nearly everything, and a bare percentage hides that.
 */
export function BotCurve(p: CurveProps): HTMLElement {
  const s = p.score, m = p.m;
  const half = wilsonHalf(s.wins, s.trades);
  return h('div', { class: [CX.botWrap], id: 'botCurveBlock' },
    h('canvas', { id: 'botCurve', class: [CX.botCanvas], attrs: { height: '260' }, aria: { label: 'Equity curve with the underwater drawdown beneath it' } }),
    h('div', { class: [CX.forkBar] },
      swatch('var(--cyan)', 'equity'),
      swatch('var(--gold)', 'the stake it started with'),
      swatch('var(--down)', 'underwater — how far below its own peak')),
    h('div', { class: [CX.perpGrid], id: 'botCurveMetrics', role: 'group', aria: { label: 'Run metrics' } },
      Stat({ label: 'Sharpe', value: m.thin ? m.sharpe.toFixed(2) + ' ?' : m.sharpe.toFixed(2), hint: m.thin ? 'only ' + m.samples + ' bars — a sample, not a result' : 'annualised · Sortino ' + m.sortino.toFixed(2) }),
      Stat({ label: 'Profit factor', value: Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', hint: 'gross won ÷ gross lost · expectancy ' + p.fmt(s.expectancy) + '/trade' }),
      Stat({ label: 'Win rate', value: s.trades ? pct(s.winRatePct) + ' ±' + half.toFixed(1) : '—', hint: s.trades ? s.wins + ' of ' + s.trades + ' trades · 95% Wilson band' : 'no round trip yet' }),
      Stat({ label: 'Max drawdown', value: pct(s.maxDDPct), hint: 'worst mark-to-mark, wicks included · ' + m.underwaterBars + ' bars under water' }),
      Stat({ label: 'Fee drag', value: pct(s.feeDragPct), hint: p.fmt(s.feesUSD) + ' across ' + s.fills + ' fill(s)' }),
      Stat({ label: 'Slippage cost', value: p.slipBps ? p.fmt(p.slipCost) : 'off', hint: p.slipBps ? p.slipBps.toFixed(0) + ' bps conceded on every fill' : '0 bps — fills print at the bar price' })),
    h('div', { class: [CX.verdict] },
      h('div', { class: [CX.verdictRow, CX[sign(s.edgePct)]] },
        'Return ' + pct(s.returnPct) + ' against buy-and-hold ' + pct(s.buyHoldPct) + ' — an edge of ' + pct(s.edgePct) + '. The line above is the wallet; the band beneath it is how far below its own best it was at every moment, which is the part people actually stop a bot over.'),
      h('div', { class: [CX.verdictRow, CX.neutral], id: 'botSlipNote' }, p.slipNote),
      h('div', { class: [CX.verdictRow, CX.neutral], id: 'botRunNote' }, p.runNote)));
}

/** A progress line while a backtest runs somewhere else. Stages, never an invented percentage. */
export function BotProgress(step: number, of: number, text: string): HTMLElement {
  return h('div', { class: [CX.forkSec], id: 'botProgress', data: { step: String(step), of: String(of) } },
    h('div', { class: [CX.forkHead] }, h('span', {}, 'Backtest · stage ' + step + ' of ' + of)),
    h('div', { class: [CX.meter] }, h('div', { class: [CX.meterFill], vars: { '--pct': Math.round((step / Math.max(1, of)) * 100) + '%' } })),
    h('div', { class: [CX.forkKey] }, text));
}
