/**
 * The bot equity curve, with the underwater drawdown drawn beneath it.
 *
 * On a canvas, like the Rewind chart, and for the same reason: it reads every colour out of the
 * design tokens the document has resolved, so Day and Night, and any future palette change, come
 * for free and no literal is ever written here.
 *
 * The two series do not share an x index — the equity curve has one point per BAR CLOSE and the
 * wallet's underwater series has one point per MARK (open, low, high, close, plus every live
 * price) — so both are plotted against their own timestamps over one shared time axis. Drawing
 * them against a common array index instead would silently stretch one of them.
 *
 * THE TROUGH DRAWN HERE IS NOT THE MAXIMUM DRAWDOWN. `Wallet.equity` is thinned two-for-one past
 * MAX_POINTS (1,800 marks), so on a long run the deepest mark may be one of the points that was
 * dropped and the drawn trough can read shallower than the truth. The wallet accumulates `maxDD`
 * BEFORE thinning, so `Score.maxDDPct` is the number of record and it is the one printed — as a
 * label, from the score, never measured off this picture.
 */
import type { Curve, Underwater } from '../lib/bots/metrics';

export interface CurveView {
  /** [t, equity] at each bar close — the drawn line */
  readonly curve: Curve;
  /** the wallet's drawdown shape, from every mark it took */
  readonly under: Underwater;
  readonly start: number;
  /** Score.maxDDPct — the wick-aware number of record, printed rather than measured off the draw */
  readonly maxDDPct: number;
  fmt(n: number): string;
}

const tok = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; } catch { return '#888'; }
};
const dpr = (): number => Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);

/**
 * The NARROWEST ancestor box, not the immediate parent.
 *
 * A canvas's width attribute is an intrinsic size, so measuring the canvas's own box to decide
 * what to set that attribute to is a loop. Measuring only the parent is not enough either: the
 * Build tab's grid track is sized by the rule builder and, on a 393 px phone, is 743 px wide
 * inside a 362 px column that clips it. A drawing has to fit the narrowest box between it and the
 * viewport, or its right-hand half is simply not there.
 */
function boxWidth(cv: HTMLCanvasElement): number {
  let w = Infinity, el: HTMLElement | null = cv.parentElement;
  for (let i = 0; el && i < 8; i++, el = el.parentElement) { const c = el.clientWidth; if (c > 0 && c < w) w = c; }
  return Number.isFinite(w) ? w : 0;
}

function surface(cv: HTMLCanvasElement, h: number): CanvasRenderingContext2D | null {
  const box = boxWidth(cv);
  // A hidden or not-yet-laid-out box measures 0. Substituting a guess there is what starts the
  // runaway: the guess becomes the canvas's intrinsic width, the intrinsic width widens the box,
  // and the next paint measures the guess back. Nothing is drawn until there is a real box.
  if (!(box > 0)) return null;
  const w = Math.max(240, Math.round(box));
  const k = dpr();
  if (cv.width !== Math.round(w * k) || cv.height !== Math.round(h * k)) { cv.width = Math.round(w * k); cv.height = Math.round(h * k); }
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const x = cv.getContext('2d');
  if (!x) return null;
  x.setTransform(k, 0, 0, k, 0, 0);
  x.clearRect(0, 0, w, h);
  return x;
}

/** at most one point per pixel — a 1,800-mark series drawn at 300 px is 1,500 wasted line ops */
function thinTo(points: Curve, px: number): Curve {
  if (points.length <= px || px < 2) return points;
  const step = points.length / px, out: (readonly [number, number])[] = [];
  for (let i = 0; i < px; i++) out.push(points[Math.floor(i * step)]!);
  const last = points[points.length - 1];
  if (last) out.push(last);
  return out;
}

export function draw(cv: HTMLCanvasElement, v: CurveView): void {
  const H = 260, gut = 58, pad = 10, uwH = 66;
  const x = surface(cv, H);
  if (!x) return;
  const W = cv.width / dpr();
  const acc = tok('--cyan'), down = tok('--down'), line = tok('--line'), muted = tok('--muted'), gold = tok('--gold');
  x.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace';
  if (v.curve.length < 2) { x.fillStyle = muted; x.fillText('No curve yet — run a backtest, or let a bot mark a few bars.', pad, H / 2); return; }

  const plot = Math.max(40, W - gut - pad), eqH = H - uwH - pad * 3;
  const ts = [v.curve[0]![0], v.curve[v.curve.length - 1]![0]];
  const t0 = Math.min(ts[0]!, v.under.series[0]?.[0] ?? ts[0]!);
  const t1 = Math.max(ts[1]!, v.under.series[v.under.series.length - 1]?.[0] ?? ts[1]!);
  const span = t1 - t0 || 1;
  const px = (t: number): number => pad + ((t - t0) / span) * plot;

  let hi = v.start, lo = v.start;
  for (const p of v.curve) { if (p[1] > hi) hi = p[1]; if (p[1] < lo) lo = p[1]; }
  const eqSpan = hi - lo || hi || 1, ey = (e: number): number => pad + eqH - ((e - lo) / eqSpan) * eqH;

  // the equity band: four gridlines, the stake as a dashed reference, the curve on top
  x.strokeStyle = line; x.fillStyle = muted; x.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const e = lo + (eqSpan * k) / 3, yy = Math.round(ey(e)) + 0.5;
    x.beginPath(); x.moveTo(pad, yy); x.lineTo(pad + plot, yy); x.stroke();
    x.fillText(v.fmt(e), pad + plot + 6, yy + 3);
  }
  x.strokeStyle = gold; x.setLineDash([3, 3]); x.beginPath();
  x.moveTo(pad, Math.round(ey(v.start)) + 0.5); x.lineTo(pad + plot, Math.round(ey(v.start)) + 0.5); x.stroke(); x.setLineDash([]);
  x.strokeStyle = acc; x.lineWidth = 1.7; x.beginPath();
  thinTo(v.curve, Math.round(plot)).forEach((p, i) => { const xx = px(p[0]), yy = ey(p[1]); if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); });
  x.stroke();

  // the underwater band beneath it: 0% at the top, deeper is lower, filled from the surface
  const top = pad * 2 + eqH, deep = Math.max(v.under.maxPct, v.maxDDPct, 1);
  const uy = (d: number): number => top + (Math.min(d, deep) / deep) * uwH;
  x.strokeStyle = line; x.beginPath(); x.moveTo(pad, top + 0.5); x.lineTo(pad + plot, top + 0.5); x.stroke();
  x.fillStyle = muted; x.fillText('0%', pad + plot + 6, top + 4); x.fillText('−' + deep.toFixed(1) + '%', pad + plot + 6, top + uwH + 4);
  const uw = thinTo(v.under.series, Math.round(plot));
  if (uw.length > 1) {
    x.beginPath(); x.moveTo(px(uw[0]![0]), top);
    for (const p of uw) x.lineTo(px(p[0]), uy(p[1]));
    x.lineTo(px(uw[uw.length - 1]![0]), top); x.closePath();
    x.globalAlpha = 0.28; x.fillStyle = down; x.fill(); x.globalAlpha = 1;
    x.strokeStyle = down; x.lineWidth = 1.2; x.beginPath();
    uw.forEach((p, i) => { const xx = px(p[0]), yy = uy(p[1]); if (i) x.lineTo(xx, yy); else x.moveTo(xx, yy); });
    x.stroke();
  }
  x.fillStyle = muted;
  x.fillText('underwater · worst ' + v.maxDDPct.toFixed(2) + '%', pad + 2, top + uwH - 4);
}
