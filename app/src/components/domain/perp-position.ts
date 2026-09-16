import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Badge } from '../ui/badge';
import { Stat } from '../ui/stat';
import { PnlCell } from './pnl';
import { distancePct, liqPrice, marginRatio, removableMargin, roe, uPnl } from '../../lib/perps/margin';
import { nextSettlement, payment } from '../../lib/perps/funding';
import type { PerpPosition } from '../../lib/perps/types';

export interface PerpPositionProps {
  readonly p: PerpPosition;
  readonly mark: number;
  readonly rate8h: number;
  readonly now: number;
  fmt(n: number): string;
  onClose(fraction: number): void;
  onMargin(delta: number): void;
  /** set a stop-loss half-way between the mark and the liquidation price */
  onStop(price: number): void;
}

/** "3h 12m" / "42m" / "now" */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60000), hh = Math.floor(m / 60);
  return hh ? hh + 'h ' + (m % 60) + 'm' : m + 'm';
}

const usd = (n: number): string => Math.abs(n).toFixed(2) + ' USDT';
const btn = (label: string, fn: () => void, title?: string) =>
  h('button', { class: [CX.btn], type: 'button', ...(title ? { title } : {}), on: { click: fn } }, label);

/**
 * One open perp: where it is, where it dies, and how close that is. The margin-ratio meter fills
 * toward 100% (= liquidation); past 80% the card says so in words.
 */
export function PerpPositionCard(x: PerpPositionProps): HTMLElement {
  const { p, mark, fmt } = x, long = p.side === 'long', adv = p.mode === 'advanced';
  const L = liqPrice(p), ratio = Math.min(1, marginRatio(p, mark)), dist = distancePct(p, mark);
  const st = ratio >= 0.8 ? 'bad' : ratio >= 0.5 ? 'warn' : 'good';
  const next = nextSettlement(Math.max(p.lastFundingAt, x.now), p.fundingHours) - x.now;
  const nextPay = payment(p, mark, x.rate8h, p.fundingHours);
  const spare = removableMargin(p, mark);
  const stopAt = long ? mark - (mark - L) / 2 : mark + (L - mark) / 2;
  return h('div', { class: [CX.perpPos], data: { perp: p.id }, role: 'group', aria: { label: `${p.sym} ${p.lev}× ${p.side}` } },
    h('div', { class: [CX.perpHead] },
      Badge(p.lev + '× ' + p.side, long ? 'good' : 'bad'), h('span', {}, p.sym + '-PERP · isolated'),
      h('div', { class: [CX.perpBtns] },
        adv ? btn('25%', () => x.onClose(0.25), 'Close a quarter at market') : null,
        adv ? btn('50%', () => x.onClose(0.5), 'Close half at market') : null,
        btn('Close', () => x.onClose(1), 'Close the whole position at market'))),
    h('div', { class: [CX.perpGrid] },
      Stat({ label: 'Entry', value: fmt(p.entry) }),
      Stat({ label: 'Mark', value: fmt(mark) }),
      Stat({ label: 'Liquidation', value: fmt(L), hint: dist.toFixed(2) + '% away' }),
      Stat({ label: 'Unrealised P&L', value: PnlCell(uPnl(p, mark), roe(p, mark), n => n.toFixed(2)) }),
      Stat({ label: 'Margin', value: p.margin.toFixed(2), hint: 'ratio ' + (ratio * 100).toFixed(1) + '%' }),
      Stat({ label: 'Funding', value: (p.funding > 0 ? '−' : p.funding < 0 ? '+' : '') + Math.abs(p.funding).toFixed(2),
        hint: 'next in ' + countdown(next) + ' · ' + (nextPay >= 0 ? 'pay ' : 'get ') + usd(nextPay) })),
    h('div', { class: [CX.meter], role: 'meter', title: 'Margin ratio — liquidation at 100%',
      aria: { label: 'Margin ratio', valuenow: (ratio * 100).toFixed(0), valuemin: '0', valuemax: '100' } },
      h('div', { class: [CX.meterFill, CX[st]], vars: { '--pct': (ratio * 100).toFixed(1) + '%' } })),
    ratio >= 0.8
      ? h('div', { class: [CX.previewNote, CX.bad], role: 'alert' },
        `Liquidation is close: the maintenance margin is ${(ratio * 100).toFixed(0)}% of what is left. A further ${dist.toFixed(2)}% ${long ? 'fall' : 'rise'} closes this position and keeps all ${usd(p.margin)}. `
        + (adv ? 'Add margin, cut the size, or close it yourself.' : 'Close it yourself, or set a stop.'))
      : null,
    h('div', { class: [CX.perpLine] },
      p.sl || p.tp ? 'Protection: ' + [p.sl ? 'stop ' + fmt(p.sl) : '', p.tp ? 'take-profit ' + fmt(p.tp) : ''].filter(Boolean).join(' · ') : 'No stop-loss — liquidation is your only exit. ',
      !p.sl ? btn('Stop half-way to liquidation (' + fmt(stopAt) + ')', () => x.onStop(stopAt)) : null),
    adv
      ? h('div', { class: [CX.perpBtns] },
        btn('+25% margin', () => x.onMargin(p.margin * 0.25), 'Moves the liquidation price away'),
        spare > 0.01 ? btn('Remove ' + spare.toFixed(2) + ' spare', () => x.onMargin(-spare), 'Back to the initial margin — liquidation moves closer') : null)
      : null);
}
