import { h, type Child } from '../ui/h';
import { CX } from '../../design/classes';
import type { Block, Inline } from '../../lib/blog/markdown';
import { figure } from './figures';

/**
 * Renders parsed blog blocks. Text is always text: a post is data (lib/blog/markdown.ts), so no
 * string from a post ever becomes markup. In-app links (#/…) route through the app's hash router;
 * https links open in a new tab without an opener.
 */
function spans(c: readonly Inline[]): Child[] {
  return c.map(x => {
    switch (x.t) {
      case 'text': return x.v;
      case 'code': return h('code', {}, x.v);
      case 'b': return h('b', {}, ...spans(x.c));
      case 'i': return h('i', {}, ...spans(x.c));
      case 'a': return x.href.startsWith('#/')
        ? h('a', { href: x.href }, ...spans(x.c))
        : h('a', { href: x.href, attrs: { target: '_blank', rel: 'noopener noreferrer' } }, ...spans(x.c));
    }
  });
}

function Figure(id: string, caption: string): HTMLElement | null {
  const art = figure(id);
  return art ? h('figure', { class: [CX.fig], data: { fig: id } }, h('div', { class: [CX.figCanvas] }, art as unknown as HTMLElement), caption ? h('figcaption', { class: [CX.figCap] }, caption) : null) : null;
}

function block(b: Block): HTMLElement | null {
  switch (b.t) {
    case 'h2': case 'h3': return h(b.t, { id: b.id }, b.text);
    case 'p': return h('p', {}, ...spans(b.c));
    case 'quote': return h('aside', { class: [CX.callout], role: 'note' }, ...spans(b.c));
    case 'ul': case 'ol': return h(b.t, {}, ...b.items.map(i => h('li', {}, ...spans(i))));
    case 'pre': return h('pre', { attrs: { tabindex: '0' }, aria: { label: 'Formula' } }, h('code', {}, b.v));
    case 'hr': return h('hr');
    case 'figure': return Figure(b.id, b.caption);
    case 'table': return h('div', { class: [CX.proseTable], role: 'region', aria: { label: 'Table' }, attrs: { tabindex: '0' } },
      h('table', {},
        h('thead', {}, h('tr', {}, ...b.head.map(c => h('th', { attrs: { scope: 'col' } }, ...spans(c))))),
        h('tbody', {}, ...b.rows.map(r => h('tr', {}, ...r.map(c => h('td', {}, ...spans(c))))))));
  }
}

export function Prose(blocks: readonly Block[]): HTMLElement {
  return h('div', { class: [CX.prose] }, ...blocks.map(block));
}
