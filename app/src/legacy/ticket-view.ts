/**
 * The order ticket's preview and realism controls (view half). Replaces the legacy CBXpreview
 * string builder: it asks the SAME engine call the fill will make (with the same tolerance) and
 * renders the typed OrderPreview. In Advanced mode it adds the slippage-tolerance control above
 * the preview; on the DEX venue, the priority fee and the (opt-in) MEV bots. No trading decision is made here.
 */
import { OrderPreview } from '../components/domain/order-preview';
import { Segmented } from '../components/ui/segmented';
import { cbx, realismOf, onChain, tierOf, gasIn, mevOn, mevOf } from './paper';
import { signal as gasSignal } from './gas-feed';
import { congestion, pendingRisk, timeoutRisk, GAS_UNITS, TIER_MULT } from '../lib/paper-engine/gas';
import { labFor, type LabId } from '../lib/paper-engine/lessons';
import { legacy, type LegacyState } from './globals';
import { sync as syncAlgo, sliceCount } from './algo-ui';

/** Advanced mode's long-form explanation: the v156 engine article in the Blog. */
export const GUIDE = { label: 'How Advanced execution works (Blog)', href: '#/blog/advanced-execution-engine' } as const;

export interface PreviewCtx { readonly TIF: string; readonly POST: boolean; n(v: number): string }

/** The tolerance steps a trader picks from (percent). 0.5% is the common DEX default. */
export const TOLERANCES = [0.1, 0.5, 1, 3] as const;

const $ = (id: string): any => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const num = (id: string): number => parseFloat(($(id) || {}).value);

function hide(host: HTMLElement): void { host.style.display = 'none'; host.replaceChildren(); }

/** The Academy's own openers for each lab (legacy globals). */
const LAB_OPENERS: Readonly<Record<LabId, string>> = { mev: 'openMevGame', amm: 'openDefiLab' };
export function openLab(id: LabId): void { legacy.call(LAB_OPENERS[id]); }

/** Mount, refresh or remove one realism control just above the preview (focus survives a refresh). */
function syncSeg(host: HTMLElement, id: string, show: boolean, make: () => HTMLElement): void {
  const old = $(id) as HTMLElement | null;
  if (!show) { if (old) old.remove(); return; }
  const hadFocus = !!(old && old.contains(document.activeElement));
  const el = make();
  if (old) old.replaceWith(el); else host.parentNode?.insertBefore(el, host);
  if (hadFocus) (el.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
}

function setSim(S: LegacyState, k: string, v: unknown): void {
  (S.dlsim || (S.dlsim = {}))[k] = v; legacy.call('saveP'); legacy.call('CBXpreview');
}

/** Advanced: slippage tolerance. On-chain (DEX): priority fee and the opt-in MEV bots. */
function syncControls(S: LegacyState, host: HTMLElement): void {
  const r = realismOf(S), chain = onChain(r);
  syncSeg(host, 'dlxTol', r.mode === 'advanced', () => Segmented({
    id: 'dlxTol', label: 'Slippage tolerance', value: String(r.tolerancePct),
    options: TOLERANCES.map(v => ({ value: String(v), label: v + '%', title: 'Reject the order if its price impact is above ' + v + '%' })),
    onChange: v => setSim(S, 'slipTol', +v),
  }));
  syncSeg(host, 'dlxPrio', chain, () => Segmented({
    id: 'dlxPrio', label: 'Priority fee', value: tierOf(S),
    options: [
      { value: 'low', label: 'Low', title: 'Cheapest gas — may wait blocks or never be picked up when the chain is busy' },
      { value: 'medium', label: 'Medium', title: 'The usual tip — almost always in the next block or two' },
      { value: 'high', label: 'High', title: 'Pay more gas to jump the queue' },
    ],
    onChange: v => setSim(S, 'tier', v),
  }));
  syncSeg(host, 'dlxMev', chain, () => Segmented({
    id: 'dlxMev', label: 'MEV bots', value: mevOn(S) ? 'on' : 'off',
    options: [
      { value: 'off', label: 'Off', title: 'Practice without sandwich bots' },
      { value: 'on', label: 'On', title: 'Simulated bots watch the public mempool and sandwich swaps whose tolerance leaves them room' },
    ],
    onChange: v => setSim(S, 'mev', v === 'on'),
  }));
}

export function preview(c: PreviewCtx): void {
  const host = $('cbxPrev') as HTMLElement | null, S = legacy.S();
  if (!host || !S) return;
  syncControls(S, host);
  const t = S.ordType as string, amt = num('amt');
  const algo = syncAlgo(S);                    // OCO / TWAP rows follow the tab
  if (algo === 'oco' || t === 'dca' || t === 'grid' || !(amt > 0)) return hide(host);
  // a TWAP's preview is ONE slice: the impact, fee and gas this order will meet, N times over
  const size = algo === 'twap' ? amt / Math.max(1, sliceCount()) : amt;
  const lim = ((t === 'limit' || t === 'stopl') && num('limPx')) || 0;
  const p = cbx().preview(S.coin, S.quote, S.side, size, {
    limit: t === 'market' || t === 'stop' ? 0 : lim, type: t, postOnly: c.POST, tolerancePct: realismOf(S).tolerancePct,
    ...(mevOf(S) ? { mev: mevOf(S)! } : {}),
  });
  if (!p) return hide(host);
  host.className = '';
  host.style.display = '';
  const real = realismOf(S);
  let network;
  if (onChain(real)) {
    const g = gasSignal(), tier = tierOf(S);
    network = {
      gwei: g.gwei, congestion: congestion(g), source: g.practice ? 'practice' : g.source === 'node' ? 'your node' : g.source, tier,
      costQuote: gasIn(S.quote, GAS_UNITS.swap, g.gwei * TIER_MULT[tier]), pendingRisk: pendingRisk(g, tier), timeoutRisk: timeoutRisk(g, tier),
    };
  }
  const lab = labFor(p.amm, null);
  host.replaceChildren(OrderPreview({
    preview: p, qty: size, base: S.coin, quote: S.quote, tif: c.TIF, fmt: c.n, ...(network ? { network } : {}), mev: mevOn(S),
    ...(lab ? { learn: { label: lab.label, open: () => openLab(lab.id) } } : {}),
    ...(real.mode === 'advanced' ? { guide: GUIDE } : {}),
  }));
}
