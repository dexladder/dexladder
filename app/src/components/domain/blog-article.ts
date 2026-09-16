import { h } from '../ui/h';
import { Badge } from '../ui/badge';
import { CX } from '../../design/classes';
import { Prose } from './prose';
import { cover } from './figures';
import { metaLine } from './blog-index';
import type { Article, PostMeta } from '../../lib/blog/posts';

export interface BlogArticleProps {
  readonly article: Article;
  /** the table of contents starts open (wide screens) or folded (phones) */
  readonly tocOpen: boolean;
  date(iso: string): string;
  /** scroll to a heading without touching the hash (the hash is the router's) */
  jump(id: string): void;
}

function navLink(dir: 'Previous' | 'Next', m: PostMeta | null): HTMLElement | null {
  return m ? h('a', { class: [CX.artNavLink], href: '#/blog/' + m.slug, attrs: { rel: dir === 'Next' ? 'next' : 'prev' } },
    h('span', { class: [CX.artNavDir] }, dir === 'Next' ? 'Next →' : '← Previous'), m.title) : null;
}

/** One post: crumb, header with read time and last-updated date, contents, prose, previous / next. */
export function BlogArticle(p: BlogArticleProps): HTMLElement {
  const a = p.article;
  const toc = a.toc.length
    ? h('details', { class: [CX.toc], attrs: p.tocOpen ? { open: '' } : {} },
        h('summary', { class: [CX.tocTitle] }, 'On this page'),
        h('ol', { class: [CX.tocList] }, ...a.toc.map(t => h('li', {},
          h('a', { href: '#/blog/' + a.slug, data: { to: t.id }, on: { click: e => { e.preventDefault(); p.jump(t.id); } } }, t.text)))))
    : null;
  return h('article', { class: [CX.blog, CX.article], id: 'dlxBlog', data: { view: 'article', slug: a.slug }, aria: { labelledby: 'dlxArtTitle' } },
    h('nav', { class: [CX.artCrumb], aria: { label: 'Breadcrumb' } }, h('a', { href: '#/blog' }, 'Blog'), h('span', { aria: { hidden: 'true' } }, '/'), h('span', {}, a.tag)),
    h('header', { class: [CX.artHead] },
      h('div', { class: [CX.blogMeta] }, Badge(a.tag, 'neutral')),   // on the page ground, info tint is 4.36:1 in Day — neutral passes AA
      h('h1', { class: [CX.artTitle], id: 'dlxArtTitle' }, a.title),
      h('p', { class: [CX.artLede] }, a.summary),
      metaLine(a, p.date)),
    (c => (c ? h('div', { class: [CX.cover] }, c as unknown as HTMLElement) : null))(cover(a.slug)),
    h('div', { class: [CX.artLayout] }, toc, Prose(a.blocks)),
    h('nav', { class: [CX.artNav], aria: { label: 'More posts' } }, navLink('Previous', a.prev), navLink('Next', a.next)));
}
