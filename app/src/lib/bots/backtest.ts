/**
 * A strategy run over real history, under the Rewind law: a decision taken on bar i's close fills
 * at bar i+1's OPEN, never on the bar the bot was looking at. Inside a bar the wallet is marked at
 * the open, the low, the high and the close, in that order — pessimistic for a long (the stop is
 * reached before the target) — so a risk exit fires where the tape actually went, wick included.
 *
 * The same wallet and the same score as the live Arena, so a backtest and a live run are the
 * same numbers measured on different bars.
 */
import { evaluate } from './rules';
import { fill, holding, mark, open, riskExit, score, type Score } from './wallet';
import type { Candle, LogLine, Signal, Strategy, Wallet } from './types';

export interface BacktestResult {
  readonly wallet: Wallet;
  readonly score: Score;
  readonly bars: number;
  readonly from: number;
  readonly to: number;
  /** the decisions that led to a fill or an exit, newest last (capped) */
  readonly log: readonly LogLine[];
  /** [t, equity] at each bar close — the drawn curve */
  readonly curve: readonly (readonly [number, number])[];
}

/**
 * How badly the market treats a fill, beyond the venue's fee.
 *
 * Optional, and absent means zero: the four-argument call is the shipped one — the gates, the
 * Arena and the saved runs all depend on the numbers it produces — so the default path must not
 * merely be equivalent, it must be the same arithmetic.
 */
export interface ExecOptions {
  /** basis points the fill moves against you: a buy pays more, a sell receives less */
  readonly slipBps?: number;
}

const CAP = 300;
const push = (log: LogLine[], l: LogLine): void => { log.push(l); if (log.length > CAP) log.splice(0, log.length - CAP); };

/**
 * The price a fill actually gets, `bps` against its own direction.
 *
 * Slippage moves the PRICE and is not deducted afterwards as a cost, because those are not the
 * same model. A cost subtracted at the end leaves the position's basis untouched — the average
 * entry, and therefore the stop distance, the trailing high, the take-profit and every percentage
 * measured off them, would all still be quoted from a price nobody was filled at. Moving the
 * price instead pays the slippage where it happens: a long entered 30 bps higher is already 30 bps
 * nearer its stop, sells into the stop 30 bps lower again, and the run reports a stop that fires
 * earlier and a trade that loses more — which is what a worse fill actually does to a bot.
 *
 * Zero returns the price untouched rather than multiplying by 1: identical floats, not merely
 * equal ones, so the default path is bit-for-bit the shipped one.
 */
export const slipped = (px: number, side: 'buy' | 'sell', bps: number): number => {
  if (!bps || !Number.isFinite(bps)) return px;
  const k = Math.abs(bps) / 10_000;
  return side === 'buy' ? px * (1 + k) : px * (1 - k);
};

/**
 * Mark the wallet through one bar's path and take any risk exit where it fired.
 *
 * The marks are the tape and are NEVER slipped — a stop is tripped by where the market went, not
 * by where your order landed. Only the resulting fill pays the slippage.
 */
export function walkBar(w: Wallet, s: Strategy, b: Candle, feeRate: number, log: LogLine[] | null, slipBps = 0): Wallet {
  let out = w;
  for (const px of [b.o, b.l, b.h, b.c]) {
    out = mark(out, px, b.t);
    const hit = riskExit(out, s.risk, px);
    if (hit) {
      const r = fill(out, 'sell', 1, slipped(px, 'sell', slipBps), feeRate, b.t, hit.why, hit.reason);
      out = r.wallet;
      if (log && r.fill) push(log, { t: b.t, kind: 'risk', text: hit.reason + ' → ' + r.text });
    }
  }
  return out;
}

export function runStrategy(s: Strategy, bars: readonly Candle[], stake: number, feeRate: number, opts?: ExecOptions): BacktestResult {
  const slipBps = opts?.slipBps ?? 0;
  let w = open(stake);
  const log: LogLine[] = [], curve: (readonly [number, number])[] = [];
  let pending: Signal | null = null, lastExitBar = -1;
  const cache = new Map<string, number[]>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    // 1 · what the previous close decided fills at this open
    if (pending && pending.action !== 'hold') {
      const r = fill(w, pending.action, pending.size ?? 1, slipped(b.o, pending.action, slipBps), feeRate, b.t, 'signal', pending.reason);
      w = r.wallet;
      if (r.fill) push(log, { t: b.t, kind: 'fill', text: (pending.action === 'buy' ? 'entry' : 'exit') + ' at the open → ' + r.text + ' · because ' + pending.reason });
      else push(log, { t: b.t, kind: 'error', text: 'could not fill: ' + r.text });
      if (pending.action === 'sell') lastExitBar = i;
    }
    pending = null;
    // 2 · the bar's own path: marks and risk exits
    const had = holding(w);
    w = walkBar(w, s, b, feeRate, log, slipBps);
    if (had && !holding(w)) lastExitBar = i;
    // 3 · decide on the close, for the next open
    const sig = evaluate(s, bars, i, holding(w), lastExitBar < 0 ? -1 : i - lastExitBar, cache);
    if (sig.action !== 'hold') { pending = sig; push(log, { t: b.t, kind: 'signal', text: sig.action + ' · ' + sig.reason }); }
    curve.push([b.t, w.cash + w.qty * b.c]);
  }
  // measured flat: whatever is still held is sold at the last close, fee paid
  const last = bars[bars.length - 1];
  if (last && holding(w)) {
    const r = fill(w, 'sell', 1, slipped(last.c, 'sell', slipBps), feeRate, last.t, 'close-out', 'run ended — measured flat');
    w = r.wallet; if (r.fill) push(log, { t: last.t, kind: 'fill', text: 'close-out at the last close → ' + r.text });
    curve[curve.length - 1] = [last.t, w.cash];
    w = mark(w, last.c, last.t);
  }
  return { wallet: w, score: score(w), bars: bars.length, from: bars[0]?.t ?? 0, to: last?.t ?? 0, log, curve };
}
