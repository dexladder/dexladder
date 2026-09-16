import { h, type Child } from './h';
import { CX } from '../../design/classes';

export interface CardProps { readonly title?: string; readonly eyebrow?: string; readonly actions?: Child; readonly id?: string; readonly label?: string }

/** The one card surface. Header is optional; body is whatever the caller composes. */
export function Card(p: CardProps, ...body: Child[]): HTMLElement {
  const head = p.title || p.eyebrow
    ? h('div', { class: [CX.cardHead] },
        p.eyebrow ? h('span', { class: [CX.cardEyebrow] }, p.eyebrow) : null,
        p.title ? h('h3', { class: [CX.cardTitle] }, p.title) : null,
        p.actions || null)
    : null;
  return h('section', { class: [CX.card], ...(p.id ? { id: p.id } : {}), ...(p.label || p.title ? { aria: { label: p.label || p.title || '' } } : {}) },
    head, h('div', { class: [CX.cardBody] }, ...body));
}
