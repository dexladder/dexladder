/**
 * The legacy order ticket's view half: read the fields, hand a Ticket to the presenter, print
 * what happened. Copy and effect order are the legacy CIRCUIT ticket's, pinned by
 * test/ticket.parity.test.ts. No trading decision is made here.
 */
import { usePaperEngine, type PaperEvent } from '../hooks/usePaperEngine';
import type { Ticket } from '../lib/paper-engine/ticket';
import { cbx, realismOf, affordable, chargeNetwork, onChain, tierOf, gasIn, withPricedFill, withFillMeta, mevOn } from './paper';
import { signal as gasSignal } from './gas-feed';
import { explainFate, GAS_UNITS, TIER_MULT } from '../lib/paper-engine/gas';
import { explainMev } from '../lib/paper-engine/mev';
import { LABS } from '../lib/paper-engine/lessons';
import { fmtPct } from '../lib/paper-engine/impact';
import { legacy } from './globals';
import { placeOco, armTwap } from './algo';
import { ocoPrices, sliceCount, windowMinutes, clear as clearAlgo } from './algo-ui';

export interface TicketCtx {
  readonly TIF: string; readonly POST: boolean; readonly REDUCE: boolean;
  fillWith(side: string, sym: string, quote: string, amt: number, px: number, rate: number, label: string): boolean;
  n(v: number): string;
}

const $ = (id: string): any => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const num = (id: string): number => parseFloat(($(id) || {}).value);
const call = legacy.call;

