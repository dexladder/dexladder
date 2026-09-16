import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, inline, safeHref, plain, slugify } from '../src/lib/blog/markdown';
import { POSTS, ALIASES, BLOG_SCHEMA, find, article, index, readMinutes, prettyDate, routeOf } from '../src/lib/blog/posts';

/** THE SLUG LOCK. Published slugs are permanent and in this order; add new ones at the end only. */
const PUBLISHED = [
  'what-is-dexladder',
  'advanced-execution-engine',
  'paper-vs-real-dex-trading',
  'academy-and-labs',
  'sovereignty-proof-ledger',
  'p2p-explorer-and-the-desk',
  'how-dexladder-is-built',
  'bots-build-and-bring',
  'rewind-and-backtesting',
  'perpetuals-funding-liquidation',
  'order-types-and-algos',
  'liquidity-desk-amms-and-il',
  'local-fork-sandbox',
  'dexai-on-device-copilot',
  'markets-and-the-data-ladder',
  'news-sentiment-and-attention',
  'portfolio-journal-and-record',
  'the-desks',
  'journey-quests-and-daily',
  'apps-offline-and-install',
  'day-night-and-the-design-system',
  'security-and-trust',
];

test('slug lock: every published slug still resolves, in order; new posts may only be appended', () => {
  assert.equal(BLOG_SCHEMA, 1);
  assert.deepEqual(POSTS.slice(0, PUBLISHED.length).map(p => p.slug), PUBLISHED);
  for (const s of PUBLISHED) assert.ok(find(s), s);
  assert.equal(new Set(POSTS.map(p => p.slug)).size, POSTS.length, 'unique');
  for (const [from, to] of Object.entries(ALIASES)) assert.ok(find(to) && find(from) === find(to), from);
  for (const p of POSTS) {
    assert.match(p.slug, /^[a-z0-9-]+$/); assert.match(p.updated, /^\d{4}-\d{2}-\d{2}$/); assert.match(p.since, /^v\d+/);
    assert.ok(p.rev >= 1 && p.title && p.summary.length > 40);
  }
});

