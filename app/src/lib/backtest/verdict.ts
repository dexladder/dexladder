/**
 * Why the run behaved the way it did — the half a backtester usually leaves out. Every line is
 * derived from the metrics, and the uncomfortable ones are not optional: a small sample, a fee
 * drag, a drawdown nobody would have sat through, and the fact that beating buy-and-hold is the
 * only result that counts.
 */
import type { Metrics } from './metrics';

export type LineStatus = 'good' | 'bad' | 'warn' | 'neutral';
export interface VerdictLine { readonly status: LineStatus; readonly label: string; readonly text: string }
export interface Verdict { readonly headline: string; readonly lines: readonly VerdictLine[] }

const pct = (x: number): string => (x < 0 ? '−' : '') + (Math.abs(x) >= 100 ? Math.abs(x).toFixed(0) : Math.abs(x) >= 10 ? Math.abs(x).toFixed(1) : Math.abs(x).toFixed(2)) + '%';
const usd = (x: number): string => (x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(2);

/**
 * 95% band on a win rate of `p` over `n` trades — how much of this result is luck. Wilson, not
 * the textbook normal interval: after three wins out of three the normal formula says ±0%, which
 * is exactly the lie this line exists to prevent.
 */
export function winRateBand(winRatePct: number, n: number): number {
  if (n < 1) return 0;
  const p = Math.min(1, Math.max(0, winRatePct / 100)), z = 1.959964, z2 = z * z;
  return ((z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)) * 100;
}

export function verdict(m: Metrics, label: string): Verdict {
  const lines: VerdictLine[] = [];
  const beat = m.edgePct > 0;
  lines.push({
    status: beat ? 'good' : 'bad', label: beat ? 'You beat buy-and-hold' : 'Buy-and-hold beat you',
    text: `Your run returned ${pct(m.returnPct)} over ${m.bars} bars of ${label}; holding from the first bar to the last returned ${pct(m.buyHoldPct)}. `
      + `The difference — ${pct(m.edgePct)} — is everything your ${m.trades} trade${m.trades === 1 ? '' : 's'} added or cost.`,
  });
  if (m.trades === 0) {
    lines.push({ status: 'warn', label: 'No closed trades', text: 'Nothing was bought and sold, so there is no strategy to judge yet. Place an order, step the bars, and watch the equity curve answer.' });
    return { headline: 'Nothing traded yet', lines };
  }
  const band = winRateBand(m.winRatePct, m.trades);
  lines.push({
    status: m.trades >= 30 ? 'neutral' : 'warn', label: `${m.trades} closed trade${m.trades === 1 ? '' : 's'}`,
    text: m.trades >= 30
      ? `${pct(m.winRatePct)} of them won (±${pct(band)} at 95% confidence). Profit factor ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}, expectancy ${usd(m.expectancy)} per trade.`
      : `A sample this small says almost nothing: the win rate is ${pct(m.winRatePct)} but the 95% band is ±${pct(band)}. Run a longer range before you believe either number.`,
  });
  lines.push({
    status: m.maxDDPct >= 35 ? 'bad' : m.maxDDPct >= 20 ? 'warn' : 'good', label: `Worst drawdown ${pct(m.maxDDPct)}`,
    text: `Equity spent ${m.ddBars} bar${m.ddBars === 1 ? '' : 's'} below its previous high. That is the number that decides whether a strategy is survivable — a curve you would have abandoned is not a curve you own.`,
  });
  if (m.feeDragPct > 0) {
    lines.push({
      status: m.feeDragPct >= 3 ? 'bad' : m.feeDragPct >= 1 ? 'warn' : 'neutral', label: `Fees ${usd(m.feesUSD)} (${pct(m.feeDragPct)})`,
      text: `${m.fills} fill${m.fills === 1 ? '' : 's'} cost ${pct(m.feeDragPct)} of the starting stack. Every trade has to clear that before it earns anything`
        + (m.trades ? `, which is ${usd(m.feesUSD / m.trades)} per round trip.` : '.'),
    });
  }
  lines.push({
    status: 'neutral', label: `In the market ${pct(m.exposurePct)} of the time`,
    text: m.exposurePct < 25
      ? 'Most of the run was in cash. Low exposure with a positive return is real skill; low exposure with a poor return is usually just a missed trend.'
      : `Sharpe ${m.sharpe.toFixed(2)} annualised from bar-to-bar returns. Above 1 is good, above 2 is rare, and a short run flatters both.`,
  });
  lines.push({
    status: 'neutral', label: 'No lookahead',
    text: 'Every fill used a price at or after the bar you were looking at: market orders at the next open, limits and stops only when a bar traded through them, gaps paid honestly. That is why this is slower — and worth more — than a strategy backtest on closes.',
  });
  return { headline: beat ? `Beat buy-and-hold by ${pct(m.edgePct)}` : `Behind buy-and-hold by ${pct(-m.edgePct)}`, lines };
}
