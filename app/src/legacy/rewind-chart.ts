/**
 * The Rewind desk's chart: candles for the bars replayed so far, the trader's fills marked on
 * them, and the equity curve underneath. Drawn on a canvas — so it reads its colours from the
 * design tokens the document resolves (never a literal), and redraws on every bar.
 */
import type { BtFill, Candle } from '../lib/backtest';

export interface ChartView {
  readonly bars: readonly Candle[];
  readonly fills: readonly BtFill[];
  readonly equity: readonly number[];
  readonly start: number;
  /** bars of context drawn before the run's first bar */
  readonly context: number;
  fmt(n: number): string;
}

const tok = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; } catch { return '#888'; }
};

/** Fit the canvas to its box at device resolution and return the 2d context. */
function surface(cv: HTMLCanvasElement, h: number): CanvasRenderingContext2D | null {
  const w = Math.max(320, Math.round(cv.clientWidth || cv.parentElement?.clientWidth || 640));
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cv.style.height = h + 'px';
  const x = cv.getContext('2d');
  if (!x) return null;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  return x;
}

export function draw(cv: HTMLCanvasElement, v: ChartView): void {
  const H = 320, eqH = 74, pad = 8, gut = 62;
  const x = surface(cv, H);
  if (!x) return;
  const W = (cv.width / Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
  const up = tok('--up'), down = tok('--down'), line = tok('--line'), ink = tok('--muted'), acc = tok('--cyan'), warn = tok('--gold');
  const bars = v.bars.slice(-220);
  x.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace';
  if (!bars.length) { x.fillStyle = ink; x.fillText('No bars loaded yet.', pad + 4, H / 2); return; }
  const priceH = H - eqH - pad * 2;
  let hi = -Infinity, lo = Infinity;
  for (const b of bars) { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; }
  const span = hi - lo || hi || 1, y = (p: number): number => pad + priceH - ((p - lo) / span) * priceH;
  const plot = W - gut - pad, bw = Math.max(1.2, (plot / bars.length) * 0.72), step = plot / bars.length;
  const cx = (i: number): number => pad + i * step + step / 2;
  // grid + price ladder
  x.strokeStyle = line; x.fillStyle = ink; x.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const p = lo + (span * k) / 4, yy = Math.round(y(p)) + 0.5;
    x.beginPath(); x.moveTo(pad, yy); x.lineTo(W - gut, yy); x.stroke();
    x.fillText(v.fmt(p), W - gut + 6, yy + 3);
  }
  // candles (the context is dimmed: those bars were never tradable)
  const ctx = Math.max(0, v.context - Math.max(0, v.bars.length - 220));
  bars.forEach((b, i) => {
    const rise = b.c >= b.o;
    x.globalAlpha = i < ctx ? 0.38 : 1;
    x.strokeStyle = rise ? up : down; x.fillStyle = rise ? up : down;
    const m = cx(i);
    x.beginPath(); x.moveTo(m, y(b.h)); x.lineTo(m, y(b.l)); x.stroke();
    const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
    x.fillRect(m - bw / 2, top, bw, Math.max(1, bot - top));
  });
  x.globalAlpha = 1;
  // fills
  const first = v.bars.length - bars.length;
  for (const f of v.fills) {
    const i = f.bar + v.context - first;
    if (i < 0 || i >= bars.length) continue;
    const m = cx(i), yy = y(f.px), r = 4.5;
    x.fillStyle = f.side === 'buy' ? up : down; x.strokeStyle = tok('--surface-2'); x.lineWidth = 1.5;
    x.beginPath();
    if (f.side === 'buy') { x.moveTo(m, yy - r); x.lineTo(m + r, yy + r); x.lineTo(m - r, yy + r); }
    else { x.moveTo(m, yy + r); x.lineTo(m + r, yy - r); x.lineTo(m - r, yy - r); }
    x.closePath(); x.fill(); x.stroke();
  }
  // equity curve
  const eq = v.equity.slice(-220);
  const base = H - eqH, eqTop = base + 10;
  x.strokeStyle = line; x.beginPath(); x.moveTo(pad, base + 0.5); x.lineTo(W - gut, base + 0.5); x.stroke();
  x.fillStyle = ink; x.fillText('equity', pad, base + 12);
  if (eq.length > 1) {
    let emax = -Infinity, emin = Infinity;
    for (const e of eq) { if (e > emax) emax = e; if (e < emin) emin = e; }
    emax = Math.max(emax, v.start); emin = Math.min(emin, v.start);
    const es = emax - emin || 1, ey = (e: number): number => eqTop + (eqH - 22) - ((e - emin) / es) * (eqH - 22);
    const estep = (W - gut - pad) / Math.max(1, eq.length - 1);
    x.strokeStyle = warn; x.setLineDash([3, 3]); x.beginPath();
    x.moveTo(pad, ey(v.start)); x.lineTo(W - gut, ey(v.start)); x.stroke(); x.setLineDash([]);
    x.strokeStyle = acc; x.lineWidth = 1.6; x.beginPath();
    eq.forEach((e, i) => { const px = pad + i * estep, py = ey(e); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
    x.fillStyle = ink; x.fillText(v.fmt(eq[eq.length - 1]!), W - gut + 6, ey(eq[eq.length - 1]!) + 3);
    x.fillText(v.fmt(v.start), W - gut + 6, ey(v.start) + 3);
  }
}
