/**
 * Legacy call-site shims for the indicator math.
 *
 * The payload's chart code calls emaArr/smaArr/rsiArr/macdArr as bare globals, and the
 * v154 layers call DLCORE.sma/rsi/stdev/logRets/brier. The build replaces those bodies
 * with one-line delegations to these shims, so there is exactly one implementation of each
 * formula in the shipped file. Legacy edge behaviour (emaArr on an empty array returned
 * [undefined]) is preserved here, at the boundary, so the pure library stays clean.
 */
import { ema, sma, smaLast, rsi, rsiLast, macd } from '../lib/indicators';
import { stdev, logReturns, brier } from '../lib/math';

export const chart = {
  emaArr: (vals: number[], p: number): (number | undefined)[] => (vals.length ? ema(vals, p) : [vals[0]]),
  smaArr: (vals: number[], p: number): number[] => sma(vals, p),
  rsiArr: (vals: number[], p: number): number[] => rsi(vals, p),
  // legacy: an empty input produced sig [undefined] via emaArr's empty edge — preserved
  macdArr: (vals: number[]) => (vals.length ? macd(vals) : { line: [] as number[], sig: [undefined], hist: [] as number[] }),
};

export const core = {
  sma: (a: number[], n: number): number | null => smaLast(a, n),
  rsi: (a: number[], n?: number): number | null => rsiLast(a || [], n || 14),
  stdev: (a: number[]): number => (a ? stdev(a) : 0),
  logRets: (px: number[]): number[] => logReturns(px),
  brier,
};
