/**
 * Institutional read on a bot run: the figures a desk asks for that the wallet's `Score` does not
 * already carry. Nothing here recomputes what `Score` has — return, edge over buy-and-hold, win
 * rate, profit factor, expectancy, exposure, fees and the worst drawdown are already measured
 * there, and a second implementation of any of them would only drift.
 *
 * What is added, and why each earns its line:
 *   · Sharpe          — return per unit of the volatility the holder actually rode, annualised.
 *   · Sortino         — Sharpe punishes upside volatility, which a trend bot produces on purpose.
 *   · annualised vol  — Sharpe alone hides whether it came from a big numerator or a tiny one.
 *   · CAGR            — `returnPct` has no time in it: +8% over a week and over a year are not the
 *                       same bot, and only an annualised figure says so.
 *   · Calmar          — the only ratio priced in the drawdown a person has to sit through.
 *   · underwater      — `maxDDPct` is one number; the series is the shape, drawn under the equity
 *                       line, plus how LONG the wallet stayed below its peak, which is what makes
 *                       people switch a bot off.
 *
 * Pure: no DOM, no clock, no randomness. The bar size arrives as an argument and the elapsed time
 * is read off the curve's own timestamps.
 */
import { INTERVAL_MS } from './intervals';
import type { Score } from './wallet';
import type { BotInterval, Wallet } from './types';
import type { VerdictLine } from './arena';

/** `[t, value]` at each point — the shape `BacktestResult.curve` and `Wallet.equity` both use. */
export type Curve = readonly (readonly [number, number])[];

/**
 * The Julian year in milliseconds. Deliberately the same constant `src/lib/backtest/candles.ts`
 * uses in `barsPerYear`, so the Rewind desk and the Arena annualise a Sharpe identically — two
 * desks quoting different Sharpes for the same curve is a bug report waiting to happen.
 */
export const MS_PER_YEAR = 31_557_600_000;

/** Bars of `iv` in a year — the annualisation factor. Read off the real bar size, never guessed. */
export const barsPerYear = (iv: BotInterval): number => MS_PER_YEAR / INTERVAL_MS[iv];

/**
 * The risk-free rate, as an annual percentage, defaulting to zero.
 *
 * Zero is the honest default HERE and not merely a convenience: the wallet is denominated in
 * USDT, and the benchmark this product actually judges a bot against is holding the coin —
 * `Score.edgePct`, which the Arena leads with. Charging a cash rate on top would price the same
 * opportunity cost twice. A desk running against a treasury bill should pass its own rate.
 */
export const DEFAULT_RISK_FREE_PCT = 0;

/**
 * Fewer per-bar returns than this and the ratio is noise wearing a suit. Annualising multiplies a
 * short sample's standard error by √(bars per year) as well — a 30-bar Sharpe on 1m bars is
 * scaled by about 725. The Arena already refuses to call a bot under 5 trades for the same
 * reason; this is that refusal, expressed in bars.
 */
export const MIN_RETURNS_TO_JUDGE = 30;

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Per-bar simple returns off an equity curve. A point at or below zero ends the series' usefulness
 * — you cannot take a return off a wallet worth nothing — so such a step is skipped rather than
 * folded in as a fabricated −100%.
 */
export function barReturns(curve: Curve): readonly number[] {
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]![1], now = curve[i]![1];
    if (prev > 0) out.push(now / prev - 1);
  }
  return out;
}

export interface RiskAdjusted {
  /** annualised (mean − risk-free) / standard deviation of per-bar returns */
  readonly sharpe: number;
  /** the same, with only the downside deviation in the denominator */
  readonly sortino: number;
  /** annualised standard deviation of per-bar returns, in percent */
  readonly annVolPct: number;
  /** how many per-bar returns the figures were computed from */
  readonly samples: number;
  /** true when `samples` is under MIN_RETURNS_TO_JUDGE — state the figure, refuse to lean on it */
  readonly thin: boolean;
}

/**
 * Sharpe and Sortino from per-bar returns, annualised by the bar size.
 *
 * The sample standard deviation (n − 1) is used, matching `src/lib/backtest/metrics.ts`. Under
 * two returns there is no deviation to speak of and every figure is 0 — the same refusal the
 * Rewind desk makes, so an empty run reads as "no answer" rather than as infinity.
 *
 * `riskFreePct` is an ANNUAL percentage; it is de-annualised geometrically onto one bar before
 * being subtracted, because compounding a per-bar rate back up must return the annual one.
 */
