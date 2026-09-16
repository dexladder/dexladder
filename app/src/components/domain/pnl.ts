import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { signStatus } from '../../design/tokens';

export type Money = (usd: number) => string;

/** Profit and loss: signed money over a signed percent, both coloured by the same direction. */
export function PnlCell(usd: number | null | undefined, pct: number | null | undefined, money: Money): HTMLElement {
  if (usd == null || !Number.isFinite(usd)) return h('span', { class: [CX.pnl, CX.unavailable] }, 'Unavailable');
  const s = signStatus(usd), sign = usd > 0 ? '+' : usd < 0 ? '−' : '';
  return h('span', { class: [CX.pnl, CX[s]] },
    h('b', {}, sign + money(Math.abs(usd))),
    pct == null || !Number.isFinite(pct) ? null : h('small', {}, sign + Math.abs(pct).toFixed(2) + '%'));
}
