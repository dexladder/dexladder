/** Covers, part 3 — 640×200, drawn from tokens, correct in both appearances. */
import { canvas, grid, plate, rung, arrow, path, rect, circle, line, sv } from './kit';
import { CX, type ClassName } from '../../../design/classes';

const W = 640, H = 200;
const ground = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.coverArt], grid(W, H, 64), ...kids.filter(Boolean) as SVGElement[]);
const bar = (x: number, y: number, w: number, h: number, tone: ClassName = CX.fMuted, o = 0.55): SVGElement => rect(x, y, w, h, [tone], { rx: 4, 'fill-opacity': o });

/** Markets — five witnesses, one median. */
const ladder = (): SVGElement => ground(
  ...[0, 1, 2, 3, 4].map(i => plate(56, 22 + i * 34, 128, 26, i === 3 ? 'loss' : 'surface')),
  ...[0, 1, 2, 3, 4].map(i => circle(200, 35 + i * 34, 6, [i === 3 ? CX.fLoss : CX.fGain])),
  ...[0, 1, 2, 3, 4].map(i => line(200, 35 + i * 34, 300, 100, [CX.fLine, CX.fThin], { opacity: 0.6 })),
  circle(300, 100, 14, [CX.fAcc, CX.fPulse]),
  arrow(320, 100, 400, 100, CX.fAcc), plate(408, 62, 176, 76, 'acc'), bar(428, 88, 100, 12, CX.fAcc, 0.9));

/** News — a stack of headlines and the attention pulse under them. */
const news = (): SVGElement => ground(
  ...[0, 1, 2].map(i => plate(56, 26 + i * 44, 300, 36)),
  ...[0, 1, 2].map(i => bar(72, 38 + i * 44, 200 - i * 40, 12, CX.fInk, 0.35)),
  ...[0, 1, 2].map(i => circle(336, 44 + i * 44, 5, [i ? CX.fMuted : CX.fGain])),
  path('M388 150C420 150 424 74 456 74S492 130 524 130 566 60 584 54', [CX.fAcc2, CX.fStroke, CX.fFlow]),
  circle(584, 54, 7, [CX.fAcc, CX.fPulse]));

/** Portfolio — the curve, and the journal rows beside it. */
const book = (): SVGElement => ground(
  path('M56 160C112 160 132 118 176 112S246 132 288 96 340 40 372 36', [CX.fGain, CX.fStroke]),
  path('M56 168C112 168 132 140 176 136S246 150 288 128 340 96 372 92', [CX.fMuted, CX.fDash]),
  ...[0, 1, 2].map(i => plate(420, 34 + i * 46, 164, 38)),
  ...[0, 1, 2].map(i => bar(436, 46 + i * 46, 92 - i * 20, 12, i === 1 ? CX.fLoss : CX.fAcc, 0.85)),
  circle(372, 36, 7, [CX.fAcc, CX.fPulse]));

/** The desks — a rail of pages, each named after a question. */
const desks = (): SVGElement => ground(
  ...Array.from({ length: 8 }, (_, i) => plate(48 + (i % 4) * 140, 34 + Math.floor(i / 4) * 84, 120, 64, i === 2 ? 'acc' : 'surface')),
  ...Array.from({ length: 8 }, (_, i) => bar(64 + (i % 4) * 140, 52 + Math.floor(i / 4) * 84, 72 - (i % 3) * 14, 10, i === 2 ? CX.fAcc : CX.fMuted, 0.7)),
  ...Array.from({ length: 8 }, (_, i) => bar(64 + (i % 4) * 140, 74 + Math.floor(i / 4) * 84, 88 - (i % 4) * 16, 8, CX.fMuted, 0.35)));

/** Journey — milestones along a path, the streak lit behind you. */
const journey = (): SVGElement => {
  const pts = Array.from({ length: 9 }, (_, i) => [64 + i * 64, 128 - Math.sin(i * 0.6) * 56] as const);
  return ground(
    path(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''), [CX.fAcc2, CX.fThin, CX.fFlow], { 'stroke-width': 2.4 }),
    ...pts.map(([x, y], i) => circle(x, y, i < 5 ? 9 : 6, [i < 5 ? CX.fAcc : CX.fMuted, i === 4 && CX.fPulse], { 'fill-opacity': i < 5 ? 1 : 0.45 })),
    plate(500, 138, 96, 34, 'acc'), rung(560, 30, 22, 30, 14, CX.fGain));
};

/** Apps — one file, three shells. */
const apps = (): SVGElement => ground(
  plate(56, 52, 118, 96, 'acc'), bar(74, 74, 74, 10, CX.fAcc, 0.9), bar(74, 94, 58, 10, CX.fMuted, 0.5), bar(74, 114, 66, 10, CX.fMuted, 0.4),
  arrow(182, 100, 226, 100, CX.fAcc),
  plate(238, 40, 116, 120), plate(372, 56, 96, 88), plate(486, 68, 98, 64),
  ...[0, 1, 2].map(i => bar(256 + i * 134, 60 + i * 16, 60 - i * 8, 9, CX.fMuted, 0.5)),
  circle(534, 100, 7, [CX.fGain, CX.fPulse]));

/** Day and Night — one layout, two appearances, one contrast floor. */
const modes = (): SVGElement => ground(
  plate(48, 34, 258, 132), plate(334, 34, 258, 132, 'acc'),
  ...[0, 1].map(s => bar(68 + s * 286, 56, 140, 12, CX.fInk, 0.7)),
  ...[0, 1].map(s => bar(68 + s * 286, 80, 200, 10, CX.fMuted, 0.5)),
  ...[0, 1].map(s => bar(68 + s * 286, 102, 168, 10, CX.fMuted, 0.35)),
  ...[0, 1].map(s => rect(68 + s * 286, 126, 76, 22, [s ? CX.fAcc2 : CX.fAcc], { rx: 6, 'fill-opacity': 0.85 })),
  line(320, 18, 320, 182, [CX.fLine, CX.fDash]));

/** Security — a closed boundary, one deliberate door to your own machine. */
const trust = (): SVGElement => ground(
  rect(150, 32, 340, 136, [CX.fAcc2, CX.fThin], { rx: 16, 'fill-opacity': 0.1, 'stroke-width': 1.6 }),
  plate(206, 62, 228, 76), bar(228, 84, 120, 12, CX.fAcc, 0.85), bar(228, 108, 168, 10, CX.fMuted, 0.45),
  arrow(58, 66, 138, 66, CX.fLoss, true), arrow(58, 134, 138, 134, CX.fLoss, true),
  line(126, 54, 150, 78, [CX.fLoss, CX.fThin]), line(126, 122, 150, 146, [CX.fLoss, CX.fThin]),
  arrow(502, 100, 582, 100, CX.fGain), circle(582, 100, 8, [CX.fGain, CX.fPulse]),
  sv('g', { class: [CX.fRise] }, circle(320, 100, 0, [CX.fAcc])));

export const COVERS3: Readonly<Record<string, () => SVGElement>> = Object.freeze({
  'markets-and-the-data-ladder': ladder,
  'news-sentiment-and-attention': news,
  'portfolio-journal-and-record': book,
  'the-desks': desks,
  'journey-quests-and-daily': journey,
  'apps-offline-and-install': apps,
  'day-night-and-the-design-system': modes,
  'security-and-trust': trust,
});
