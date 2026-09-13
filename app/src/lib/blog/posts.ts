/**
 * The blog registry. Posts are data: permanent slug, metadata, and a markdown body bundled as
 * text. Pure — no clock, no storage, no network.
 *
 * Versioning, the one rule: a slug is forever. Posts are only ever appended; a retitled post keeps
 * its slug; a post that must move leaves its old slug in ALIASES. The unit gate pins the published
 * slug list, so an old #/blog/<slug> link can never start pointing at nothing.
 */
import { parse, plain, type Block } from './markdown';
import whatIs from '../../content/blog/01-what-is-dexladder.md';
import engine from '../../content/blog/02-advanced-execution-engine.md';
import paperVsReal from '../../content/blog/03-paper-vs-real-dex-trading.md';
import academy from '../../content/blog/04-academy-and-labs.md';
import sovereignty from '../../content/blog/05-sovereignty-proof-ledger.md';
import desk from '../../content/blog/06-p2p-explorer-and-the-desk.md';
import built from '../../content/blog/07-how-dexladder-is-built.md';
import bots from '../../content/blog/08-bots-build-and-bring.md';
import rewind from '../../content/blog/09-rewind-and-backtesting.md';
import perps from '../../content/blog/10-perpetuals-funding-liquidation.md';
import orders from '../../content/blog/11-order-types-and-algos.md';
import liquidity from '../../content/blog/12-liquidity-desk-amms-and-il.md';
import fork from '../../content/blog/13-local-fork-sandbox.md';
import copilot from '../../content/blog/14-dexai-on-device-copilot.md';
import markets from '../../content/blog/15-markets-and-the-data-ladder.md';
import news from '../../content/blog/16-news-sentiment-and-attention.md';
import book from '../../content/blog/17-portfolio-journal-and-record.md';
import desksPost from '../../content/blog/18-the-desks.md';
import journey from '../../content/blog/19-journey-quests-and-daily.md';
import apps from '../../content/blog/20-apps-offline-and-install.md';
import modes from '../../content/blog/21-day-night-and-the-design-system.md';
import trust from '../../content/blog/22-security-and-trust.md';

export const BLOG_SCHEMA = 1;

export interface PostMeta {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly tag: 'Start here' | 'Engine' | 'Learn' | 'Sovereignty' | 'Desk' | 'Engineering' | 'Automation' | 'Data' | 'Platform';
  /** The build the post first shipped in; never changes. */
  readonly since: string;
  /** ISO date of the last content revision. */
  readonly updated: string;
  readonly rev: number;
}
export interface Post extends PostMeta { readonly body: string }

