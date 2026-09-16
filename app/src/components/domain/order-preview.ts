import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Pill } from '../ui/pill';
import { Badge } from '../ui/badge';
import type { Preview } from '../../lib/paper-engine/match';
import { explainImpact } from '../../lib/paper-engine/pool-exec';
import { fmtPct } from '../../lib/paper-engine/impact';

export interface OrderPreviewProps {
  readonly preview: Preview;
  readonly qty: number;
  readonly base: string;
  readonly quote: string;
  readonly tif: string;
  fmt(n: number): string;
  /** optional "learn why" link for the explanation (an Academy lab) */
  readonly learn?: { readonly label: string; open(): void };
  /** optional long-form explanation of the mode (a Blog post, an in-app #/ route) */
  readonly guide?: { readonly label: string; readonly href: string };
  /** present when the order settles on-chain (Advanced · DEX venue) */
  readonly network?: NetworkView;
  /** simulated MEV bots are on */
  readonly mev?: boolean;
}

/** What the ticket knows about the chain right now, for an on-chain order. */
export interface NetworkView {
  readonly gwei: number;
  readonly congestion: 'calm' | 'busy' | 'congested';
  /** live / cached / estimate — or a practice setting */
  readonly source: string;
  readonly tier: 'low' | 'medium' | 'high';
  /** gas this swap would pay, in the quote asset */
  readonly costQuote: number;
  readonly pendingRisk: number;
  readonly timeoutRisk: number;
}

type Warn = { status: 'bad' | 'warn'; text: string } | null;

function warning(x: Preview, qty: number, tif: string): Warn {
  const pct = ((x.filled / qty) * 100).toFixed(1), a = x.amm;
  if (a && a.nearZero) return { status: 'bad', text: a.nearZero.replace('Nothing was sent.', 'This order would be refused.') };
  if (a && !a.withinTolerance) return { status: 'bad', text: `Price impact ${fmtPct(a.impactPct)} exceeds your ${fmtPct(a.tolerancePct)} tolerance — this order would be rejected.` };
  if (x.remaining > 1e-9 && tif === 'FOK') return { status: 'bad', text: `Fill-or-kill: only ${pct}% is available, so this order would be rejected outright.` };
  if (x.exhausted) return { status: 'bad', text: `Your size is larger than ${a ? "the pool's range holds" : 'the whole visible book'}. ${pct}% would fill; the rest ${tif === 'IOC' ? 'is cancelled' : 'rests as a working order'}.` };
  if (x.remaining > 1e-9) return { status: 'warn', text: `${pct}% fills now at your price; the remainder ${tif === 'IOC' ? 'is cancelled' : a ? 'waits for the pool price to reach it' : 'joins the queue'}.` };
  if (x.slipBps > 25) return { status: 'warn', text: `That is a big order for this ${a ? 'pool' : 'book'} — you are paying ${x.slipBps.toFixed(0)} bp of price impact to get filled.` };
  return null;
}

/**
 * "What this order will actually do" — the same numbers the fill will use. Order-book mode shows
 * slippage and levels; pool mode (Advanced) shows price impact, pool depth, where the price is
 * left, and whether the order is inside the trader's slippage tolerance.
 */
export function OrderPreview(p: OrderPreviewProps): HTMLElement {
  const x = p.preview, a = x.amm, f = p.fmt;
  const fee = x.filled * x.avg * x.feeRate, gap = x.filled * x.avg + fee - x.filled * x.mid;
  const row = (k: string, val: string) => h('div', { class: [CX.previewRow] }, h('span', {}, k), h('b', {}, val));
  const w = warning(x, p.qty, p.tif);
  const model = a ? (a.fork ? Badge('Your node · ' + a.fork.label, 'warn') : Badge(a.model === 'concentrated' ? 'Pool · concentrated' : 'Pool · x·y=k', 'info')) : Badge('Order book', 'neutral');
  return h('div', { class: [CX.preview], role: 'group', aria: { label: 'Estimated execution' } },
    h('div', { class: [CX.previewHead] }, h('span', {}, 'Estimated execution'), model),
    row('Fills now', f(x.filled) + ' / ' + f(p.qty) + ' ' + p.base),
    row('Average price', f(x.avg || x.mid) + ' ' + p.quote),
    a ? row('Price impact', fmtPct(a.impactPct)) : row('Slippage vs mid', x.slipBps.toFixed(1) + ' bp'),
    a ? row('Price after your order', f(a.p1) + ' ' + p.quote + ' (' + fmtPct(a.movePct) + ')') : row('Book levels used', String(x.levels)),
    a ? row(a.fork ? 'Pool holds' : 'Pool depth', (a.fork ? '≈ ' : '≈ $') + Math.round(a.poolUSD).toLocaleString('en-US') + (a.fork ? ' ' + a.fork.quote : '')) : null,
    row('Fee', (x.maker ? 'maker ' : 'taker ') + (100 * x.feeRate).toFixed(3) + '% · ' + f(fee) + ' ' + p.quote),
    p.network ? row('Network', p.network.gwei.toFixed(p.network.gwei < 1 ? 3 : 2) + ' gwei · ' + p.network.congestion + ' · ' + p.network.source) : null,
    p.network ? row('Gas (' + p.network.tier + ' priority)', f(p.network.costQuote) + ' ' + p.quote) : null,
    a && a.sandwich ? row('If a bot sandwiches you', f(a.sandwich.avg) + ' ' + p.quote + ' (+' + f(a.sandwich.extraQuote) + ')') : null,
    a ? h('div', { class: [CX.previewPills] },
      Pill({ status: a.withinTolerance ? 'good' : 'bad', text: 'Tolerance ' + fmtPct(a.tolerancePct) + (a.withinTolerance ? ' · within' : ' · exceeded') }),
      p.network ? Pill({ status: p.network.timeoutRisk >= 0.1 ? 'bad' : p.network.pendingRisk >= 0.15 ? 'warn' : 'good', text: 'Delay ' + Math.round(p.network.pendingRisk * 100) + '% · never mined ' + Math.round(p.network.timeoutRisk * 100) + '%' }) : null,
      p.mev ? Pill({ status: a.sandwich ? 'bad' : 'good', text: a.sandwich ? 'MEV · your tolerance pays a bot' : 'MEV · no room for a bot' }) : null) : null,
    w ? h('div', { class: [CX.previewNote, CX[w.status]], role: w.status === 'bad' ? 'alert' : 'status' }, w.text) : null,
    h('div', { class: [CX.previewNote] },
      a ? explainImpact(a, x.filled, p.qty) + ' ' : '',
      a && a.sandwich ? `A bot watching the mempool would push you to the edge of your ${fmtPct(a.tolerancePct)} tolerance and keep ${f(a.sandwich.botProfitQuote)} ${p.quote}; a tighter tolerance leaves it no room. ` : '',
      `Filling ${f(p.qty)} ${p.base} instantly at mid (${f(x.mid)}) would cost ${f(p.qty * x.mid)}; real execution costs ${f(gap + fee)} ${p.quote} more in ${a ? 'price impact' : 'slippage'} and fees.`,
      p.learn ? h('span', {}, ' ', h('a', { href: '#', on: { click: e => { e.preventDefault(); p.learn!.open(); } } }, p.learn.label + ' →')) : null,
      p.guide ? h('span', {}, ' ', h('a', { href: p.guide.href, data: { guide: '1' } }, p.guide.label + ' →')) : null));
}
