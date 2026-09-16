import { h } from './h';
import { CX } from '../../design/classes';

export interface SegOption { readonly value: string; readonly label: string; readonly title?: string }
export interface SegmentedProps { readonly id: string; readonly label: string; readonly options: readonly SegOption[]; readonly value: string; onChange(value: string): void }

/** A one-of-N choice as a radio group (arrow keys move, like a native radio set). */
export function Segmented(p: SegmentedProps): HTMLElement {
  const group = h('div', { class: [CX.seg], role: 'radiogroup', id: p.id + '-g', aria: { labelledby: p.id + '-l' } }, ...p.options.map(o => {
    const on = o.value === p.value;
    return h('button', {
      class: [CX.segBtn, on && CX.on], type: 'button', role: 'radio', data: { value: o.value },
      aria: { checked: on ? 'true' : 'false' }, attrs: { tabindex: on ? '0' : '-1' }, ...(o.title ? { title: o.title } : {}),
      on: {
        click: () => p.onChange(o.value),
        keydown: (e: Event) => {
          const k = (e as KeyboardEvent).key, i = p.options.findIndex(x => x.value === o.value);
          const j = k === 'ArrowRight' || k === 'ArrowDown' ? i + 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? i - 1 : -99;
          const nx = p.options[(j + p.options.length) % p.options.length];
          if (j !== -99 && nx) { e.preventDefault(); p.onChange(nx.value); }
        },
      },
    }, o.label);
  }));
  return h('div', { class: [CX.realism], id: p.id }, h('span', { class: [CX.segLabel], id: p.id + '-l' }, p.label), group);
}