export const POSTS: readonly Post[] = Object.freeze([
  { slug: 'what-is-dexladder', title: 'What is DexLadder?', tag: 'Start here', since: 'v156', updated: '2026-09-11', rev: 1, body: whatIs,
    summary: 'A private, on-device place to learn crypto and practise trading with paper money — what it is, who it is for, and what it will never do.' },
  { slug: 'advanced-execution-engine', title: 'The Advanced Execution Engine', tag: 'Engine', since: 'v156', updated: '2026-09-11', rev: 1, body: engine,
    summary: 'Price impact, slippage tolerance, gas and priority fees, MEV sandwiches and partial fills — how v156 makes a paper trade behave like a real one.' },
  { slug: 'paper-vs-real-dex-trading', title: 'Paper Trading vs Real DEX Trading', tag: 'Learn', since: 'v156', updated: '2026-09-11', rev: 1, body: paperVsReal,
    summary: 'What a simulator can teach you, where it must stay honest about its limits, and the habits that carry over to a real wallet.' },
  { slug: 'academy-and-labs', title: 'Academy & Interactive Labs', tag: 'Learn', since: 'v156', updated: '2026-09-11', rev: 1, body: academy,
    summary: 'The lesson path, the hands-on labs, the daily challenge and the certificate — and how the trading desk sends you back to the right lab.' },
  { slug: 'sovereignty-proof-ledger', title: 'Sovereignty, the Proof Ledger & On-Device Design', tag: 'Sovereignty', since: 'v156', updated: '2026-09-11', rev: 1, body: sovereignty,
    summary: 'Why nothing leaves your device, how the SHA-256 proof ledger seals your history, and how to back up, verify and restore it.' },
  { slug: 'p2p-explorer-and-the-desk', title: 'P2P Bazaar, Explorer and the Rest of the Desk', tag: 'Desk', since: 'v156', updated: '2026-09-11', rev: 1, body: desk,
    summary: 'A tour of the destinations beyond the trading ticket: the P2P Bazaar, the On-Chain Explorer, Markets, Portfolio and the community corners.' },
  { slug: 'how-dexladder-is-built', title: 'How DexLadder Is Built', tag: 'Engineering', since: 'v156', updated: '2026-09-11', rev: 1, body: built,
    summary: 'One file, no backend, no accounts: the architecture, the public data sources, the typed core and the gates every release has to pass.' },
  { slug: 'bots-build-and-bring', title: 'Bots: Build One, or Bring Your Own', tag: 'Automation', since: 'v161', updated: '2026-09-13', rev: 1, body: bots,
    summary: 'Rules as blocks or your own code in a sandbox, an isolated wallet per bot, the kill switch, the log, endpoint telemetry and a backtest that runs off the main thread.' },
  { slug: 'rewind-and-backtesting', title: 'Rewind: Trading History Bar by Bar', tag: 'Desk', since: 'v161', updated: '2026-09-13', rev: 1, body: rewind,
    summary: 'Real candles replayed one bar at a time, orders that can only fill on the bars that come next, and a verdict that leads with buy-and-hold.' },
  { slug: 'perpetuals-funding-liquidation', title: 'Perpetuals, Funding and Liquidation', tag: 'Engine', since: 'v161', updated: '2026-09-13', rev: 1, body: perps,
    summary: 'Isolated margin, the maintenance ladder, real funding rates that move your liquidation price, and a post-mortem that explains the liquidation instead of just reporting it.' },
  { slug: 'order-types-and-algos', title: 'Every Order Type on the Desk', tag: 'Engine', since: 'v161', updated: '2026-09-13', rev: 1, body: orders,
    summary: 'Market to stop-limit, trailing stops, time in force, post-only and reduce-only, OCO brackets that shrink correctly, and TWAP worked in slices.' },
  { slug: 'liquidity-desk-amms-and-il', title: 'The Liquidity Desk: AMMs, LPs and Impermanent Loss', tag: 'Desk', since: 'v161', updated: '2026-09-13', rev: 1, body: liquidity,
    summary: 'Constant product, concentrated liquidity and StableSwap implemented as the contracts run them, with divergence loss, LVR, break-even fee APR and a staking bench from the consensus spec.' },
  { slug: 'local-fork-sandbox', title: 'Fork a Chain: The Local Sandbox', tag: 'Engineering', since: 'v161', updated: '2026-09-13', rev: 1, body: fork,
    summary: 'Point the terminal at your own anvil or Hardhat node and trade your own contracts in the same ticket — no keys, dry-run writes, and a doctor for the errors a browser cannot explain.' },
  { slug: 'dexai-on-device-copilot', title: 'DeXaI, the On-Device Copilot', tag: 'Platform', since: 'v161', updated: '2026-09-13', rev: 1, body: copilot,
    summary: 'The numeric-slot law, the on-device readers it calls before it speaks, why every action needs a tap, and what the model card states.' },
  { slug: 'markets-and-the-data-ladder', title: 'Markets, the Screener and the Data Ladder', tag: 'Data', since: 'v161', updated: '2026-09-13', rev: 1, body: markets,
    summary: 'Rungs and sectors, one canonical snapshot, keyless sources with health, honest history, and two independent witnesses for a single on-chain pool.' },
  { slug: 'news-sentiment-and-attention', title: 'The News Desk, Sentiment and Attention', tag: 'Data', since: 'v161', updated: '2026-09-13', rev: 1, body: news,
    summary: 'A transport ladder built after every transport died at once, why newest-first is a feature, the attention pulse, and Sentinel alerts written in plain words.' },
  { slug: 'portfolio-journal-and-record', title: 'Portfolio, the Journal and Your Record', tag: 'Desk', since: 'v161', updated: '2026-09-13', rev: 1, body: book,
    summary: 'Balances, fees including gas, the note on every fill, the Monte Carlo fan, a printable tax summary, signed certificates and an auditor that works without the app.' },
  { slug: 'the-desks', title: 'The Desks: Reading the Market\u2019s Structure', tag: 'Desk', since: 'v161', updated: '2026-09-13', rev: 1, body: desksPost,
    summary: 'Pool Radar, Leverage Weather, Chain Clock, Forecast, Odds, Chain Ladder, Venue Board, Yield, Convert, Baskets, Supply Drift and Era Ledger — pages named after the question, not the asset.' },
  { slug: 'journey-quests-and-daily', title: 'Journey, Quests and the Daily Challenge', tag: 'Learn', since: 'v161', updated: '2026-09-13', rev: 1, body: journey,
    summary: 'Levels, XP for calibration rather than activity, the first-flight quest, the 60-second daily decision, Discover, the Town Square, the Monument and the certificate.' },
  { slug: 'apps-offline-and-install', title: 'DexLadder Everywhere: Web, Installed, Offline', tag: 'Platform', since: 'v161', updated: '2026-09-13', rev: 1, body: apps,
    summary: 'One file behind the website, the installed app, the native builds and the offline mode — plus the storage rules that make backups the one thing you must do.' },
  { slug: 'day-night-and-the-design-system', title: 'Day, Night and the Design System', tag: 'Platform', since: 'v161', updated: '2026-09-13', rev: 1, body: modes,
    summary: 'Two appearances and no third axis, seeded from your system once, a 4.5:1 contrast floor the build enforces, and why every illustration is drawn rather than photographed.' },
  { slug: 'security-and-trust', title: 'Security, Privacy and the Trust Center', tag: 'Sovereignty', since: 'v161', updated: '2026-09-13', rev: 1, body: trust,
    summary: 'No accounts and no keys to steal, an eval-free payload, a strict policy with one deliberate loopback door, and a Trust Center that lists every host the app talks to.' },
]);

