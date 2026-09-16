/** One cover per post — drawn, never a file: 640×200, painted by tokens, both appearances. */
import { canvas, grid, plate, rung, arrow, hyperbola, path, rect, circle, line, sv } from './kit';
import { CX } from '../../../design/classes';

const W = 640, H = 200;
const ground = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.coverArt], grid(W, H, 64), ...kids.filter(Boolean) as SVGElement[]);
const RAIL = 'M150 44C400 44 430 156 120 156';

/** 1 · What is DexLadder — the brand rail with its three rising rungs. */
const ladder = (): SVGElement => ground(
  path(RAIL, [CX.fAcc, CX.fStroke], { 'stroke-width': 11 }),
  path(RAIL, [CX.fGain, CX.fStroke, CX.fFlow], { 'stroke-width': 3, opacity: 0.9 }),
  rung(300, 40, 26, 34, 16, CX.fAcc), rung(360, 76, 26, 34, 16, CX.fGain), rung(420, 112, 26, 34, 16, CX.fAcc2),
  circle(150, 44, 7, [CX.fAcc, CX.fPulse]), circle(120, 156, 7, [CX.fGain]),
  plate(480, 60, 120, 34), plate(480, 108, 78, 34, 'acc'));

/** 2 · The execution engine — the pool curve, the quote, the fill, the impact between them. */
const engine = (): SVGElement => ground(
  path(hyperbola(70, 34, 320, 128, 0.62), [CX.fAcc2, CX.fStroke]),
  circle(206, 96, 6, [CX.fGain]), circle(300, 134, 7, [CX.fLoss, CX.fPulse]),
  arrow(214, 102, 292, 128, CX.fLoss),
  plate(430, 44, 160, 26, 'warm'), plate(430, 82, 160, 26), plate(430, 120, 160, 26, 'acc'),
  rect(444, 52, 44, 10, [CX.fWarm], { rx: 5 }), rect(444, 90, 78, 10, [CX.fMuted], { rx: 5, opacity: 0.5 }), rect(444, 128, 60, 10, [CX.fAcc], { rx: 5 }));

/** 3 · Paper vs real — the same ladder twice: one solid, one only sketched. */
const twin = (): SVGElement => ground(
  path('M60 150C140 150 150 60 250 60', [CX.fAcc, CX.fStroke]),
  rung(110, 96, 22, 28, 12, CX.fAcc), rung(170, 70, 22, 28, 12, CX.fAcc),
  line(320, 24, 320, 176, [CX.fLine, CX.fDash]),
  path('M390 150C470 150 480 60 580 60', [CX.fMuted, CX.fDash]),
  rect(440, 96, 22, 28, [CX.fMuted, CX.fDash], { rx: 6 }), rect(500, 70, 22, 28, [CX.fMuted, CX.fDash], { rx: 6 }),
  circle(580, 60, 6, [CX.fLoss, CX.fPulse]));

/** 4 · Academy — the lesson constellation, the first stars lit. */
const constellation = (): SVGElement => {
  const pts = Array.from({ length: 12 }, (_, i) => [60 + i * 47, 130 - Math.sin(i * 0.72) * 52] as const);
  return ground(
    path(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''), [CX.fAcc2, CX.fThin, CX.fFlow], { 'stroke-width': 2 }),
    ...pts.map(([x, y], i) => circle(x, y, i < 4 ? 7 : 5, [i < 4 ? CX.fAcc : CX.fMuted, i === 4 && CX.fPulse], { 'fill-opacity': i < 4 ? 1 : 0.5 })));
};

/** 5 · Sovereignty — blocks chained by their hashes, sealed. */
const chain = (): SVGElement => ground(
  ...[0, 1, 2, 3].flatMap(i => [
    plate(70 + i * 130, 62, 96, 76, i === 3 ? 'acc' : 'surface'),
    rect(84 + i * 130, 78, 60, 8, [CX.fMuted], { rx: 4, opacity: 0.6 }),
    rect(84 + i * 130, 94, 44, 8, [CX.fAcc], { rx: 4, opacity: 0.8 }),
    i < 3 ? line(166 + i * 130, 100, 200 + i * 130, 100, [CX.fAcc, CX.fThin, CX.fFlow]) : circle(526, 100, 9, [CX.fGain, CX.fPulse])]),
  circle(560, 100, 26, [CX.fGain, CX.fThin], { 'fill-opacity': 0.12 }));

/** 6 · The desk — six destinations, meshed. */
const mesh = (): SVGElement => {
  const n = Array.from({ length: 6 }, (_, i) => [320 + Math.cos((i / 6) * 6.283 - 1.57) * 170, 100 + Math.sin((i / 6) * 6.283 - 1.57) * 66] as const);
  return ground(
    ...n.flatMap((a, i) => n.slice(i + 1).map(b => line(a[0], a[1], b[0], b[1], [CX.fLine, CX.fThin], { opacity: 0.5 }))),
    ...n.map(([x, y], i) => circle(x, y, 13, [i % 2 ? CX.fAcc : CX.fAcc2], { 'fill-opacity': 0.9 })),
    circle(320, 100, 8, [CX.fGain, CX.fPulse]));
};

/** 7 · How it is built — a pinned base, layers, one file. */
const stack = (): SVGElement => ground(
  ...[0, 1, 2, 3].map(i => plate(150 + i * 10, 150 - i * 32, 260 - i * 20, 26, i === 3 ? 'acc' : 'surface')),
  sv('g', { class: [CX.fRise] }, plate(430, 60, 120, 84), rect(448, 78, 84, 8, [CX.fAcc], { rx: 4 }), rect(448, 94, 60, 8, [CX.fMuted], { rx: 4, opacity: 0.6 }), rect(448, 110, 72, 8, [CX.fMuted], { rx: 4, opacity: 0.4 })),
  arrow(404, 104, 424, 104, CX.fAcc));

export const COVERS: Readonly<Record<string, () => SVGElement>> = Object.freeze({
  'what-is-dexladder': ladder,
  'advanced-execution-engine': engine,
  'paper-vs-real-dex-trading': twin,
  'academy-and-labs': constellation,
  'sovereignty-proof-ledger': chain,
  'p2p-explorer-and-the-desk': mesh,
  'how-dexladder-is-built': stack,
});
