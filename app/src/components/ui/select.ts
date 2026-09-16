import { h } from './h';
import { CX } from '../../design/classes';

export interface SelectOption { readonly value: string; readonly label: string }
export interface SelectProps { readonly id: string; readonly label: string; readonly options: readonly SelectOption[]; readonly value: string; onChange(value: string): void }

/** A native one-of-many control (long lists, dates, anything a segmented control would crowd). */
export function Select(p: SelectProps): HTMLElement {
  const sel = h('select', { id: p.id, class: [CX.select], on: { change: e => p.onChange((e.target as HTMLSelectElement).value) } },
    ...p.options.map(o => {
      const el = h('option', { attrs: { value: o.value } }, o.label);
      if (o.value === p.value) el.setAttribute('selected', 'selected');
      return el;
    }));
  (sel as HTMLSelectElement).value = p.value;
  return h('label', { class: [CX.field], attrs: { for: p.id } }, h('span', { class: [CX.fieldLabel] }, p.label), sel);
}
