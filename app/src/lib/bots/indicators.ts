/**
 * Operands as series. Every indicator the rule builder offers is computed here, over the whole
 * candle set at once, from the same lib/indicators arithmetic the charts and screens use — so a
 * bot's "RSI(14) < 30" is the number the Terminal draws, not a private one. Warm-up points are
 * NaN, and a condition over a NaN never holds.
 */
import { atr, bollinger, ema, macd, roc, rsi, sma } from '../indicators';
import type { Candle, IndicatorId, IndOperand, Operand } from './types';

export interface IndicatorMeta {
  readonly id: IndicatorId;
  readonly label: string;
  /** parameter names, in order; [] for raw price fields */
  readonly params: readonly string[];
  readonly defaults: readonly number[];
  /** the scale the value lives on — decides which right-hand sides make sense */
  readonly scale: 'price' | 'percent' | 'oscillator' | 'volume' | 'delta';
  readonly about: string;
}

export const INDICATORS: readonly IndicatorMeta[] = Object.freeze([
  { id: 'close', label: 'Close', params: [], defaults: [], scale: 'price', about: 'the bar’s closing price' },
  { id: 'open', label: 'Open', params: [], defaults: [], scale: 'price', about: 'the bar’s opening price' },
  { id: 'high', label: 'High', params: [], defaults: [], scale: 'price', about: 'the bar’s high' },
  { id: 'low', label: 'Low', params: [], defaults: [], scale: 'price', about: 'the bar’s low' },
  { id: 'volume', label: 'Volume', params: [], defaults: [], scale: 'volume', about: 'base units traded in the bar' },
  { id: 'sma', label: 'SMA', params: ['period'], defaults: [20], scale: 'price', about: 'simple moving average of closes' },
  { id: 'ema', label: 'EMA', params: ['period'], defaults: [20], scale: 'price', about: 'exponential moving average of closes' },
  { id: 'rsi', label: 'RSI', params: ['period'], defaults: [14], scale: 'oscillator', about: 'relative strength, 0–100 — under 30 is called oversold, over 70 overbought' },
  { id: 'macd', label: 'MACD line', params: ['fast', 'slow'], defaults: [12, 26], scale: 'delta', about: 'fast EMA minus slow EMA' },
  { id: 'macdSignal', label: 'MACD signal', params: ['fast', 'slow'], defaults: [12, 26], scale: 'delta', about: '9-bar EMA of the MACD line' },
  { id: 'macdHist', label: 'MACD histogram', params: ['fast', 'slow'], defaults: [12, 26], scale: 'delta', about: 'MACD line minus its signal — momentum turning' },
  { id: 'bbUpper', label: 'Bollinger upper', params: ['period', 'k'], defaults: [20, 2], scale: 'price', about: 'mid + k standard deviations' },
  { id: 'bbLower', label: 'Bollinger lower', params: ['period', 'k'], defaults: [20, 2], scale: 'price', about: 'mid − k standard deviations' },
  { id: 'bbMid', label: 'Bollinger mid', params: ['period'], defaults: [20], scale: 'price', about: 'the band’s centre — a simple moving average' },
  { id: 'atr', label: 'ATR', params: ['period'], defaults: [14], scale: 'price', about: 'average true range — how far a bar travels' },
  { id: 'roc', label: 'Rate of change %', params: ['bars'], defaults: [12], scale: 'percent', about: 'percent move over the last n bars' },
  { id: 'highest', label: 'Highest high', params: ['bars'], defaults: [20], scale: 'price', about: 'the highest high of the previous n bars (not this one)' },
  { id: 'lowest', label: 'Lowest low', params: ['bars'], defaults: [20], scale: 'price', about: 'the lowest low of the previous n bars (not this one)' },
  { id: 'volSma', label: 'Volume SMA', params: ['period'], defaults: [20], scale: 'volume', about: 'average volume of the last n bars' },
]);

export const meta = (id: IndicatorId): IndicatorMeta => INDICATORS.find(m => m.id === id) || INDICATORS[0]!;

const NA = Number.NaN;
const n = (x: number | null | undefined): number => (x == null || !Number.isFinite(x) ? NA : x);