/** Retired slug → current slug. Append-only, like POSTS. */
export const ALIASES: Readonly<Record<string, string>> = Object.freeze({});

export function find(slug: string): Post | null {
  const s = ALIASES[slug] || slug;
  return POSTS.find(p => p.slug === s) || null;
}

/** Words ÷ 220 per minute, at least one. */
export function readMinutes(blocks: readonly Block[]): number {
  let words = 0;
  const count = (s: string) => { words += s.split(/\s+/).filter(Boolean).length; };
  for (const b of blocks) {
    if (b.t === 'h2' || b.t === 'h3') count(b.text);
    else if (b.t === 'p' || b.t === 'quote') count(plain(b.c));
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach(i => count(plain(i)));
    else if (b.t === 'pre') count(b.v);
    else if (b.t === 'table') [b.head, ...b.rows].forEach(r => r.forEach(c => count(plain(c))));
    else if (b.t === 'figure') count(b.caption);
  }
  return Math.max(1, Math.round(words / 220));
}

export interface Article extends PostMeta {
  readonly blocks: readonly Block[];
  readonly minutes: number;
  readonly toc: readonly { readonly id: string; readonly text: string }[];
  readonly prev: PostMeta | null;
  readonly next: PostMeta | null;
}

const meta = (p: Post): PostMeta => ({ slug: p.slug, title: p.title, summary: p.summary, tag: p.tag, since: p.since, updated: p.updated, rev: p.rev });

/** Everything the article view needs, derived once. */
export function article(slug: string): Article | null {
  const p = find(slug);
  if (!p) return null;
  const blocks = parse(p.body), i = POSTS.indexOf(p);
  return {
    ...meta(p), blocks, minutes: readMinutes(blocks),
    toc: blocks.flatMap(b => (b.t === 'h2' ? [{ id: b.id, text: b.text }] : [])),
    prev: i > 0 ? meta(POSTS[i - 1]!) : null,
    next: i < POSTS.length - 1 ? meta(POSTS[i + 1]!) : null,
  };
}

export interface IndexEntry extends PostMeta { readonly minutes: number }
export function index(): readonly IndexEntry[] {
  return POSTS.map(p => ({ ...meta(p), minutes: readMinutes(parse(p.body)) }));
}

/** 2026-09-11 → "11 Sep 2026" — no Date, so the same everywhere. */
export function prettyDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2]! - 1];
  return `${+m[3]!} ${mon} ${m[1]}`;
}

/** "#/blog" → index; "#/blog/<slug>" → that slug; anything else → null. */
export function routeOf(hash: string): { readonly slug: string | null } | null {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'blog' || h === 'blog/') return { slug: null };
  const m = h.match(/^blog\/([a-z0-9-]+)\/?$/);
  return m ? { slug: m[1]! } : null;
}
