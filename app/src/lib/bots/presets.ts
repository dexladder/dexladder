/**
 * Starting points for the rule builder — the classic strategies every trading book teaches,
 * written as data so a learner can read exactly what each one does, then change it.
 */
import type { ConstOperand, IndicatorId, IndOperand, Strategy } from './types';

const ind = (id: IndicatorId, p1?: number, p2?: number): IndOperand =>
  ({ kind: 'ind', id, ...(p1 != null ? { p1 } : {}), ...(p2 != null ? { p2 } : {}) });
const k = (value: number): ConstOperand => ({ kind: 'const', value });

export interface Preset { readonly id: string; readonly label: string; readonly about: string; readonly strategy: Strategy }

export const PRESETS: readonly Preset[] = Object.freeze([
  {
    id: 'rsi', label: 'RSI mean reversion', about: 'Buys a washed-out market, sells when strength returns. Wins in ranges, bleeds in trends.',
    strategy: { v: 1, name: 'RSI mean reversion', entryLogic: 'all', exitLogic: 'any',
      entry: [{ left: ind('rsi', 14), op: '<', right: k(30) }],
      exit: [{ left: ind('rsi', 14), op: '>', right: k(60) }],
      risk: { stakePct: 0.5, stopLossPct: 4, cooldownBars: 2 } },
  },
  {
    id: 'ema', label: 'EMA trend cross', about: 'Rides trends: in when the fast average crosses above the slow one, out when it crosses back. Whipsaws sideways.',
    strategy: { v: 1, name: 'EMA 20/50 cross', entryLogic: 'all', exitLogic: 'all',
      entry: [{ left: ind('ema', 20), op: 'crossAbove', right: ind('ema', 50) }],
      exit: [{ left: ind('ema', 20), op: 'crossBelow', right: ind('ema', 50) }],
      risk: { stakePct: 0.8, trailingPct: 6, cooldownBars: 0 } },
  },
  {
    id: 'bb', label: 'Bollinger bounce', about: 'Buys a close below the lower band, sells at the middle. A volatility-adjusted mean reversion.',
    strategy: { v: 1, name: 'Bollinger bounce', entryLogic: 'all', exitLogic: 'any',
      entry: [{ left: ind('close'), op: '<', right: ind('bbLower', 20, 2) }],
      exit: [{ left: ind('close'), op: '>', right: ind('bbMid', 20) }],
      risk: { stakePct: 0.5, stopLossPct: 5, cooldownBars: 1 } },
  },
  {
    id: 'macd', label: 'MACD momentum', about: 'Buys when momentum turns up above the zero line, sells when the histogram turns down.',
    strategy: { v: 1, name: 'MACD momentum', entryLogic: 'all', exitLogic: 'any',
      entry: [{ left: ind('macdHist', 12, 26), op: 'crossAbove', right: k(0) }, { left: ind('macd', 12, 26), op: '>', right: k(0) }],
      exit: [{ left: ind('macdHist', 12, 26), op: 'crossBelow', right: k(0) }],
      risk: { stakePct: 0.6, stopLossPct: 5, takeProfitPct: 10, cooldownBars: 0 } },
  },
  {
    id: 'breakout', label: 'Breakout', about: 'Buys a close above the last 20 bars’ high on above-average volume; a trailing stop does the selling.',
    strategy: { v: 1, name: '20-bar breakout', entryLogic: 'all', exitLogic: 'all',
      entry: [{ left: ind('close'), op: '>', right: ind('highest', 20) }, { left: ind('volume'), op: '>', right: ind('volSma', 20) }],
      exit: [{ left: ind('close'), op: '<', right: ind('lowest', 10) }],
      risk: { stakePct: 0.7, trailingPct: 5, cooldownBars: 3 } },
  },
]);

export const preset = (id: string): Preset | undefined => PRESETS.find(p => p.id === id);

/** A blank strategy the builder starts from when the user wants nothing pre-filled. */
export const BLANK: Strategy = Object.freeze({
  v: 1, name: 'My bot', entryLogic: 'all', exitLogic: 'any', entry: [], exit: [],
  risk: { stakePct: 0.5, stopLossPct: 5, cooldownBars: 1 },
});
