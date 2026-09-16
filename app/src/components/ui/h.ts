/**
 * h() — the element factory every component uses. It deliberately has NO `style` prop and no
 * innerHTML: presentation comes from registry classes (design/classes.ts), content is text or
 * child nodes. That makes "no inline styles" and "no HTML injection" properties of the type system.
 */
import type { ClassName } from '../../design/classes';

export type Child = Node | string | number | null | undefined | false;
export interface Props {
  readonly class?: readonly (ClassName | false | null | undefined)[];
  readonly id?: string;
  readonly role?: string;
  readonly title?: string;
  readonly href?: string;
  readonly type?: string;
  readonly aria?: Readonly<Record<string, string>>;
  readonly data?: Readonly<Record<string, string>>;
  readonly vars?: Readonly<Record<`--${string}`, string>>;
  readonly on?: Readonly<Partial<Record<'click' | 'input' | 'keydown' | 'change', (e: Event) => void>>>;
  readonly attrs?: Readonly<Record<string, string>>;
}

export function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  const cls = (props.class || []).filter(Boolean) as string[];
  if (cls.length) el.className = cls.join(' ');
  if (props.id) el.id = props.id;
  if (props.role) el.setAttribute('role', props.role);
  if (props.title) el.title = props.title;
  if (props.href) el.setAttribute('href', props.href);
  if (props.type) el.setAttribute('type', props.type);
  for (const [k, val] of Object.entries(props.aria || {})) el.setAttribute('aria-' + k, val);
  for (const [k, val] of Object.entries(props.data || {})) el.dataset[k] = val;
  for (const [k, val] of Object.entries(props.attrs || {})) el.setAttribute(k, val);
  // Custom properties only (a component may parameterise a registry rule, e.g. --cols) — never a raw style.
  for (const [k, val] of Object.entries(props.vars || {})) el.style.setProperty(k, val);
  for (const [ev, fn] of Object.entries(props.on || {})) if (fn) el.addEventListener(ev, fn);
  append(el, children);
  return el;
}

export function append(el: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Replace an element's children in one go. */
export function mountInto(host: Element, node: Node): void {
  host.replaceChildren(node);
}