export function riskAdjusted(curve: Curve, iv: BotInterval, riskFreePct: number = DEFAULT_RISK_FREE_PCT): RiskAdjusted {
  const r = barReturns(curve), n = r.length;
  const blank: RiskAdjusted = { sharpe: 0, sortino: 0, annVolPct: 0, samples: n, thin: n < MIN_RETURNS_TO_JUDGE };
  if (n < 2) return blank;
  const per = barsPerYear(iv), ann = Math.sqrt(per);
  // a per-bar rate that compounds back to the annual one, not the annual one divided by bars
  const rf = riskFreePct === 0 ? 0 : Math.pow(1 + riskFreePct / 100, 1 / per) - 1;
  const ex = r.map(x => x - rf);
  const m = sum(ex) / n;
  const sd = Math.sqrt(sum(ex.map(x => (x - m) ** 2)) / (n - 1));
  // downside deviation: only the shortfalls are squared, but the denominator stays n − 1 so a run
  // with few losses is not flattered by dividing its shortfalls by a smaller count
  const dd = Math.sqrt(sum(ex.map(x => (x < 0 ? x * x : 0))) / (n - 1));
  return {
    sharpe: sd > 0 ? (m / sd) * ann : 0,
    sortino: dd > 0 ? (m / dd) * ann : 0,
    annVolPct: sd * ann * 100,
    samples: n,
    thin: n < MIN_RETURNS_TO_JUDGE,
  };
}

export interface Underwater {
  /** `[t, ddPct]` at every point — 0 at a peak, positive below it. Plot it negated, under the line. */
  readonly series: Curve;
  /** the deepest point, in percent of the peak it fell from */
  readonly maxPct: number;
  /** the timestamp of that trough */
  readonly maxAt: number;
  /** the longest unbroken run of points below a previous peak */
  readonly longest: number;
  /** that run in milliseconds, off the curve's own timestamps */
  readonly longestMs: number;
  /** how far under water the last point is */
  readonly currentPct: number;
}

/**
 * Drawdown from the running peak at every point.
 *
 * `ddPct` is POSITIVE going down, so it compares directly with `Score.maxDDPct` without a sign
 * flip at the call site; a chart negates it to draw it beneath the equity line.
 *
 * `seedPeak` is the peak the series starts from. For a wallet that is its STAKE — `open()` seeds
 * `peak` with the stake, so a wallet that loses money on its first mark is already under water,
 * and reproducing `maxDD` exactly means starting from the same place. Pass 0 for a bare curve.
 */
export function underwater(points: Curve, seedPeak = 0): Underwater {
  let peak = seedPeak, maxPct = 0, maxAt = 0, run = 0, longest = 0;
  let runFrom = 0, longestMs = 0, current = 0;
  const series: (readonly [number, number])[] = [];
  for (const p of points) {
    const t = p[0], eq = p[1];
    if (eq >= peak) { peak = eq; run = 0; } else { if (run === 0) runFrom = t; run++; if (run > longest) longest = run; if (t - runFrom > longestMs) longestMs = t - runFrom; }
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxPct) { maxPct = dd; maxAt = t; }
    current = dd;
    series.push([t, dd] as const);
  }
  return { series, maxPct, maxAt, longest, longestMs, currentPct: current };
}

/**
 * The wallet's own underwater series — every price the bot was marked at, wicks included, seeded
 * from the stake. Its `maxPct` is `Score.maxDDPct` recomputed from the same points by the same
 * formula, and the tests assert the two agree exactly rather than trusting that they do.
 *
 * One caveat the integrator must know: `Wallet.equity` is thinned two-for-one past MAX_POINTS
 * (1800 marks ≈ 450 bars). Past that the series is a faithful SHAPE but the trough may have been
 * one of the dropped points, so `maxPct` can read shallower than `Score.maxDDPct`. The wallet's
 * own `maxDD` is accumulated before thinning and stays the number of record — quote that one.
 */
export const walletUnderwater = (w: Wallet): Underwater => underwater(w.equity, w.start);

export interface BotMetrics extends RiskAdjusted {
  /** compound annual growth rate implied by the run, in percent */
  readonly cagrPct: number;
  /** CAGR over the worst drawdown — return per unit of pain, the way an allocator reads it */
  readonly calmar: number;
  /** the wallet's drawdown shape, from every mark */
  readonly underwater: Underwater;
  /** bars the wallet spent below a previous CLOSE peak, off the drawn curve */
  readonly underwaterBars: number;
  /** how long the run covered, in milliseconds, at this bar size */
  readonly elapsedMs: number;
}

