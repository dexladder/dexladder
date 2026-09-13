/**
 * The Arena: every bot measured the same way, ranked the honest way (edge over buy-and-hold,
 * not raw return), and a verdict that leads with the benchmark and names a small sample.
 */
import type { Score } from './wallet';
import type { BotDef, BotStatus } from './types';

export interface Ranked {
  readonly id: string;
  readonly name: string;
  readonly kind: BotDef['kind'];
  readonly sym: string;
  readonly interval: string;
  readonly status: BotStatus;
  readonly score: Score;
  readonly rank: number;
  /** "beats the market", "trails the market", "too early to say" */
  readonly call: string;
}

export const MIN_TRADES_TO_JUDGE = 5;

export function rank(rows: readonly { def: BotDef; status: BotStatus; score: Score }[]): Ranked[] {
  const sorted = [...rows].sort((a, b) => b.score.edgePct - a.score.edgePct || b.score.returnPct - a.score.returnPct);
  return sorted.map((r, i) => ({
    id: r.def.id, name: r.def.name, kind: r.def.kind, sym: r.def.sym, interval: r.def.interval, status: r.status, score: r.score, rank: i + 1,
    call: r.score.trades < MIN_TRADES_TO_JUDGE ? 'too early to say' : r.score.edgePct > 0 ? 'beats the market' : r.score.edgePct < 0 ? 'trails the market' : 'level with the market',
  }));
}

/** Wilson 95 % interval half-width for a win rate, in percentage points. */
export function wilsonHalf(wins: number, n: number): number {
  if (n <= 0) return 50;
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  return (100 * (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)))) / d;
}

export interface VerdictLine { readonly status: 'good' | 'bad' | 'warn' | 'neutral' | 'info'; readonly text: string }

const pct = (x: number): string => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%';

/** The sentences under the figures. Buy-and-hold first, always. */
export function verdict(s: Score, live: boolean): VerdictLine[] {
  const out: VerdictLine[] = [];
  out.push({ status: s.edgePct > 0 ? 'good' : s.edgePct < 0 ? 'bad' : 'neutral',
    text: 'Bot ' + pct(s.returnPct) + ' vs buy-and-hold ' + pct(s.buyHoldPct) + ' over the same bars — an edge of ' + pct(s.edgePct) + '. Holding the coin is the bar every bot must clear.' });
  if (s.trades === 0) out.push({ status: 'info', text: live ? 'No round trip yet — a bot that has not traded has not been tested.' : 'The rules never completed a round trip on these bars — loosen the entry, or pick a range where the setup occurred.' });
  else {
    const half = wilsonHalf(s.wins, s.trades);
    out.push({ status: s.trades < MIN_TRADES_TO_JUDGE ? 'warn' : 'neutral',
      text: s.trades + ' trade(s) · win rate ' + s.winRatePct.toFixed(0) + '% ±' + half.toFixed(1) + ' (95 % band)' + (s.trades < MIN_TRADES_TO_JUDGE ? ' — with this few trades the band spans nearly everything. It is a sample, not a result.' : '.') });
    out.push({ status: 'neutral', text: 'Profit factor ' + (Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') + ' · expectancy ' + (s.expectancy >= 0 ? '+' : '−') + Math.abs(s.expectancy).toFixed(2) + ' USDT per trade.' });
  }
  out.push({ status: s.maxDDPct > 20 ? 'bad' : s.maxDDPct > 10 ? 'warn' : 'neutral', text: 'Worst drawdown ' + s.maxDDPct.toFixed(2) + '% of equity' + (s.maxDDPct > 20 ? ' — a fifth of the wallet gone at one point. Would you have kept it running?' : '.') });
  if (s.fills > 0) out.push({ status: s.feeDragPct > 2 ? 'warn' : 'neutral', text: 'Fees ' + s.feesUSD.toFixed(2) + ' USDT = ' + s.feeDragPct.toFixed(2) + '% of the stake across ' + s.fills + ' fill(s)' + (s.feeDragPct > 2 ? ' — the venue is eating the edge; trade less often.' : '.') });
  out.push({ status: 'neutral', text: 'In the market ' + s.exposurePct.toFixed(0) + '% of the time' + (s.openPl ? ' · open P&L ' + (s.openPl >= 0 ? '+' : '−') + Math.abs(s.openPl).toFixed(2) + ' USDT' : '') + '.' });
  return out;
}
