import { h, type Child } from './h';
import { CX } from '../../design/classes';

export interface StatProps { readonly label: string; readonly value: Child; readonly hint?: string }

/** Label over a tabular figure, with an optional hint line. */
export function Stat(p: StatProps): HTMLElement {
  return h('div', { class: [CX.stat] },
    h('span', { class: [CX.statLabel] }, p.label),
    h('span', { class: [CX.statValue] }, p.value),
    p.hint ? h('span', { class: [CX.statHint] }, p.hint) : null);
}
