import { h } from './h';
import { CX } from '../../design/classes';

export interface TradeInputProps { readonly id: string; readonly label: string; readonly unit?: string; readonly value?: string; readonly placeholder?: string; onInput?(value: number | null, raw: string): void }

/**
 * A numeric ticket field. Parses on input and reports null for anything that is not a finite,
 * non-negative number — the presenter decides what an empty field means, the field never guesses.
 */
export function TradeInput(p: TradeInputProps): HTMLElement {
  const input = h('input', {
    id: p.id, class: [CX.fieldInput],
    attrs: { inputmode: 'decimal', autocomplete: 'off', placeholder: p.placeholder || '0.00', value: p.value || '' },
    on: { input: (e: Event) => { const raw = (e.target as HTMLInputElement).value; p.onInput?.(parseAmount(raw), raw); } },
  });
  return h('label', { class: [CX.field], attrs: { for: p.id } },
    h('span', { class: [CX.fieldLabel] }, p.label),
    h('span', { class: [CX.fieldBox] }, input, p.unit ? h('span', { class: [CX.fieldUnit] }, p.unit) : null));
}

/** "1,250.5" → 1250.5 ; "", "abc", "-3", "1e999" → null. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[,\s_]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
