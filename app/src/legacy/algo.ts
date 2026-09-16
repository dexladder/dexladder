/**
 * Conditional and algorithmic orders on the paper desk (runtime half).
 *
 *   OCO   two protective legs that share an `oco` group: when one fills the other is cancelled,
 *         and a partial fill shrinks it instead. Placed as one decision from the ticket.
 *   TWAP  a parent order (type 'twap') that rests among the working orders and sends one market
 *         slice every interval through the SAME engine the ticket uses — so in Advanced mode each
 *         slice meets the pool, the tolerance and (on-chain) its own gas.
 *
 * The arithmetic is pure (lib/paper-engine/algo.ts + orders.ts); this file only carries effects.
 */
import { usePaperEngine } from '../hooks/usePaperEngine';
import { applySlice, nextSlice, planTwap, progress, isComplete, describe, TWAP, type TwapOrder } from '../lib/paper-engine/algo';
import { ocoEffect, type RestingOrder } from '../lib/paper-engine/orders';
import { cbx, realismOf, onChain, tierOf, gasIn, affordable, chargeNetwork, withFillMeta, withPricedFill, mevOn } from './paper';
import { signal as gasSignal } from './gas-feed';
import { explainFate } from '../lib/paper-engine/gas';
import { legacy, type LegacyState } from './globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const call = legacy.call;
const now = (): number => (typeof Date !== 'undefined' ? Date.now() : 0);
const id6 = (): string => 'a' + Math.random().toString(36).slice(2, 8);
const fmt = (v: number): any => call('fmt', v) ?? String(v);
const orders = (S: LegacyState): any[] => (S.orders = S.orders || []);

/** The ticket's engine, without the ticket: one market order, all of Advanced's frictions. */
function engine(S: LegacyState, quiet: boolean) {
  const real = realismOf(S);
  let note = '';
  const pe = usePaperEngine({
    engine: cbx(), price: legacy.pairPrice, held: s => S.bal[s] || 0,
    afford: (side, sym, quote, qty, px, rate, net) => affordable(S, side, sym, quote, qty, px, rate, net),
    fill: (side, sym, quote, qty, px, rate, label, net, meta) => withFillMeta(meta || { asked: qty, mevQuote: 0 }, () => (real.mode === 'advanced'
      ? withPricedFill(net, () => call('CBXfill', side, sym, quote, qty, px, rate, label, true))
      : call('CBXfill', side, sym, quote, qty, px, rate, label, true))),
    charge: (quote, amount, why) => chargeNetwork(S, quote, amount, why),
    network: () => (onChain(real) ? { signal: gasSignal(), tier: tierOf(S), chg24: (legacy.coin(S.coin) || { c24: 0 }).c24 || 0, cost: (u: number, g: number) => gasIn(S.quote, u, g), mev: mevOn(S) } : null),
    place: (type, side, sym, quote, qty, px, extra) => call('placeAdvOrder', type, side, sym, quote, qty, px, extra),
    emit: e => { if (!quiet && e.type === 'network') note = explainFate(e.report.fate, fmt(e.report.gasPaid) + ' ' + S.quote); },
  });
  return { pe, real, note: () => note };
}

/* ----------------------------------------------------------------- OCO */

/** Arm a take-profit and a stop-loss as one decision on what is held. */
export function placeOco(qty: number, tp: number, sl: number): string | null {
  const S = legacy.S();
  if (!S) return null;
  const cur = legacy.pairPrice(S.coin, S.quote);
  if (!(qty > 0)) return 'Enter the size to protect.';
  if (!(tp > 0 && sl > 0)) return 'An OCO needs both a take-profit and a stop-loss price.';
  if (!(tp > cur && sl < cur)) return `With ${S.coin} at ${fmt(cur)}, the take-profit must be above and the stop-loss below.`;
  if ((S.bal[S.coin] || 0) + 1e-12 < qty) return `You hold ${fmt(S.bal[S.coin] || 0)} ${S.coin}.`;
  const group = 'oco-' + id6();
  call('placeAdvOrder', 'tp', 'sell', S.coin, S.quote, qty, tp, { oco: group });
  call('placeAdvOrder', 'sl', 'sell', S.coin, S.quote, qty, sl, { oco: group });
  call('toast', 'good', 'OCO armed', `${fmt(qty)} ${S.coin}: take-profit at ${fmt(tp)}, stop-loss at ${fmt(sl)}. Whichever fills first cancels the other.`);
  return null;
}

/** Called by the order loop the moment a leg fills: cancel (or shrink) the other side. */
export function ocoFilled(o: RestingOrder, filledQty?: number): void {
  const S = legacy.S();
  if (!S || !o || !o.oco) return;
  const eff = ocoEffect(orders(S) as RestingOrder[], o.id, filledQty == null ? o.qty : filledQty);
  if (!eff.cancel.length && !eff.reduce.length) return;
  for (const r of eff.reduce) { const x = orders(S).find(y => y.id === r.id); if (x) x.qty = r.qty; }
  for (const cid of eff.cancel) { const x = orders(S).find(y => y.id === cid); if (x) { x.type = 'void'; x.qty = 0; } }   // neutered in place: the loop may still be walking the old array
  S.orders = orders(S).filter(x => !eff.cancel.includes(x.id));
  call('toast', 'warn', 'The other side was cancelled', eff.cancel.length
    ? `${o.type === 'tp' ? 'Take-profit' : 'Stop-loss'} filled, so its OCO partner is gone.`
    : `Partial fill — the OCO partner is now ${fmt(eff.reduce[0]!.qty)} ${o.sym}.`);
}

