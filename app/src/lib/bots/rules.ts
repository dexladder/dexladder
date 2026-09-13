/**
 * The rule evaluator. A strategy is entry conditions, exit conditions and risk rules; this turns
 * them into one Signal per bar, with a reason a person can read: "RSI(14) 27.9 < 30 · Close
 * 61,240 > EMA(50) 60,870". A condition over a warm-up value never holds — the bot waits.
 */
import { fmtNum, operandLabel, series, warmup } from './indicators';
import type { Candle, Comparator, Condition, Operand, Signal, Strategy } from './types';

const OPS: Readonly<Record<Comparator, string>> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', crossAbove: 'crosses above', crossBelow: 'crosses below' };

export const comparatorLabel = (c: Comparator): string => OPS[c];

export function operands(s: Strategy): Operand[] {
  const out: Operand[] = [];
  for (const c of [...s.entry, ...s.exit]) out.push(c.left, c.right);
  return out;
}

export interface Checked { readonly holds: boolean; readonly text: string }

/** One condition on bar i (needs bar i−1 for a cross). */
export function check(c: Condition, bars: readonly Candle[], i: number, cache: Map<string, number[]>): Checked {
  const L = get(c.left, bars, cache), R = get(c.right, bars, cache);
  const l = L[i] ?? Number.NaN, r = R[i] ?? Number.NaN;
  const name = operandLabel(c.left) + ' ' + fmtNum(l) + ' ' + OPS[c.op] + ' ' + operandLabel(c.right) + (c.right.kind === 'const' ? '' : ' ' + fmtNum(r));
  if (!Number.isFinite(l) || !Number.isFinite(r)) return { holds: false, text: operandLabel(c.left) + ' ' + OPS[c.op] + ' ' + operandLabel(c.right) + ' · warming up' };
  switch (c.op) {
    case '>': return { holds: l > r, text: name };
    case '<': return { holds: l < r, text: name };
    case '>=': return { holds: l >= r, text: name };
    case '<=': return { holds: l <= r, text: name };
    case 'crossAbove': case 'crossBelow': {
      const pl = L[i - 1] ?? Number.NaN, pr = R[i - 1] ?? Number.NaN;
      if (!Number.isFinite(pl) || !Number.isFinite(pr)) return { holds: false, text: name + ' · no previous bar' };
      const holds = c.op === 'crossAbove' ? pl <= pr && l > r : pl >= pr && l < r;
      return { holds, text: name };
    }
  }
}

const key = (o: Operand): string => JSON.stringify(o);
function get(o: Operand, bars: readonly Candle[], cache: Map<string, number[]>): number[] {
  const k = key(o);
  let s = cache.get(k);
  if (!s) { s = series(o, bars); cache.set(k, s); }
  return s;
}

function group(cs: readonly Condition[], logic: 'all' | 'any', bars: readonly Candle[], i: number, cache: Map<string, number[]>): { holds: boolean; text: string } {
  if (!cs.length) return { holds: false, text: 'no conditions' };
  const rs = cs.map(c => check(c, bars, i, cache));
  const holds = logic === 'all' ? rs.every(r => r.holds) : rs.some(r => r.holds);
  return { holds, text: rs.map(r => (r.holds ? '✓ ' : '· ') + r.text).join(' · ') };
}

/**
 * The bot's decision on bar i, given whether it holds a position. Risk exits (stop, target,
 * trailing) are not here — they are checked against every mark by the wallet, not once per bar.
 * `cache` may be shared across bars: every indicator is causal, so a series computed over all
 * bars is exact at every i — the evaluator can never see past i.
 */
export function evaluate(s: Strategy, bars: readonly Candle[], i: number, holding: boolean, barsSinceExit: number, cache: Map<string, number[]> = new Map()): Signal {
  if (i < warmup(operands(s)) - 1) return { action: 'hold', reason: 'warming up · ' + (warmup(operands(s)) - 1 - i) + ' more bar(s) before the indicators are ready' };
  if (holding) {
    const g = group(s.exit, s.exitLogic, bars, i, cache);
    return g.holds ? { action: 'sell', size: 1, reason: 'exit · ' + g.text } : { action: 'hold', reason: 'holding · exit not met · ' + g.text };
  }
  if (barsSinceExit >= 0 && barsSinceExit < s.risk.cooldownBars) return { action: 'hold', reason: 'cooldown · ' + (s.risk.cooldownBars - barsSinceExit) + ' bar(s) left' };
  const g = group(s.entry, s.entryLogic, bars, i, cache);
  return g.holds ? { action: 'buy', size: s.risk.stakePct, reason: 'entry · ' + g.text } : { action: 'hold', reason: 'flat · entry not met · ' + g.text };
}

/** Plain English for the rules card: one line per condition. */
export function describe(s: Strategy): string[] {
  const out: string[] = [];
  const line = (c: Condition): string => operandLabel(c.left) + ' ' + OPS[c.op] + ' ' + operandLabel(c.right);
  out.push('Buy when ' + (s.entryLogic === 'all' ? 'all of' : 'any of') + ': ' + (s.entry.map(line).join('; ') || '—'));
  out.push('Sell when ' + (s.exitLogic === 'all' ? 'all of' : 'any of') + ': ' + (s.exit.map(line).join('; ') || '—'));
  const r = s.risk, bits = ['spend ' + Math.round(r.stakePct * 100) + '% of cash per entry'];
  if (r.stopLossPct) bits.push('stop-loss ' + r.stopLossPct + '%');
  if (r.takeProfitPct) bits.push('take-profit ' + r.takeProfitPct + '%');
  if (r.trailingPct) bits.push('trailing stop ' + r.trailingPct + '%');
  if (r.cooldownBars) bits.push('wait ' + r.cooldownBars + ' bar(s) after an exit');
  out.push('Risk: ' + bits.join(' · '));
  return out;
}
