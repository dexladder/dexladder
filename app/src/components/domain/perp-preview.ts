import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Badge } from '../ui/badge';
import type { OpenCheck } from '../../lib/perps/position';
import type { PerpMode, PerpSide } from '../../lib/perps/types';

export interface PerpPreviewProps {
  readonly check: OpenCheck | null;
  readonly side: PerpSide;
  readonly sym: string;
  readonly mode: PerpMode;
  fmt(n: number): string;
}

const money = (n: number): string => Math.abs(n).toFixed(2) + ' USDT';

/**
 * What the position will be BEFORE it exists: size, entry, the liquidation price and how far
 * away it is, the maintenance margin, fees, the funding it pays per settlement — and the one
 * sentence that matters most: how much of a move erases the margin at this leverage.
 */
export function PerpPreview(p: PerpPreviewProps): HTMLElement {
  const c = p.check, q = c ? c.quote : undefined;
  const row = (k: string, val: string) => h('div', { class: [CX.previewRow] }, h('span', {}, k), h('b', {}, val));
  const head = h('div', { class: [CX.previewHead] }, h('span', {}, 'If you go ' + p.side + ' now'),
    Badge(p.mode === 'advanced' ? 'Order book · slippage' : 'Fills at mark', p.mode === 'advanced' ? 'info' : 'neutral'));
  if (!q) {
    return h('div', { class: [CX.preview], id: 'dlpPrev', role: 'group', aria: { label: 'Position preview' } }, head,
      h('div', { class: [CX.previewNote, c ? CX.bad : CX.neutral], role: c ? 'alert' : 'status' },
        c && !c.ok ? c.why : 'Enter a margin to see the liquidation price before you open anything.'));
  }
  const x = q.position, long = p.side === 'long', f = p.fmt;
  return h('div', { class: [CX.preview], id: 'dlpPrev', role: 'group', aria: { label: 'Position preview' } }, head,
    row('Position size', money(q.notional) + ' · ' + f(x.qty) + ' ' + p.sym),
    row('Entry ≈', f(x.entry)),
    row('Liquidation price', f(q.liq) + ' (' + (long ? '−' : '+') + q.distPct.toFixed(2) + '%)'),
    row('Maintenance margin', (q.mmr * 100).toFixed(2) + '% of the position'),
    row('Open fee', money(q.openFee) + ' (' + (x.takerFee * 100).toFixed(3) + '%)'),
    row('Funding each ' + x.fundingHours + 'h', (q.fundingPerSettlement >= 0 ? 'you pay ' : 'you receive ') + money(q.fundingPerSettlement)),
    row('If liquidated you lose', money(q.worstCase)),
    c && !c.ok ? h('div', { class: [CX.previewNote, CX.bad], role: 'alert' }, c.why) : null,
    h('div', { class: [CX.previewNote, q.distPct < 5 ? CX.warn : CX.neutral] },
      `At ${x.lev}× a ${(100 / x.lev).toFixed(x.lev > 20 ? 1 : 0)}% move ${long ? 'down' : 'up'} would erase your margin; `
      + `the maintenance margin brings liquidation forward to ${q.distPct.toFixed(2)}% away, at ${f(q.liq)}. `
      + (x.sl ? `Your stop at ${f(x.sl)} exits first.` : 'A stop-loss before that price limits the damage — liquidation takes everything.')));
}
