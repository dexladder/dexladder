/**
 * The Blog inside the legacy router (view half). #/blog is the front page, #/blog/<slug> a post.
 * The legacy nav('blog') shows #page-blog and calls render(); open() is how everything else —
 * the router, the What's New banner, the command palette, the ticket — gets to a post.
 * Posts are bundled with the app: nothing is fetched, nothing is stored.
 */
import { article, index, prettyDate, POSTS } from '../lib/blog/posts';
import { BlogIndex } from '../components/domain/blog-index';
import { BlogArticle } from '../components/domain/blog-article';
import { legacy } from './globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const HOST = 'dlBlog';
/** The post that tells the story of the current release (the What's New banner links it). */
export const STORY = 'advanced-execution-engine';

let pending: string | null = null;

function jump(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** Paint #page-blog for the pending slug (or the front page) and put its address in the bar. */
export function render(): void {
  const host = document.getElementById(HOST);
  if (!host) return;
  const slug = pending; pending = null;
  const a = slug ? article(slug) : null;
  const wide = typeof matchMedia === 'function' && matchMedia('(min-width:1100px)').matches;
  host.replaceChildren(a
    ? BlogArticle({ article: a, tocOpen: wide, date: prettyDate, jump })
    : BlogIndex({ posts: index(), missing: slug && !a ? slug : null, date: prettyDate }));
  const hash = a ? '#/blog/' + a.slug : '#/blog';   // an alias resolves to the post's permanent address
  try { if (location.hash !== hash) history.replaceState(null, '', hash); } catch { /* file:// */ }
}

/** Open the front page (no slug) or a post. */
export function open(slug?: string | null): void {
  pending = slug || null;
  legacy.call('nav', 'blog');
}

export const story = (): void => open(STORY);

/** Command palette entries: the Blog, and every post by title. */
export function install(): void {
  const C = G.DLCORE;
  if (!C || typeof C.cmd !== 'function' || G.__dlxBlog) return;
  G.__dlxBlog = 1;
  C.cmd('blog', 'Blog — long-form guides to how DexLadder works', '📖', () => open(null));
  for (const p of POSTS) C.cmd('blog · ' + p.title, p.summary, '📖', () => open(p.slug));
}