/** Period parameters, clamped to something a person meant (1..500 bars). */
export function param(o: IndOperand, which: 0 | 1): number {
  const m = meta(o.id), d = m.defaults[which] ?? 1;
  const raw = which === 0 ? o.p1 : o.p2;
  const v = raw != null && Number.isFinite(raw) ? raw : d;
  if (o.id === 'bbUpper' || o.id === 'bbLower') return which === 1 ? Math.min(5, Math.max(0.5, v)) : Math.min(500, Math.max(2, Math.round(v)));
  return Math.min(500, Math.max(1, Math.round(v)));
}

/** Rolling extreme of the PREVIOUS n bars — the bar itself is excluded, so a breakout can be seen. */
function prevExtreme(vals: readonly number[], nBars: number, hi: boolean): number[] {
  return vals.map((_, i) => {
    if (i < nBars) return NA;
    let x = hi ? -Infinity : Infinity;
    for (let j = i - nBars; j < i; j++) x = hi ? Math.max(x, vals[j]!) : Math.min(x, vals[j]!);
    return x;
  });
}

/** The whole series for one operand over the candles. A constant is the same value at every bar. */
export function series(o: Operand, bars: readonly Candle[]): number[] {
  if (o.kind === 'const') return bars.map(() => o.value);
  const c = bars.map(b => b.c);
  const warm = (arr: readonly number[], p: number): number[] => arr.map((v, i) => (i < p - 1 ? NA : v));
  switch (o.id) {
    case 'close': return c;
    case 'open': return bars.map(b => b.o);
    case 'high': return bars.map(b => b.h);
    case 'low': return bars.map(b => b.l);
    case 'volume': return bars.map(b => b.v);
    case 'sma': return warm(sma(c, param(o, 0)), param(o, 0));
    case 'ema': return warm(ema(c, param(o, 0)), param(o, 0));
    case 'rsi': return rsi(c, param(o, 0)).map((v, i) => (i < param(o, 0) ? NA : n(v)));
    case 'macd': { const p = param(o, 0), q = param(o, 1); return warm(macd(c, p, q, 9).line, Math.max(p, q)); }
    case 'macdSignal': { const p = param(o, 0), q = param(o, 1); return warm(macd(c, p, q, 9).sig, Math.max(p, q) + 9); }
    case 'macdHist': { const p = param(o, 0), q = param(o, 1); return warm(macd(c, p, q, 9).hist, Math.max(p, q) + 9); }
    case 'bbUpper': return bollinger(c, param(o, 0), param(o, 1)).upper.map(n);
    case 'bbLower': return bollinger(c, param(o, 0), param(o, 1)).lower.map(n);
    case 'bbMid': return bollinger(c, param(o, 0), 2).mid.map(n);
    case 'atr': return atr(bars, param(o, 0)).map(n);
    case 'roc': return roc(c, param(o, 0)).map(n);
    case 'highest': return prevExtreme(bars.map(b => b.h), param(o, 0), true);
    case 'lowest': return prevExtreme(bars.map(b => b.l), param(o, 0), false);
    case 'volSma': return warm(sma(bars.map(b => b.v), param(o, 0)), param(o, 0));
  }
}

/** "RSI(14)", "EMA(50)", "Close", "30" — how the desk names an operand. */
export function operandLabel(o: Operand): string {
  if (o.kind === 'const') return fmtNum(o.value);
  const m = meta(o.id);
  if (!m.params.length) return m.label;
  const ps = m.params.map((_, i) => param(o, i as 0 | 1));
  return m.label + '(' + ps.join(', ') + ')';
}

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 1 ? v.toFixed(2) : v.toPrecision(3);
}

/** The most bars any operand of the strategy needs before it can speak. */
export function warmup(ops: readonly Operand[]): number {
  let w = 2;
  for (const o of ops) {
    if (o.kind !== 'ind') continue;
    const m = meta(o.id);
    if (!m.params.length) continue;
    const p = param(o, 0), q = m.params.length > 1 && (o.id === 'macd' || o.id === 'macdSignal' || o.id === 'macdHist') ? param(o, 1) : 0;
    w = Math.max(w, Math.max(p, q) + (o.id.startsWith('macd') ? 10 : 1) + 1);
  }
  return w;
}
