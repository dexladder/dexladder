import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { TradeInput } from '../ui/trade-input';
import { Segmented } from '../ui/segmented';
import type { PerpMode, PerpSide } from '../../lib/perps/types';

export interface PerpTicketProps {
  readonly sym: string;
  readonly mode: PerpMode;
  readonly maxLev: number;
  readonly lev: number;
  readonly margin: string;
  readonly sl: string;
  readonly tp: string;
  /** "Wallet 9,899.50 USDT" */
  readonly wallet: string;
  onMargin(raw: string): void;
  onLev(lev: number): void;
  onSl(raw: string): void;
  onTp(raw: string): void;
  onSide(side: PerpSide): void;
}

/** The leverage steps offered as one-tap choices: the teachable ones, never above the ceiling. */
export function levChoices(mode: PerpMode, maxLev: number): number[] {
  const steps = mode === 'beginner' ? [2, 3, 5, 10] : [2, 5, 10, 20, 25, 50];
  return steps.filter(x => x <= maxLev);
}

/**
 * The perp order ticket: margin, leverage, optional stop-loss / take-profit, Long / Short.
 * Advanced adds a free leverage slider up to the market's ceiling. It holds no state — every
 * change is reported and the view re-renders only the preview, so focus stays where it is.
 */
export function PerpTicket(p: PerpTicketProps): HTMLElement {
  const choices = levChoices(p.mode, p.maxLev);
  const slider = p.mode === 'advanced'
    ? h('label', { class: [CX.field], attrs: { for: 'dlpLev' } },
      h('span', { class: [CX.fieldLabel] }, 'Leverage ' + p.lev + '× · up to ' + p.maxLev + '×'),
      h('input', {
        id: 'dlpLev', class: [CX.range], type: 'range',
        attrs: { min: '1', max: String(p.maxLev), step: '1', value: String(p.lev), 'aria-valuetext': p.lev + '×' },
        on: { input: e => p.onLev(parseInt((e.target as HTMLInputElement).value, 10) || 1) },
      }))
    : null;
  return h('div', { class: [CX.perp], id: 'dlpTicket' },
    TradeInput({ id: 'dlpMargin', label: 'Margin · ' + p.wallet, unit: 'USDT', value: p.margin, placeholder: '100', onInput: (_n, raw) => p.onMargin(raw) }),
    Segmented({
      id: 'dlpLevSeg', label: 'Leverage', value: String(p.lev),
      options: choices.map(x => ({ value: String(x), label: x + '×', title: 'A ' + (100 / x).toFixed(x > 20 ? 1 : 0) + '% move against you erases the margin' })),
      onChange: val => p.onLev(parseInt(val, 10)),
    }),
    slider,
    h('div', { class: [CX.perpGrid] },
      TradeInput({ id: 'dlpSl', label: 'Stop-loss (optional)', unit: 'USDT', value: p.sl, placeholder: 'none', onInput: (_n, raw) => p.onSl(raw) }),
      TradeInput({ id: 'dlpTp', label: 'Take-profit (optional)', unit: 'USDT', value: p.tp, placeholder: 'none', onInput: (_n, raw) => p.onTp(raw) })),
    h('div', { class: [CX.perpBtns] },
      h('button', { id: 'dlpLong', class: [CX.long], type: 'button', on: { click: () => p.onSide('long') } }, 'Long ' + p.sym),
      h('button', { id: 'dlpShort', class: [CX.short], type: 'button', on: { click: () => p.onSide('short') } }, 'Short ' + p.sym)));
}
