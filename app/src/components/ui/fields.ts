import { h, type Child } from './h';
import { CX } from '../../design/classes';

/** A single-line text field (an address, a URL, an amount typed as text). */
export interface TextFieldProps { readonly id: string; readonly label: string; readonly value?: string; readonly placeholder?: string; readonly unit?: string; readonly wide?: boolean; onInput?(value: string): void; onEnter?(value: string): void }

export function TextField(p: TextFieldProps): HTMLElement {
  const input = h('input', {
    id: p.id, class: [CX.fieldInput],
    attrs: { autocomplete: 'off', spellcheck: 'false', placeholder: p.placeholder || '', value: p.value || '' },
    on: {
      input: (e: Event) => p.onInput?.((e.target as HTMLInputElement).value),
      keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); p.onEnter?.((e.target as HTMLInputElement).value); } },
    },
  });
  return h('label', { class: [CX.field, p.wide && CX.forkWide], attrs: { for: p.id } },
    h('span', { class: [CX.fieldLabel] }, p.label),
    h('span', { class: [CX.fieldBox] }, input, p.unit ? h('span', { class: [CX.fieldUnit] }, p.unit) : null));
}

/** A multi-line field, for an ABI or a blob of calldata. */
export interface TextAreaProps { readonly id: string; readonly label: string; readonly value?: string; readonly placeholder?: string; onInput?(value: string): void }

export function TextArea(p: TextAreaProps): HTMLElement {
  const area = h('textarea', {
    id: p.id, class: [CX.forkArea],
    attrs: { spellcheck: 'false', placeholder: p.placeholder || '' },
    on: { input: (e: Event) => p.onInput?.((e.target as HTMLTextAreaElement).value) },
  }, p.value || '');
  return h('label', { class: [CX.field, CX.forkWide], attrs: { for: p.id } }, h('span', { class: [CX.fieldLabel] }, p.label), area);
}

/** A one-of-many picker for a long list (a contract's functions), where segments would not fit. */
export interface SelectProps { readonly id: string; readonly label: string; readonly value: string; readonly options: readonly { readonly value: string; readonly label: string }[]; onChange?(value: string): void }

export function Select(p: SelectProps): HTMLElement {
  const sel = h('select', {
    id: p.id, class: [CX.forkSelect],
    on: { change: (e: Event) => p.onChange?.((e.target as HTMLSelectElement).value) },
  }, ...p.options.map(o => {
    const opt = h('option', { attrs: o.value === p.value ? { value: o.value, selected: 'selected' } : { value: o.value } }, o.label);
    return opt;
  }));
  return h('label', { class: [CX.field, CX.forkWide], attrs: { for: p.id } }, h('span', { class: [CX.fieldLabel] }, p.label), sel);
}

export interface ButtonProps { readonly id?: string; readonly label: string; readonly primary?: boolean; readonly disabled?: boolean; readonly title?: string; onClick(): void }

export function Button(p: ButtonProps): HTMLElement {
  return h('button', {
    class: [CX.forkBtn, p.primary && CX.forkBtnGo], type: 'button',
    ...(p.id ? { id: p.id } : {}), ...(p.title ? { title: p.title } : {}), ...(p.disabled ? { attrs: { disabled: 'disabled' } } : {}),
    on: { click: () => { if (!p.disabled) p.onClick(); } },
  }, p.label);
}

/** A row of controls. */
export const Bar = (...items: Child[]): HTMLElement => h('div', { class: [CX.forkBar] }, ...items);
