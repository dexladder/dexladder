import { h, type Child } from './h';
import { CX } from '../../design/classes';

export interface Cell { readonly content: Child; readonly num?: boolean; readonly end?: boolean; readonly title?: string }
export interface RowProps { readonly cells: readonly Cell[]; readonly cols?: string; readonly onSelect?: () => void; readonly label?: string }

/** A grid row. Column template comes in as the --cols custom property, never as a style string. */
export function TableRow(p: RowProps): HTMLElement {
  const interactive = !!p.onSelect;
  return h('div', {
    class: [CX.row],
    role: interactive ? 'button' : 'row',
    ...(p.cols ? { vars: { '--cols': p.cols } } : {}),
    ...(interactive ? { attrs: { tabindex: '0' }, on: { click: () => p.onSelect!(), keydown: (e: Event) => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); p.onSelect!(); } } } } : {}),
    ...(p.label ? { aria: { label: p.label } } : {}),
  }, ...p.cells.map(c => h('span', { class: [CX.cell, c.num && CX.cellNum, c.end && CX.cellEnd], ...(interactive ? {} : { role: 'cell' }), ...(c.title ? { title: c.title } : {}) }, c.content)));
}
