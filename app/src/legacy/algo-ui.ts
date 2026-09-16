/**
 * The ticket's two new tabs — OCO and TWAP — mounted into the legacy order ticket.
 * Controls come from the design system (TradeInput, Segmented); the decisions live in
 * legacy/algo.ts, the arithmetic in lib/paper-engine/algo.ts.
 */
import { h } from '../components/ui/h';
import { TradeInput, parseAmount } from '../components/ui/trade-input';
import { Segmented } from '../components/ui/segmented';
import { CX } from '../design/classes';
import { SLICE_CHOICES, WINDOW_CHOICES, describe } from '../lib/paper-engine/algo';
import { realismOf, onChain } from './paper';
import { legacy, type LegacyState } from './globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const call = legacy.call;
const $ = (id: string): any => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const HOST = 'dlxAlgoRows';
const state = { slices: 6, minutes: 15 };

export const sliceCount = (): number => state.slices;
export const windowMinutes = (): number => state.minutes;
export const ocoPrices = (): { tp: number; sl: number } => ({ tp: parseAmount(($('dlxOcoTp') || { value: '' }).value) || 0, sl: parseAmount(($('dlxOcoSl') || { value: '' }).value) || 0 });

const label = (m: number): string => (m >= 60 ? m / 60 + ' h' : m + ' min');

function rows(S: LegacyState): HTMLElement {
  const note = h('p', { class: [CX.previewNote], id: 'dlxTwapNote' });
  const seg = (id: string, lab: string, vals: readonly number[], cur: number, unit: (n: number) => string, set: (n: number) => void) =>
    Segmented({ id, label: lab, value: String(cur), options: vals.map(v => ({ value: String(v), label: unit(v) })), onChange: v => { set(+v); render(); call('CBXpreview'); } });
  const host = h('div', { id: HOST },
    h('div', { id: 'dlxOcoRow' },
      TradeInput({ id: 'dlxOcoTp', label: 'Take-profit price', unit: S.quote, placeholder: '0.00', onInput: () => call('CBXpreview') }),
      TradeInput({ id: 'dlxOcoSl', label: 'Stop-loss price', unit: S.quote, placeholder: '0.00', onInput: () => call('CBXpreview') }),
      h('p', { class: [CX.previewNote] }, 'One decision, two legs: whichever fills first cancels the other.')),
    h('div', { id: 'dlxTwapRow' },
      seg('dlxTwapN', 'Slices', SLICE_CHOICES, state.slices, n => String(n), n => { state.slices = n; }),
      seg('dlxTwapW', 'Worked over', WINDOW_CHOICES, state.minutes, label, n => { state.minutes = n; }),
      note));
  return host;
}

function render(): void {
  const S = legacy.S(), note = $('dlxTwapNote');
  if (!S || !note) return;
  const amt = parseAmount(($('amt') || { value: '' }).value) || 0;
  note.textContent = amt > 0
    ? describe(amt, state.slices, state.minutes, S.coin, onChain(realismOf(S)))
    : 'Enter the total size to work; it is cut into equal slices sent at a fixed interval.';
}

/** Mount once, then show the row the current tab needs (called from every ticket preview). */
export function sync(S: LegacyState): 'oco' | 'twap' | null {
  const t = String(S.ordType || '');
  const tabs = $('ordTabs');
  if (tabs && !tabs.dataset.dlxAlgo) {
    tabs.dataset.dlxAlgo = '1';
    const mk = (k: string, l: string, title: string) => h('button', { type: 'button', title, data: { o: k }, on: { click: () => call('setOrdType', k) } }, l);
    const dca = tabs.querySelector('[data-o="dca"]');
    tabs.insertBefore(mk('oco', 'OCO', 'Take-profit and stop-loss as one order: either one cancels the other'), dca);
    tabs.insertBefore(mk('twap', 'TWAP', 'Work a large order in equal slices over a window'), dca);
  }
  const anchor = $('cbxRows') || $('cbxPrev');
  if (!$(HOST) && anchor && anchor.parentNode) anchor.parentNode.insertBefore(rows(S), anchor.nextSibling);
  const oco = $('dlxOcoRow'), twap = $('dlxTwapRow');
  if (oco) oco.hidden = t !== 'oco';
  if (twap) twap.hidden = t !== 'twap';
  if (t === 'twap') render();
  return t === 'oco' || t === 'twap' ? (t as 'oco' | 'twap') : null;
}

/** Clear the OCO fields after a successful placement. */
export function clear(): void {
  for (const id of ['dlxOcoTp', 'dlxOcoSl']) { const el = $(id); if (el) el.value = ''; }
}