/** Everything a backtest result carries that this module needs — `BacktestResult` satisfies it. */
export interface MetricSource {
  readonly wallet: Wallet;
  readonly score: Score;
  readonly curve: Curve;
}

/**
 * The institutional block, computed off one finished run.
 *
 * Elapsed time is `bars × bar size` rather than last-minus-first timestamp: the curve's first
 * point is already one bar into the run, and a venue outage that leaves a gap should not be
 * counted as time the bot was compounding.
 */
export function botMetrics(r: MetricSource, iv: BotInterval, riskFreePct: number = DEFAULT_RISK_FREE_PCT): BotMetrics {
  const ra = riskAdjusted(r.curve, iv, riskFreePct);
  const uw = walletUnderwater(r.wallet);
  const elapsedMs = r.curve.length * INTERVAL_MS[iv];
  const start = r.wallet.start, end = r.score.equity;
  const years = elapsedMs / MS_PER_YEAR;
  // a growth rate needs a positive base and a positive end: a wallet taken to zero has no CAGR,
  // it has a total loss, and −100% is the honest thing to print
  const cagrPct = start > 0 && years > 0 ? (end > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : -100) : 0;
  const maxDD = r.score.maxDDPct;
  return {
    ...ra,
    cagrPct,
    // same convention as Score.profitFactor: no loser at all is ∞ if there was a gain, else 0
    calmar: maxDD > 0 ? cagrPct / maxDD : cagrPct > 0 ? Infinity : 0,
    underwater: uw,
    underwaterBars: underwater(r.curve, start).longest,
    elapsedMs,
  };
}

// ---------------------------------------------------------------- the sentences under the figures

const days = (ms: number): string => (ms >= 86_400_000 ? (ms / 86_400_000).toFixed(1) + ' days' : (ms / 3_600_000).toFixed(1) + ' hours');

/**
 * A figure, then a plain sentence — the Arena's voice, applied to the risk block. Without these
 * lines a Sharpe is a number nobody can act on, which is how these ratios get misread.
 */
export function riskVerdict(m: BotMetrics): VerdictLine[] {
  const out: VerdictLine[] = [];
  out.push({
    status: m.thin ? 'warn' : m.sharpe > 1 ? 'good' : m.sharpe < 0 ? 'bad' : 'neutral',
    text: 'Sharpe ' + m.sharpe.toFixed(2) + ' · Sortino ' + m.sortino.toFixed(2) + ' on ' + m.annVolPct.toFixed(1) + '% annualised volatility'
      + (m.thin
        ? ' — from only ' + m.samples + ' bar(s). Annualising a sample this short magnifies its noise as much as its return. It is a sample, not a result.'
        : '. Above 1 is good, above 2 is rare. Sortino is the same figure counting only the down moves, so a gap between them means the swings were mostly upward.'),
  });
  out.push({
    status: m.cagrPct > 0 ? 'good' : m.cagrPct < 0 ? 'bad' : 'neutral',
    text: 'That pace compounds to ' + (m.cagrPct >= 0 ? '+' : '−') + Math.abs(m.cagrPct).toFixed(2) + '% a year over ' + days(m.elapsedMs)
      + ' of bars — an extrapolation, not a forecast, and a short run extrapolates violently.',
  });
  out.push({
    status: m.calmar > 1 ? 'good' : m.calmar < 0 ? 'bad' : 'warn',
    text: 'Calmar ' + (Number.isFinite(m.calmar) ? m.calmar.toFixed(2) : '∞') + ' — a year of that return for every ' + m.underwater.maxPct.toFixed(2)
      + '% the wallet was down at its worst. Under 1 you are paid less than the drawdown you sat through.',
  });
  out.push({
    status: m.underwater.currentPct > 5 ? 'warn' : 'neutral',
    text: 'Longest stretch under water ' + days(m.underwater.longestMs) + ' (' + m.underwaterBars + ' bar(s) below a previous close peak)'
      + (m.underwater.currentPct > 0.01 ? ', and it ended ' + m.underwater.currentPct.toFixed(2) + '% below its peak.' : ', and it ended at a new high.')
      + ' The depth is what you lose; the length is what makes you stop.',
  });
  return out;
}