export function place(c: TicketCtx): void {
  const S = legacy.S();
  if (!S) return;
  const t = S.ordType as string;
  call('ensureEng');
  const err = $('err'), n = c.n;
  if (t === 'oco' || t === 'twap') {                       // one decision, two legs — or one parent worked in slices
    const p = ocoPrices();
    const why = t === 'oco' ? placeOco(num('amt'), p.tp, p.sl) : armTwap(num('amt'), sliceCount(), windowMinutes());
    if (err) err.textContent = why || '';
    if (why) { call('toast', 'bad', t === 'oco' ? 'OCO not placed' : 'TWAP not started', why); return; }
    clearAlgo();
    $('amt').value = '';
    for (const f of ['recalc', 'renderOrders', 'updateNavBal', 'saveP', 'drawCoinChart']) call(f);
    call('CBXpreview');
    return;
  }
  const ticket: Ticket = {
    type: t, side: S.side, sym: S.coin, quote: S.quote, amt: num('amt'),
    limit: ((t === 'limit' || t === 'stopl') && num('limPx')) || 0,
    stop: ((t === 'stop' || t === 'stopl') && num('stopPx')) || 0,
    tif: c.TIF, postOnly: c.POST, reduceOnly: c.REDUCE, tolerancePct: realismOf(S).tolerancePct,
  };
  const real = realismOf(S);
  const gasText = (q: number) => n(q) + ' ' + S.quote;
  const pe = usePaperEngine({
    engine: cbx(),
    price: legacy.pairPrice,
    held: s => S.bal[s] || 0,
    afford: (side, sym, quote, qty, px, rate, net) => affordable(S, side, sym, quote, qty, px, rate, net),
    // In Advanced the engine has priced the fill (venue rate, and this transaction's gas on-chain);
    // Beginner fills go through untouched, exactly as before.
    fill: (side, sym, quote, qty, px, rate, label, net, meta) => withFillMeta(meta || { asked: qty, mevQuote: 0 }, () => (real.mode === 'advanced'
      ? withPricedFill(net, () => c.fillWith(side, sym, quote, qty, px, rate, label))
      : c.fillWith(side, sym, quote, qty, px, rate, label))),
    charge: (quote, amount, note) => chargeNetwork(S, quote, amount, note),
    network: () => (onChain(real) ? {
      signal: gasSignal(), tier: tierOf(S), chg24: (legacy.coin(S.coin) || { c24: 0 }).c24 || 0,
      cost: (units: number, gwei: number) => gasIn(S.quote, units, gwei), mev: mevOn(S),
    } : null),
    place: (type, side, sym, quote, qty, px, extra) => call('placeAdvOrder', type, side, sym, quote, qty, px, extra),
    emit: (e: PaperEvent) => {
      if (e.type === 'network') {
        const f = e.report.fate;
        if (f.fate === 'included' || f.fate === 'pending') call('toast', f.fate === 'pending' ? 'warn' : 'good', f.fate === 'pending' ? 'Swap was pending' : 'Swap mined', explainFate(f, gasText(e.report.gasPaid)));
      } else if (e.type === 'sandwiched') {
        call('toast', 'bad', 'Sandwiched by an MEV bot', explainMev(e.mev, gasText, fmtPct(ticket.tolerancePct || 0)) + ' ' + LABS.mev.label + '.');
      } else if (e.type === 'filled') {
        const x = e.exec, partial = e.rest > 1e-9;
        call('toast', partial ? 'warn' : 'good', partial ? 'Partially filled' : 'Order filled',
          n(e.filled) + ' / ' + n(ticket.amt) + ' ' + S.coin + ' @ ' + n(x.avg) + ' ' + S.quote + (x.amm ? ' · price impact ' + fmtPct(x.amm.impactPct) : ' · slip ' + x.slipBps.toFixed(1) + ' bp') + ' · ' +
          (x.maker ? 'maker' : 'taker') + ' fee ' + (100 * x.feeRate).toFixed(3) + '%' + (partial ? ' · ' + ((e.filled / ticket.amt) * 100).toFixed(0) + '% of your size' : ''));
        call('bookImpulse', 'shock'); call('fillFx', S.side);
      } else if (e.remainder.kind === 'cancel') {
        call('toast', 'warn', 'Remainder cancelled', n(e.rest) + ' ' + S.coin + ' could not fill and ' + (e.remainder.by === 'ioc' ? 'IOC cancelled it' : e.remainder.by === 'pool' ? "the pool's range ran out — a swap takes what the pool has and returns the rest" : 'the book ran out') + '.');
      } else if (e.remainder.kind === 'rest') {
        call('toast', 'good', 'Remainder working', n(e.rest) + ' ' + S.coin + ' resting at ' + n(e.remainder.px) + ' — ' + n(e.ahead) + ' ' + S.coin + ' is queued ahead of you at that price.');
      }
    },
  });
  const o = pe.submit(ticket);
  if (o.status === 'invalid') { if (err) err.textContent = o.message; return; }
  if (err) err.textContent = '';
  if (o.status === 'armed') {
    const up = o.arm.extra.armAbove, lim = ticket.limit;
    call('toast', 'good', 'Stop order armed', (S.side === 'buy' ? 'Buys' : 'Sells') + ' ' + n(ticket.amt) + ' ' + S.coin + ' when price ' + (up ? 'rises to' : 'falls to') + ' ' + n(ticket.stop) + (lim ? ' · then works a limit at ' + n(lim) : ' · at market'));
    $('amt').value = ''; call('CBXpreview'); call('recalc'); call('saveP');
    return;
  }
  if (o.status === 'rejected') { if (err) err.textContent = o.reason; call('toast', 'bad', 'Order rejected', o.reason); return; }
  if (o.status === 'dropped' || o.status === 'reverted') {
    const why = explainFate(o.network.fate, gasText(o.network.gasPaid)) + (o.status === 'reverted' ? ' (' + o.reason + ')' : '') + ' ' + LABS.mev.label + '.';
    if (err) err.textContent = why;
    call('toast', 'bad', o.status === 'dropped' ? 'Swap never picked up' : 'Swap reverted on-chain', why);
    for (const f of ['recalc', 'updateNavBal', 'saveP']) call(f);
    return;
  }
  if (o.status === 'unfunded') {
    const x = o.exec;
    // on-chain the wallet also needs the gas (quoted in the same asset)
    const gas = onChain(real) ? gasIn(S.quote, GAS_UNITS.swap, gasSignal().gwei * TIER_MULT[tierOf(S)]) : 0;
    if (err) err.textContent = S.side === 'buy' ? 'Not enough ' + S.quote + '. That fill needs ~' + n(x.filled * x.avg * (1 + x.feeRate) + gas) + (gas ? ' including ~' + n(gas) + ' gas' : '') + '.' : 'Not enough ' + S.coin + '. You hold ' + n(S.bal[S.coin] || 0) + '.';
    return;
  }
  $('amt').value = ''; call('CBXpreview');
  for (const f of ['recalc', 'renderPosition', 'renderOrders', 'updateNavBal', 'saveP', 'drawCoinChart']) call(f);
}
