import { h } from './h';
import { CX } from '../../design/classes';

export interface TabItem { readonly id: string; readonly label: string; readonly href?: string; readonly title?: string }
export interface TabsProps { readonly items: readonly TabItem[]; readonly active: string | null; readonly label: string; onSelect(id: string): void }

/** A horizontal tab strip (links when an item has an href, buttons otherwise). */
export function Tabs(p: TabsProps): HTMLElement {
  return h('nav', { class: [CX.tabs], aria: { label: p.label } }, ...p.items.map(it => {
    const on = it.id === p.active;
    return h(it.href ? 'a' : 'button', {
      class: [CX.tab, on && CX.on],
      ...(it.href ? { href: it.href } : { type: 'button' }),
      ...(it.title ? { title: it.title } : {}),
      data: { id: it.id },
      ...(on ? { aria: { current: 'page' } } : {}),
      on: { click: (e: Event) => { e.preventDefault(); p.onSelect(it.id); } },
    }, it.label);
  }));
}
