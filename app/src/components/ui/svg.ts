/**
 * sv() — the SVG counterpart of h(). Same laws: no style attribute, no innerHTML, no colour.
 * Every illustration in the app is drawn from these primitives and painted by registry classes
 * (design/blog.ts), so a figure follows the design tokens and both appearances for free.
 */
import type { ClassName } from '../../design/classes';

const NS = 'http://www.w3.org/2000/svg';
export type SvgChild = SVGElement | string | null | undefined | false;
export interface SvgProps {
  readonly class?: readonly (ClassName | false | null | undefined)[];
  /** geometry and presentation attributes only — `style` is rejected by the type and at runtime */
  readonly attrs?: Readonly<Record<string, string | number>>;
  readonly aria?: Readonly<Record<string, string>>;
  readonly role?: string;
}

export function sv(tag: string, props: SvgProps = {}, ...children: SvgChild[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  const cls = (props.class || []).filter(Boolean) as string[];
  if (cls.length) el.setAttribute('class', cls.join(' '));
  if (props.role) el.setAttribute('role', props.role);
  for (const [k, v] of Object.entries(props.attrs || {})) if (k !== 'style') el.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(props.aria || {})) el.setAttribute('aria-' + k, v);
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** A decorative canvas: fixed viewBox, scales to its container, invisible to screen readers. */
export function canvas(w: number, h: number, cls: readonly (ClassName | false)[], ...children: SvgChild[]): SVGElement {
  return sv('svg', { class: cls, attrs: { viewBox: `0 0 ${w} ${h}`, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet', focusable: 'false' }, aria: { hidden: 'true' } }, ...children);
}

export const path = (d: string, cls: readonly (ClassName | false)[], attrs: Record<string, string | number> = {}): SVGElement => sv('path', { class: cls, attrs: { d, ...attrs } });
export const rect = (x: number, y: number, w: number, h: number, cls: readonly (ClassName | false)[], attrs: Record<string, string | number> = {}): SVGElement => sv('rect', { class: cls, attrs: { x, y, width: w, height: h, ...attrs } });
export const circle = (cx: number, cy: number, r: number, cls: readonly (ClassName | false)[], attrs: Record<string, string | number> = {}): SVGElement => sv('circle', { class: cls, attrs: { cx, cy, r, ...attrs } });
export const line = (x1: number, y1: number, x2: number, y2: number, cls: readonly (ClassName | false)[], attrs: Record<string, string | number> = {}): SVGElement => sv('line', { class: cls, attrs: { x1, y1, x2, y2, ...attrs } });
export const text = (x: number, y: number, cls: readonly (ClassName | false)[], s: string, attrs: Record<string, string | number> = {}): SVGElement => sv('text', { class: cls, attrs: { x, y, ...attrs } }, s);
