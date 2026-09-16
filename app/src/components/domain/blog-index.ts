import { h } from '../ui/h';
import { Badge } from '../ui/badge';
import { CX } from '../../design/classes';
import type { IndexEntry } from '../../lib/blog/posts';
import { cover } from './figures';

export interface BlogIndexProps {
  readonly posts: readonly IndexEntry[];
  /** a slug someone linked to that does not exist (typo, or a post that never shipped) */
  readonly missing?: string | null;
  date(iso: string): string;
}

/** "N min read · Updated 11 Sep 2026 · since v156" */
export function metaLine(p: { readonly minutes: number; readonly updated: string; readonly since: string }, date: (iso: string) => string): HTMLElement {
  return h('div', { class: [CX.blogMeta] },
    h('span', {}, p.minutes + ' min read'), h('span', { aria: { hidden: 'true' } }, '·'),
    h('span', {}, 'Updated ', h('time', { attrs: { datetime: p.updated } }, date(p.updated))), h('span', { aria: { hidden: 'true' } }, '·'),
    h('span', {}, 'since ' + p.since));
}

/** The Blog's front page: the first post featured, the rest in a responsive grid. */
export function BlogIndex(p: BlogIndexProps): HTMLElement {
  const card = (e: IndexEntry, i: number) => h('a', { class: [CX.blogCard, i === 0 && CX.blogFeature], href: '#/blog/' + e.slug, data: { slug: e.slug } },
    (c => (c ? h('div', { class: [CX.cover, i > 0 && CX.coverCard] }, c as unknown as HTMLElement) : null))(cover(e.slug)),
    h('div', { class: [CX.blogMeta] }, Badge(e.tag, i === 0 ? 'info' : 'neutral')),
    h('h2', { class: [CX.blogCardTitle] }, e.title),
    h('p', { class: [CX.blogCardText] }, e.summary),
    metaLine(e, p.date));
  return h('div', { class: [CX.blog], id: 'dlxBlog', data: { view: 'index' } },
    h('header', { class: [CX.blogHead] },
      h('span', { class: [CX.blogKicker] }, 'Academy · Blog'),
      h('h1', { class: [CX.blogTitle] }, 'The DexLadder Blog'),
      h('p', { class: [CX.blogLede] }, 'Long-form guides to how DexLadder works and why: the trading engine, the Academy, privacy by design, and the engineering behind a desk that runs entirely on your device.')),
    p.missing ? h('p', { class: [CX.blogNote], role: 'status' }, 'There is no post at “' + p.missing + '”. Here is everything that has been published.') : null,
    h('nav', { class: [CX.blogGrid], aria: { label: 'All posts' } }, ...p.posts.map(card)));
}
