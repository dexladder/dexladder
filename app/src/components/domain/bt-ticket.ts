import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Stat } from '../ui/stat';
import { Segmented } from '../ui/segmented';
import { TradeInput } from '../ui/trade-input';
import type { BtOrder, BtOrderType, BtState } from '../../lib/backtest';

export interface BtTicketProps {
  readonly state: BtState;
  readonly sym: string;
  readonly price: number;
  readonly type: BtOrderType;
  readonly size: string;
  readonly px: string;
  readonly error: string | null;
  readonly ready: boolean;
  fmt(n: number): string;
  onType(t: BtOrderType): void;
  onSize(raw: string): void;
  onPx(raw: string): void;
  onSide(side: 'buy' | 'sell'): void;
  onPreset(fraction: number): void;
  onCancel(id: string): void;
}

const order = (o: BtOrder, fmt: (n: number) => string, cancel: (id: string) => void) =>
  h('div', { class: [CX.btLine] },
    h('span', {}, (o.side === 'buy' ? 'Buy ' : 'Sell ') + fmt(o.qty) + (o.px ? ' ' + o.type + ' @ ' + fmt(o.px) : ' at the next open')),
    h('button', { class: [CX.btn], type: 'button', title: 'Cancel this order', on: { click: () => cancel(o.id) } }, '✕'));

/** Orders for the replayed market: they fill on the bars that come next, never on the one you see. */
export function BtTicket(p: BtTicketProps): HTMLElement {
  const s = p.state, needsPx = p.type !== 'market';
  const held = s.qty * p.price;
  return h('div', { class: [CX.perp], id: 'btTicket' },
    h('div', { class: [CX.perpGrid] },
      Stat({ label: 'Cash', value: p.fmt(s.cash) }),
      Stat({ label: 'Position', value: (s.qty > 0 ? p.fmt(s.qty) : '0') + ' ' + p.sym, hint: s.qty > 0 ? p.fmt(held) + ' USDT' : 'flat' }),
      Stat({ label: 'Equity', value: p.fmt(s.cash + held) })),
    Segmented({ id: 'btType', label: 'Order type', value: p.type, onChange: x => p.onType(x as BtOrderType),
      options: [{ value: 'market', label: 'Market', title: 'Fills at the open of the next bar' }, { value: 'limit', label: 'Limit', title: 'Fills when a bar trades through your price' }, { value: 'stop', label: 'Stop', title: 'Fills when a bar trades through your price — a gap costs you' }] }),
    TradeInput({ id: 'btSize', label: 'Size · ' + p.sym, value: p.size, placeholder: '0.00', onInput: (_n, raw) => p.onSize(raw) }),
    needsPx ? TradeInput({ id: 'btPx', label: p.type === 'limit' ? 'Limit price' : 'Stop price', unit: 'USDT', value: p.px, placeholder: p.fmt(p.price), onInput: (_n, raw) => p.onPx(raw) }) : null,
    h('div', { class: [CX.perpBtns] }, ...[0.25, 0.5, 1].map(f =>
      h('button', { class: [CX.btn], type: 'button', title: 'Size to ' + f * 100 + '% of the cash (buy) or the position (sell)', on: { click: () => p.onPreset(f) } }, f === 1 ? 'Max' : f * 100 + '%'))),
    h('div', { class: [CX.perpBtns] },
      h('button', { class: [CX.long], id: 'btBuy', type: 'button', on: { click: () => p.onSide('buy') } }, 'Buy'),
      h('button', { class: [CX.short], id: 'btSell', type: 'button', on: { click: () => p.onSide('sell') } }, 'Sell')),
    p.error ? h('div', { class: [CX.previewNote, CX.bad], role: 'alert' }, p.error) : null,
    !p.ready ? h('div', { class: [CX.previewNote, CX.neutral] }, s.done
      ? 'The run is finished. Restart to trade the same bars again, or load another range.'
      : 'Step at least one bar before trading: an order placed now would fill at a price you have not seen.') : null,
    s.orders.length ? h('div', { class: [CX.btList], aria: { label: 'Working orders' } }, ...s.orders.map(o => order(o, p.fmt, p.onCancel))) : null);
}
