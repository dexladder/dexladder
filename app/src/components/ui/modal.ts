import { h, type Child } from './h';
import { CX } from '../../design/classes';

export interface ModalHandle { readonly el: HTMLElement; open(): void; close(): void; readonly isOpen: () => boolean }

/**
 * An accessible modal: role=dialog + aria-modal, Esc and backdrop close, focus moves in on open
 * and back to the opener on close. The caller mounts `el` once (document.body).
 */
export function Modal(title: string, onClose?: () => void, ...body: Child[]): ModalHandle {
  let opener: Element | null = null;
  const close = (): void => {
    el.classList.remove(CX.on);
    if (opener instanceof HTMLElement) opener.focus();
    onClose?.();
  };
  const panel = h('div', { class: [CX.modalPanel], role: 'dialog', aria: { modal: 'true', label: title } },
    h('div', { class: [CX.modalHead] }, title, h('button', { class: [CX.modalClose], type: 'button', aria: { label: 'Close' }, on: { click: close } }, '✕')),
    h('div', { class: [CX.modalBody] }, ...body));
  const el = h('div', { class: [CX.modal], on: {
    click: (e: Event) => { if (e.target === el) close(); },
    keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') close(); },
  } }, panel);
  return {
    el,
    open() { opener = document.activeElement; el.classList.add(CX.on); (panel.querySelector('button') as HTMLElement | null)?.focus(); },
    close,
    isOpen: () => el.classList.contains(CX.on),
  };
}
