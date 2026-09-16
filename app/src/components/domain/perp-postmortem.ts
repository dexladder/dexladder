import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Pill } from '../ui/pill';
import type { PostMortem } from '../../lib/perps/liquidation';

export interface PostMortemProps {
  readonly pm: PostMortem;
  onDismiss(): void;
  /** the Academy's leverage lesson, when the view has one */
  readonly learn?: { readonly label: string; open(): void };
}

/**
 * The liquidation, explained: what happened in order, then three things that would have changed
 * it — each marked with whether it would have survived the very price that closed the position.
 */
export function PostMortemCard(p: PostMortemProps): HTMLElement {
  return h('div', { class: [CX.pm], id: 'dlpPm', role: 'alert', aria: { label: p.pm.headline } },
    h('div', { class: [CX.perpHead] }, h('span', {}, '⚠ ' + p.pm.headline),
      h('div', { class: [CX.perpBtns] }, h('button', { class: [CX.btn], type: 'button', on: { click: () => p.onDismiss() } }, 'Got it'))),
    h('ol', { class: [CX.pmList] }, ...p.pm.facts.map(t => h('li', {}, t))),
    h('div', { class: [CX.previewHead] }, h('span', {}, 'What would have changed it')),
    h('ul', { class: [CX.pmList] }, ...p.pm.alternatives.map(a => h('li', {},
      h('b', {}, a.label + ' '),
      a.survives === null ? null : Pill({ status: a.survives ? 'good' : 'bad', text: a.survives ? 'would have survived' : 'still liquidated' }),
      ' ' + a.text))),
    p.learn ? h('a', { href: '#', on: { click: e => { e.preventDefault(); p.learn!.open(); } } }, p.learn.label + ' →') : null);
}
