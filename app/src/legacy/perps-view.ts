/**
 * The perpetual-futures desk on the Terminal (coin page side column) — view half. Replaces the
 * DLSIM "Perps practice" card (#dlPerp keeps its id). The ticket is rendered once per coin /
 * mode / leverage choice; typing re-renders only the preview, a tick only the positions, so
 * focus and a dragged slider are never pulled away.
 */
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { h } from '../components/ui/h';
import { CX } from '../design/classes';
import { parseAmount } from '../components/ui/trade-input';
import { PerpTicket } from '../components/domain/perp-ticket';
import { PerpPreview } from '../components/domain/perp-preview';
import { PerpPositionCard, countdown } from '../components/domain/perp-position';
import { PostMortemCard } from '../components/domain/perp-postmortem';
import { describeRate, nextSettlement, maxLevFor, type PerpSide, type PostMortem } from '../lib/perps';
import type { PerpEvent } from '../hooks/usePerps';
import { legacy } from './globals';
import { perps, positions, sim, modeOf, venueOf, markOf, specOf, rateFor, onEvent } from './perps';

const $ = (id: string): HTMLElement | null => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const f = (n: number): string => String(legacy.call('fmt', n) ?? n);
const money = (n: number): string => String(legacy.call('cUSD', Math.abs(n)) ?? '$' + Math.abs(n).toFixed(2));

const T = { side: 'long' as PerpSide, margin: '', sl: '', tp: '', sym: '', key: '' };
const lev = (): number => { const d = sim(legacy.S()); return Math.max(1, Math.round((d && +(d.lev ?? 5)) || 5)); };
const coin = (): string => { const S = legacy.S(); return (S && typeof S.coin === 'string' && S.coin !== 'USDT' && S.coin) || 'BTC'; };

function ticket(): { sym: string; side: PerpSide; margin: number; lev: number; sl: number | null; tp: number | null } {
  return { sym: coin(), side: T.side, margin: parseAmount(T.margin) || 0, lev: lev(), sl: parseAmount(T.sl), tp: parseAmount(T.tp) };
}

function setLev(n: number, full: boolean): void {
  const d = sim(legacy.S()); if (!d) return;
  d['lev'] = Math.max(1, Math.min(specOf(coin()).maxLev, Math.round(n) || 1)); legacy.call('saveP');
  if (full) renderTicket(); else { const l = document.querySelector('label[for="dlpLev"] span'); if (l) l.textContent = 'Leverage ' + lev() + '× · up to ' + specOf(coin()).maxLev + '×'; }
  renderPreview();
}

function renderTicket(): void {
  const host = $('dlpTicketHost'); if (!host) return;
  const S = legacy.S(), sym = coin(), mode = modeOf(S), spec = specOf(sym), m = parseAmount(T.margin) || 0;
  const hadFocus = document.activeElement && host.contains(document.activeElement) ? (document.activeElement as HTMLElement).id || 'dlpLevSeg' : '';
  host.replaceChildren(PerpTicket({
    sym, mode, maxLev: m > 0 ? Math.min(spec.maxLev, maxLevFor(spec, m)) : spec.maxLev, lev: lev(), margin: T.margin, sl: T.sl, tp: T.tp,
    wallet: 'wallet ' + f((S && S.bal && S.bal.USDT) || 0) + ' USDT',
    onMargin: raw => { T.margin = raw; renderPreview(); },
    onLev: n => setLev(n, document.activeElement?.id !== 'dlpLev'),
    onSl: raw => { T.sl = raw; renderPreview(); },
    onTp: raw => { T.tp = raw; renderPreview(); },
    onSide: side => { T.side = side; open(side); },
  }));
  if (hadFocus) { const el = hadFocus === 'dlpLevSeg' ? host.querySelector('#dlpLevSeg [aria-checked="true"]') : $(hadFocus); (el as HTMLElement | null)?.focus(); }
}

function renderPreview(): void {
  const host = $('dlpPrevHost'); if (!host) return;
  const t = ticket();
  host.replaceChildren(PerpPreview({ check: t.margin > 0 ? perps().preview(t) : null, side: T.side, sym: t.sym, mode: modeOf(legacy.S()), fmt: f }));
}

function fundingLine(): HTMLElement {
  const sym = coin(), r = rateFor(sym), spec = specOf(sym), now = Date.now();
  return h('div', { class: [CX.perpLine], id: 'dlpSum' }, 'Funding on ', h('b', {}, sym), ': ', describeRate(r), ' · next settlement in ' + countdown(nextSettlement(now, spec.fundingHours) - now));
}

function renderPositions(): void {
  const host = $('dlpList'); if (!host) return;
  const list = positions(), now = Date.now();
  host.replaceChildren(...(list.length ? list.map(p => PerpPositionCard({
    p, mark: markOf(p.sym) || p.entry, rate8h: rateFor(p.sym).rate8h, now, fmt: f,
    onClose: fr => perps().close(p.id, fr), onMargin: dl => perps().margin(p.id, dl),
    onStop: px => { const why = perps().protect(p.id, px, p.tp ?? null); if (why) legacy.call('toast', 'warn', 'Stop not set', why); else render(); },
  })) : [h('div', { class: [CX.perpLine] }, 'No open perps. Leverage multiplies both directions: post margin, check the liquidation price above, then pick a side.')]));
  const sum = $('dlpSum'); if (sum) sum.replaceWith(fundingLine());
}

