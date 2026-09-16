/** Shared drawing kit for the blog's figures: a ground, a grid, labels, small parts. */
import { sv, canvas, path, rect, circle, line, text, type SvgChild } from '../../ui/svg';
import { CX, type ClassName } from '../../../design/classes';

export { sv, canvas, path, rect, circle, line, text };
export type { SvgChild };

/** The faint background grid every figure sits on. */
export function grid(w: number, h: number, step = 64): SVGElement {
  const d: string[] = [];
  for (let x = step; x < w; x += step) d.push(`M${x} 0V${h}`);
  for (let y = step; y < h; y += step) d.push(`M0 ${y}H${w}`);
  return path(d.join(''), [CX.fGrid]);
}

/** A small uppercase caption inside the drawing. */
export const label = (x: number, y: number, s: string, tone: 'muted' | 'ink' | 'acc' = 'muted', anchor = 'start'): SVGElement =>
  text(x, y, [CX.fLabel, tone === 'ink' ? CX.fInk : tone === 'acc' ? CX.fAcc : CX.fMuted], s, { 'text-anchor': anchor });

/** A rounded plate — the building block of every "card" inside a figure. */
export const plate = (x: number, y: number, w: number, h: number, tone: 'surface' | 'acc' | 'warm' | 'gain' | 'loss' = 'surface'): SVGElement =>
  rect(x, y, w, h, [tone === 'surface' ? CX.fSurface : tone === 'acc' ? CX.fAcc : tone === 'warm' ? CX.fWarm : tone === 'gain' ? CX.fGain : CX.fLoss, tone !== 'surface' && CX.fThin], { rx: 8, 'fill-opacity': tone === 'surface' ? 1 : 0.18, 'stroke-width': 1.4 });

/** A ladder rung: the brand motif — a wick with a rounded body on it. */
export function rung(x: number, y: number, w = 26, h = 40, wick = 22, tone: ClassName = CX.fAcc): SVGElement {
  return sv('g', {},
    line(x + w / 2, y - wick, x + w / 2, y + h + wick, [tone, CX.fThin], { 'stroke-width': 3 }),
    rect(x, y, w, h, [tone], { rx: 6, 'fill-opacity': 0.9 }));
}

/** An arrow between two points (straight, with a head). */
export function arrow(x1: number, y1: number, x2: number, y2: number, tone: ClassName = CX.fMuted, dashed = false): SVGElement {
  const a = Math.atan2(y2 - y1, x2 - x1), hx = x2 - Math.cos(a) * 9, hy = y2 - Math.sin(a) * 9, s = 5;
  return sv('g', {},
    line(x1, y1, hx, hy, [tone, dashed ? CX.fDash : CX.fThin]),
    path(`M${x2} ${y2}L${hx - Math.sin(a) * s} ${hy + Math.cos(a) * s}L${hx + Math.sin(a) * s} ${hy - Math.cos(a) * s}Z`, [tone]));
}

/** y = k/x as a path across [x0,x1], mapped into the box. */
export function hyperbola(x0: number, y0: number, w: number, h: number, k = 0.55): string {
  // y = k/t over t ∈ [k, k + 1.6]: the first point sits at the top of the box and the curve
  // falls away convexly — the shape of x·y = k, never a clipped flat run.
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = k + (i / 48) * 1.6, x = x0 + (i / 48) * w, y = y0 + h - (k / t) * h;
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join('');
}
