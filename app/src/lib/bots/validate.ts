/**
 * What a bot must get right before it may run — each refusal is a sentence the builder shows
 * next to the field, never a silent default.
 */
import { INDICATORS, meta } from './indicators';
import type { BotDef, BotInterval, Condition, Operand, Strategy } from './types';

export const INTERVALS: readonly BotInterval[] = Object.freeze(['1m', '5m', '15m', '1h', '4h', '1d']);
export const MIN_STAKE = 100;
export const MAX_STAKE = 10_000_000;
export const MAX_BOTS = 12;

export const isInterval = (x: string): x is BotInterval => (INTERVALS as readonly string[]).includes(x);

function operandOk(o: Operand, side: string, out: string[]): void {
  if (o.kind === 'const') { if (!Number.isFinite(o.value)) out.push(side + ': the number is not a number.'); return; }
  if (!INDICATORS.some(m => m.id === o.id)) { out.push(side + ': unknown indicator "' + String(o.id) + '".'); return; }
  const m = meta(o.id);
  if (m.params.length && o.p1 != null && !(o.p1 >= 1 && o.p1 <= 500)) out.push(side + ': ' + m.label + ' period must be 1–500 bars.');
  if (m.params.length > 1 && o.p2 != null && !(o.p2 > 0 && o.p2 <= 500)) out.push(side + ': ' + m.label + ' second parameter must be positive.');
}

function conditionOk(c: Condition, where: string, out: string[]): void {
  operandOk(c.left, where + ' left side', out);
  operandOk(c.right, where + ' right side', out);
  if (c.left.kind === 'const' && c.right.kind === 'const') out.push(where + ': comparing two numbers never changes — pick an indicator.');
  if (c.left.kind === 'ind' && c.right.kind === 'ind' && meta(c.left.id).scale !== meta(c.right.id).scale)
    out.push(where + ': ' + meta(c.left.id).label + ' and ' + meta(c.right.id).label + ' live on different scales — the comparison would be meaningless.');
  if (c.left.kind === 'ind' && c.right.kind === 'const' && meta(c.left.id).scale === 'oscillator' && !(c.right.value >= 0 && c.right.value <= 100))
    out.push(where + ': RSI runs 0–100 — ' + c.right.value + ' can never be reached.');
}

/** Every reason a strategy cannot run; empty means it can. */
export function validateStrategy(s: Strategy): string[] {
  const out: string[] = [];
  if (!s.name.trim()) out.push('Give the bot a name.');
  if (!s.entry.length) out.push('Add at least one entry condition — a bot that never buys is a savings account.');
  if (!s.exit.length && !s.risk.stopLossPct && !s.risk.takeProfitPct && !s.risk.trailingPct) out.push('Add an exit condition or a risk exit (stop, target or trailing stop) — otherwise the bot can never sell.');
  s.entry.forEach((c, i) => conditionOk(c, 'Entry ' + (i + 1), out));
  s.exit.forEach((c, i) => conditionOk(c, 'Exit ' + (i + 1), out));
  const r = s.risk;
  if (!(r.stakePct > 0 && r.stakePct <= 1)) out.push('Stake per entry must be between 1% and 100% of cash.');
  if (r.stopLossPct != null && !(r.stopLossPct > 0 && r.stopLossPct < 90)) out.push('Stop-loss must be between 0 and 90%.');
  if (r.takeProfitPct != null && !(r.takeProfitPct > 0 && r.takeProfitPct < 1000)) out.push('Take-profit must be positive.');
  if (r.trailingPct != null && !(r.trailingPct > 0 && r.trailingPct < 90)) out.push('Trailing stop must be between 0 and 90%.');
  if (!(r.cooldownBars >= 0 && r.cooldownBars <= 500)) out.push('Cooldown must be 0–500 bars.');
  return out;
}

/** The bot as a whole: wallet, market, and the source of its decisions. */
export function validateBot(b: BotDef): string[] {
  const out: string[] = [];
  if (!b.name.trim()) out.push('Give the bot a name.');
  if (!/^[A-Z0-9]{2,12}$/.test(b.sym)) out.push('Pick a market.');
  if (!isInterval(b.interval)) out.push('Pick a bar size.');
  if (!(b.stake >= MIN_STAKE && b.stake <= MAX_STAKE)) out.push('Stake the bot between ' + MIN_STAKE.toLocaleString('en-US') + ' and ' + MAX_STAKE.toLocaleString('en-US') + ' USDT of paper cash.');
  if (b.kind === 'rules') { if (!b.strategy) out.push('The bot has no rules.'); else out.push(...validateStrategy(b.strategy)); }
  if (b.kind === 'js' && !(b.code && b.code.trim().length > 10)) out.push('Paste the strategy’s JavaScript — it must define onBar(ctx).');
  if (b.kind === 'js' && b.code && !/onBar/.test(b.code)) out.push('The code never mentions onBar — DexLadder calls onBar(ctx) on every closed bar.');
  if (b.kind === 'signal') {
    const u = (b.url || '').trim();
    if (!u) out.push('Enter the URL your bot serves signals at, e.g. http://127.0.0.1:8787/signal');
    else if (!/^https?:\/\/[^\s]+$/i.test(u)) out.push('The signal URL must start with http:// or https://');
  }
  return out;
}