/** Cancelling one leg by hand cancels its partner — an OCO is one order, not two. */
export function ocoCancel(id: string): void {
  const S = legacy.S();
  if (!S) return;
  const me = orders(S).find(o => o.id === id);
  if (!me || !me.oco) return;
  const partners = orders(S).filter(o => o.id !== id && o.oco === me.oco);
  if (!partners.length) return;
  S.orders = orders(S).filter(o => o.id === id || o.oco !== me.oco);
  call('toast', 'warn', 'OCO cancelled', 'Both legs are gone — an OCO is one order, not two.');
}

/* ----------------------------------------------------------------- TWAP */

/** Arm a parent order. It rests among the working orders and works itself. */
export function armTwap(qty: number, slices: number, minutes: number): string | null {
  const S = legacy.S();
  if (!S) return null;
  const p = planTwap({ id: id6(), side: (S.side as 'buy' | 'sell') || 'buy', sym: S.coin, quote: S.quote, qty, slices, minutes, now: now() });
  if (!p.ok) return p.reason;
  const { id, type, side, sym, quote, ...rest } = p.order;
  call('placeAdvOrder', type, side, sym, quote, qty, 0, rest);
  call('toast', 'good', 'TWAP working', describe(qty, slices, minutes, sym, onChain(realismOf(S))));
  step();                                   // the first slice goes now; the rest are on the clock
  return null;
}

/** One tick of the desk: send every slice that has come due. */
export function step(): void {
  const S = legacy.S();
  if (!S || !S.orders || !S.orders.length) return;
  const t = now();
  let changed = false;
  for (const raw of orders(S).slice()) {
    if (raw.type !== 'twap') continue;
    const o = raw as TwapOrder;
    const due = nextSlice(o, t);
    if (!due) continue;
    const { pe } = engine(S, true);
    const out = pe.submit({ type: 'market', side: o.side, sym: o.sym, quote: o.quote, amt: due.qty, limit: 0, stop: 0, tif: 'IOC', postOnly: false, reduceOnly: false, tolerancePct: realismOf(S).tolerancePct });
    const filled = out.status === 'done' ? out.filled : 0, avg = out.status === 'done' && out.exec ? out.exec.avg : 0;
    Object.assign(raw, applySlice(o, filled, avg));
    changed = true;
    if (out.status === 'rejected' || out.status === 'unfunded' || out.status === 'invalid') {
      call('toast', 'bad', 'TWAP stopped', `Slice ${o.sent + 1}/${o.slices} could not be sent (${out.status === 'invalid' ? out.message : out.status === 'rejected' ? out.reason : 'not enough balance'}). The rest of the order was cancelled.`);
      S.orders = orders(S).filter(x => x.id !== raw.id);
      break;
    }
    if (isComplete(raw as TwapOrder)) {
      const p = progress(raw as TwapOrder);
      S.orders = orders(S).filter(x => x.id !== raw.id);
      call('toast', 'good', 'TWAP complete', `${fmt(p.sent)} slices worked · ${fmt((raw as TwapOrder).filled)} ${o.sym} at an average of ${fmt(p.avg)} ${o.quote}.`);
    }
  }
  if (changed) for (const f of ['saveP', 'renderOrders', 'updateNavBal', 'recalc', 'renderPosition']) call(f);
}

/** The working-orders row for the types the legacy list does not know. Returns escaped HTML or null. */
export function rowHtml(o: any, f: { fmt(n: number): string; esc(s: string): string; gly(n: string, s: number): string }): string | null {
  if (o.type === 'twap') {
    const p = progress(o as TwapOrder), pair = f.esc(o.sym) + '/' + f.esc(o.quote);
    return `<div class="orow"><span class="otag">TWAP</span><b>${pair}</b><span>${p.sent}/${p.slices} slices · ${f.fmt(p.left)} ${f.esc(o.sym)} left</span>` +
      `<span class="dlx-dim">${p.avg ? 'avg ' + f.fmt(p.avg) : (o.side === 'buy' ? 'buying' : 'selling')}</span>` +
      `<button class="ocx" onclick="cancelOrder('${f.esc(o.id)}')" title="Cancel the rest">${f.gly('x', 9)}</button></div>`;
  }
  if (o.oco && (o.type === 'tp' || o.type === 'sl')) {
    const tag = o.type === 'tp' ? 'up' : 'down';
    return `<div class="orow"><span class="otag ${tag}">OCO ${o.type === 'tp' ? 'TP' : 'SL'}</span><b>${f.esc(o.sym)}/${f.esc(o.quote)}</b>` +
      `<span class="${tag}">@ ${f.fmt(o.px)}</span><span class="dlx-dim">${f.fmt(o.qty)} ${f.esc(o.sym)} · cancels its partner</span>` +
      `<button class="ocx" onclick="cancelOrder('${f.esc(o.id)}')" title="Cancel">${f.gly('x', 9)}</button></div>`;
  }
  return null;
}

export { TWAP };
