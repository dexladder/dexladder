import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Select } from '../ui/select';
import { Segmented } from '../ui/segmented';
import { TradeInput } from '../ui/trade-input';
import type { IntervalId } from '../../lib/backtest';

export interface Era { readonly id: string; readonly label: string; readonly from: number; readonly to: number; readonly interval: IntervalId; readonly note: string }

export interface BtSetupProps {
  readonly coins: readonly string[];
  readonly sym: string;
  readonly eras: readonly Era[];
  readonly era: string;
  readonly interval: IntervalId;
  readonly from: string;
  readonly to: string;
  readonly cash: string;
  readonly note: string;
  readonly loading: boolean;
  onCoin(sym: string): void;
  onEra(id: string): void;
  onInterval(i: IntervalId): void;
  onDate(which: 'from' | 'to', value: string): void;
  onCash(raw: string): void;
  onLoad(): void;
}

/** Which coin, which stretch of history, which bar size, and how much paper cash to risk. */
export function BtSetup(p: BtSetupProps): HTMLElement {
  const custom = p.era === 'custom';
  const date = (which: 'from' | 'to', label: string, value: string) =>
    h('label', { class: [CX.field], attrs: { for: 'bt-' + which } },
      h('span', { class: [CX.fieldLabel] }, label),
      h('input', { id: 'bt-' + which, class: [CX.select], type: 'date', attrs: { value }, on: { change: e => p.onDate(which, (e.target as HTMLInputElement).value) } }));
  const load = h('button', { class: [CX.btn, CX.on], id: 'btLoad', type: 'button', on: { click: () => p.onLoad() } }, p.loading ? 'Loading…' : 'Load the range');
  if (p.loading) load.setAttribute('disabled', 'disabled');
  return h('div', { class: [CX.perp], id: 'btSetup' },
    h('div', { class: [CX.perpGrid] },
      Select({ id: 'btCoin', label: 'Market', value: p.sym, options: p.coins.map(s => ({ value: s, label: s + '/USDT' })), onChange: p.onCoin }),
      Select({ id: 'btEra', label: 'Range', value: p.era, options: [...p.eras.map(e => ({ value: e.id, label: e.label })), { value: 'custom', label: 'Custom dates…' }], onChange: p.onEra }),
      custom ? date('from', 'From', p.from) : null,
      custom ? date('to', 'To', p.to) : null,
      TradeInput({ id: 'btCash', label: 'Paper cash', unit: 'USDT', value: p.cash, placeholder: '10000', onInput: (_n, raw) => p.onCash(raw) })),
    Segmented({ id: 'btInterval', label: 'Bar size', value: p.interval, onChange: x => p.onInterval(x as IntervalId),
      options: [{ value: '1h', label: '1 hour' }, { value: '4h', label: '4 hours' }, { value: '1d', label: '1 day' }] }),
    h('div', { class: [CX.perpBtns] }, load),
    h('div', { class: [CX.perpLine], id: 'btNote' }, p.note));
}