function renderPm(): void {
  const host = $('dlpPmHost'), d = sim(legacy.S()); if (!host || !d) return;
  const pm = d.perpPm as PostMortem | undefined;
  host.replaceChildren(...(pm && pm.facts ? [PostMortemCard({
    pm, onDismiss: () => { delete d.perpPm; legacy.call('saveP'); renderPm(); },
    learn: { label: "See today's real liquidations in Leverage Weather", open: () => legacy.callIn('DLWEATHER', 'open', 'perps') },
  })] : []));
}

/** Mount (or re-mount after a coin / mode change) into the Terminal's side column. Idempotent. */
export function mount(): void {
  try {
    const side = document.querySelector('#page-coin .side'); if (!side) return;
    const S = legacy.S(); if (!S) return;
    const key = coin() + '|' + modeOf(S) + '|' + venueOf(S);
    let card = $('dlPerp');
    if (card && card.dataset.v === '2' && T.key === key) { render(); return; }
    if (T.key.split('|')[0] !== coin()) { T.sl = ''; T.tp = ''; }
    T.key = key;
    const fresh = Card({ id: 'dlPerp', eyebrow: 'Paper · isolated margin', title: '⚡ Perpetual futures', actions: Badge(modeOf(S) === 'advanced' ? 'Advanced' : 'Beginner', modeOf(S) === 'advanced' ? 'info' : 'neutral') },
      fundingLine(), h('div', { id: 'dlpTicketHost' }), h('div', { id: 'dlpPrevHost' }), h('div', { id: 'dlpPmHost' }), h('div', { class: [CX.perp], id: 'dlpList' }),
      h('div', { class: [CX.perpLine] }, 'Paper money on the live index price. Isolated margin: a position can lose its margin, never more. '
        + (modeOf(S) === 'advanced' ? 'Advanced: fills walk the perp order book — three times the spot book\'s depth — at the ' + venueOf(S) + ' perp fee.' : 'Beginner: fills at the mark, 0.05% fee, up to 10×.')));
    fresh.dataset.v = '2';
    if (card) card.replaceWith(fresh); else side.appendChild(fresh);
    card = fresh;
    renderTicket(); renderPreview(); renderPm(); renderPositions();
  } catch { /* the desk never breaks the page */ }
}

export function render(): void {
  const card = $('dlPerp');
  if (!card) return;
  const S = legacy.S();
  // a coin, mode or venue change rebuilds the desk (the ticket's ceilings and fees move with it)
  if (card.dataset.v !== '2' || T.key !== coin() + '|' + modeOf(S) + '|' + venueOf(S)) { mount(); return; }
  renderPositions(); renderPm();
}

/** One tick of the book (called from the payload's order loop). */
export function tick(): void {
  const S = legacy.S();
  if (perps().tick() || (S && S.view === 'coin')) render();
}

onEvent((e: PerpEvent) => {
  const S = legacy.S(), d = sim(S);
  const lbl = (p: { sym: string; lev: number; side: string }) => p.sym + ' ' + p.lev + '× ' + p.side;
  switch (e.kind) {
    case 'opened':
      legacy.call('toast', 'good', (e.position.side === 'long' ? 'Long' : 'Short') + ' opened — ' + lbl(e.position),
        'Entry ' + f(e.position.entry) + ' · liquidation ' + f(e.liq) + ' (' + e.distPct.toFixed(2) + '% away)');
      legacy.call('sfx', 'buy'); T.margin = ''; T.sl = ''; T.tp = '';
      if (d && !d._xpP) { d._xpP = 1; legacy.call('addXP', 10, 'First practice perp — respect the liq price'); }
      renderTicket(); renderPreview(); break;
    case 'refused': legacy.call('toast', 'warn', 'Perp not opened', e.why); break;
    case 'closed':
      legacy.call('toast', e.close.pl >= 0 ? 'good' : 'bad', (e.reason === 'manual' ? 'Closed ' : e.reason === 'stop-loss' ? 'Stop-loss hit — ' : 'Take-profit hit — ') + lbl(e.position) + (e.partial ? ' (part)' : ''),
        (e.close.pl >= 0 ? '+' : '−') + money(e.close.pl) + ' realised · ' + money(e.close.cashOut) + ' back to the wallet');
      break;
    case 'liquidated':
      if (d) d.perpPm = e.postMortem;
      legacy.call('toast', 'bad', e.postMortem.headline, 'Mark ' + f(e.close.exit) + ' crossed your liquidation price. ' + money(-e.close.pl) + ' of paper tuition — the desk explains why.');
      legacy.call('sfx', 'sell'); break;
    case 'funding':
      if (e.caughtUp) legacy.call('toast', '', 'Funding settled while you were away', lbl(e.position) + ': ' + (e.paid >= 0 ? 'paid ' : 'received ') + money(e.paid) + ' over ' + e.count + ' settlements');
      break;
    case 'margin': legacy.call('toast', 'good', e.delta > 0 ? 'Margin added' : 'Margin removed', lbl(e.position) + ' · ' + money(e.delta)); break;
  }
  legacy.call('saveP'); legacy.call('updateNavBal');
  if (S && S.view === 'portfolio') legacy.call('renderPortfolio');
  render();
});

/** window.DLSIM.long / short (and the DeXaI "long $500 of SOL" command) keep working. */
export function open(side: PerpSide): void {
  T.side = side;
  if (!$('dlPerp')) mount();
  perps().open(ticket());
}
export function close(id: string): void { perps().close(id, 1); }
export function setLeverage(v: unknown): void { setLev(parseInt(String(v), 10) || 5, true); }
export function fundRate(sym: string): number { return rateFor(sym).rate8h; }