test('every article is long-form, linked and on-brand', () => {
  const slugs = new Set(POSTS.map(p => p.slug));
  for (const p of POSTS) {
    const a = article(p.slug)!;
    assert.ok(a.minutes >= 3, p.slug + ' is long-form (' + a.minutes + ' min)');
    assert.ok(a.toc.length >= 4, p.slug + ' has sections');
    assert.ok(!p.body.includes('₿'), 'no Bitcoin symbol in blog chrome or copy');
    assert.ok(!/<[a-z]/i.test(p.body), 'no markup in a post');
    assert.ok(!/!\[|]\(http:|\.png|\.jpg|\.gif|\.webp/i.test(p.body), 'no image files: every illustration is drawn by the app');
    assert.ok(!/CoinBridge/i.test(p.body), 'retired name');
    for (const m of p.body.matchAll(/\]\((#\/blog\/[a-z0-9-]+)\)/g)) assert.ok(slugs.has(m[1]!.slice(7)), p.slug + ' links to ' + m[1]);
    for (const m of p.body.matchAll(/\]\(([^)]+)\)/g)) assert.ok(safeHref(m[1]!), 'every link is allowed: ' + m[1]);
  }
  assert.equal(article('what-is-dexladder')!.prev, null);
  assert.equal(article('what-is-dexladder')!.next!.slug, 'advanced-execution-engine');
  assert.equal(article('how-dexladder-is-built')!.next!.slug, 'bots-build-and-bring');
  assert.equal(article('security-and-trust')!.next, null);
  assert.equal(index().length, POSTS.length);
  assert.equal(find('nope'), null); assert.equal(article('nope'), null);
});

test('the engine article states the engine the code implements', async () => {
  const { TIER_MULT, GAS_UNITS } = await import('../src/lib/paper-engine/gas');
  const { MEV_MIN_TOLERANCE_PCT } = await import('../src/lib/paper-engine/mev');
  const { DEX_TVL_PER_VOL, DEX_MIN_TVL, NEAR_ZERO_POOL_USD, MIN_FILL_FRACTION } = await import('../src/lib/paper-engine/impact');
  const { TOLERANCES } = await import('../src/legacy/ticket-view');
  const b = find('advanced-execution-engine')!.body;
  const has = (s: string) => assert.ok(b.includes(s), 'engine article says ' + s);
  has(`Low ${TIER_MULT.low}×, Medium ${TIER_MULT.medium.toFixed(1)}×, High ${TIER_MULT.high}×`);
  has(GAS_UNITS.swap.toLocaleString('en-US')); has(GAS_UNITS.revert.toLocaleString('en-US')); has(GAS_UNITS.cancel.toLocaleString('en-US'));
  has(`wider than **${MEV_MIN_TOLERANCE_PCT}%**`);
  has(`**${DEX_TVL_PER_VOL * 100}% of the coin's 24-hour volume, and never less than $${DEX_MIN_TVL.toLocaleString('en-US')}**`);
  has(`$${NEAR_ZERO_POOL_USD.toLocaleString('en-US')}`); has(`**${MIN_FILL_FRACTION * 100}%**`);
  has(TOLERANCES.map(t => `${t}%`).slice(0, 3).join(', '));
});

test('every post has a cover and every @figure names a drawing that exists', async () => {
  const { FIGURE_IDS, COVER_SLUGS } = await import('../src/components/domain/figures');
  const used = new Set<string>();
  for (const p of POSTS) {
    assert.ok(COVER_SLUGS.includes(p.slug), 'a cover for ' + p.slug);
    for (const b of parse(p.body)) if (b.t === 'figure') {
      used.add(b.id);
      assert.ok(FIGURE_IDS.includes(b.id), p.slug + ' draws ' + b.id);
      assert.ok(b.caption.length > 24, p.slug + ': ' + b.id + ' needs a caption that says something');
    }
  }
  assert.equal(used.size, FIGURE_IDS.length, 'every drawing is used: ' + FIGURE_IDS.filter(i => !used.has(i)));
  assert.ok(POSTS.every(p => parse(p.body).some(b => b.t === 'figure')), 'every post carries at least one figure');
});

test('markdown: a figure is a block of its own, never markup', () => {
  const b = parse('para\n\n@figure amm-curve · A caption.\n\nmore');
  assert.deepEqual(b.map(x => x.t), ['p', 'figure', 'p']);
  assert.deepEqual(b[1], { t: 'figure', id: 'amm-curve', caption: 'A caption.' });
  assert.equal((parse('@figure x')[0] as { caption: string }).caption, '');
});

test('inline: code is literal, links are allow-listed, bold and italic nest', () => {
  assert.deepEqual(inline('a `**x**` b'), [{ t: 'text', v: 'a ' }, { t: 'code', v: '**x**' }, { t: 'text', v: ' b' }]);
  assert.deepEqual(inline('[go](#/terminal)'), [{ t: 'a', href: '#/terminal', c: [{ t: 'text', v: 'go' }] }]);
  assert.ok(!JSON.stringify(inline('[x](javascript:alert(1))')).includes('"a"'), 'a javascript: link is text');
  assert.equal(safeHref('http://x.com'), null); assert.equal(safeHref('data:text/html,1'), null); assert.equal(safeHref('#/blog/a'), '#/blog/a');
  assert.equal(safeHref('https://a.b/"onmouseover'), null);
  assert.deepEqual(inline('**a** *b*'), [{ t: 'b', c: [{ t: 'text', v: 'a' }] }, { t: 'text', v: ' ' }, { t: 'i', c: [{ t: 'text', v: 'b' }] }]);
  assert.deepEqual(inline('**[go](#/p2p)**'), [{ t: 'b', c: [{ t: 'a', href: '#/p2p', c: [{ t: 'text', v: 'go' }] }] }]);
  assert.equal(plain(inline('**a** [b](#/x) `c`')), 'a b c');
  assert.equal(slugify('Gas & priority fees!'), 'gas-priority-fees');
});

test('parse: every block type, unique heading ids, markup stays text', () => {
  const md = '## One\n\npara *x*\nwrapped\n\n## One\n\n### Sub\n\n- a\n- b\n  more\n\n1. x\n2. y\n\n> note\n> more\n\n```\n<b>raw</b>\n```\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\n---\n\n<script>alert(1)</script>';
  const b = parse(md) as unknown as Record<string, any>[];
  assert.deepEqual(b.map(x => x.t), ['h2', 'p', 'h2', 'h3', 'ul', 'ol', 'quote', 'pre', 'table', 'hr', 'p']);
  assert.equal(b[0]!.id, 'one'); assert.equal(b[2]!.id, 'one-2');
  assert.equal(plain(b[1]!.c), 'para x wrapped');
  assert.equal(plain(b[4]!.items[1]), 'b more');
  assert.equal(b[7]!.v, '<b>raw</b>');
  const t = b[8]!;
  assert.equal(t.head.length, 2); assert.equal(t.rows.length, 1);
  assert.equal(plain(b[10]!.c), '<script>alert(1)</script>', 'rendered as text by the view, never as markup');
});

test('meta: read time, dates, routes', () => {
  assert.equal(readMinutes(parse('word '.repeat(440))), 2);
  assert.equal(readMinutes([]), 1);
  assert.equal(prettyDate('2026-09-11'), '11 Sep 2026');
  assert.deepEqual(routeOf('#/blog'), { slug: null }); assert.deepEqual(routeOf('#/blog/'), { slug: null });
  assert.deepEqual(routeOf('#/blog/what-is-dexladder'), { slug: 'what-is-dexladder' });
  assert.equal(routeOf('#/markets'), null); assert.equal(routeOf('#/blog/../x'), null);
});

test('the Blog is an Academy section with a permanent route; Advanced mode links its article', async () => {
  const { DESTINATIONS, destinationOf } = await import('../src/nav/ia');
  const { GUIDE } = await import('../src/legacy/ticket-view');
  assert.equal(DESTINATIONS.length, 6, 'still six destinations');
  const ac = DESTINATIONS.find(d => d.id === 'academy')!;
  assert.deepEqual(ac.sections.slice(0, 2).map(s => s.id), ['learn', 'blog']);
  assert.equal(destinationOf('blog').id, 'academy');
  assert.equal(find(routeOf(GUIDE.href)!.slug!)!.slug, 'advanced-execution-engine');
});
