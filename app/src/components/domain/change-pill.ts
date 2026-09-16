import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { signStatus } from '../../design/tokens';

/**
 * A signed percentage coloured by direction. Missing data reads "Unavailable" — never 0.00%,
 * which would be a claim (the product law: missing renders Unavailable, never zero).
 */
export function ChangePill(pct: number | null | undefined, digits = 2): HTMLElement {
  if (pct == null || !Number.isFinite(pct)) return h('span', { class: [CX.change, CX.unavailable], title: 'No data from any source right now' }, 'Unavailable');
  const s = signStatus(pct);
  const txt = (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct).toFixed(digits) + '%';
  return h('span', { class: [CX.change, CX[s]], aria: { label: (pct > 0 ? 'up ' : pct < 0 ? 'down ' : 'flat ') + Math.abs(pct).toFixed(digits) + ' percent' } }, txt);
}
