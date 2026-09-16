/** Covers, part 2 — 640×200, drawn from tokens, correct in both appearances. */
import { canvas, grid, plate, arrow, hyperbola, label, path, rect, circle, line } from './kit';
import { CX, type ClassName } from '../../../design/classes';

const W = 640, H = 200;
const ground = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.coverArt], grid(W, H, 64), ...kids.filter(Boolean) as SVGElement[]);
const bar = (x: number, y: number, w: number, h: number, tone: ClassName = CX.fMuted, o = 0.55): SVGElement => rect(x, y, w, h, [tone], { rx: 4, 'fill-opacity': o });

/** Bots — three rules feed a walled wallet, and one dot can cut the loop. */
const bots = (): SVGElement => ground(
  ...[0, 1, 2].map(i => plate(56, 44 + i * 44, 150, 32)),
  ...[0, 1, 2].map(i => bar(70, 54 + i * 44, 88 - i * 18, 10, i === 1 ? CX.fAcc2 : CX.fAcc, 0.8)),
  arrow(214, 100, 268, 100, CX.fAcc),
  plate(276, 56, 132, 88, 'acc'), circle(342, 100, 16, [CX.fAcc2], { 'fill-opacity': 0.5 }),
  arrow(416, 100, 470, 100, CX.fMuted), plate(478, 56, 106, 88),
  circle(531, 100, 13, [CX.fLoss, CX.fPulse]));

/** Rewind — candles drawn, the rest of the tape still behind the curtain. */
const rewind = (): SVGElement => {
  const hs = [54, 88, 40, 96, 66, 110, 74, 122];
  return ground(
    ...hs.map((h, i) => bar(56 + i * 34, 158 - h, 18, h, i % 3 === 2 ? CX.fLoss : CX.fGain, 0.85)),
    line(340, 20, 340, 180, [CX.fAcc, CX.fDash]),
    rect(348, 24, 236, 152, [CX.fSurface], { rx: 10, 'fill-opacity': 0.9 }),
    ...[0, 1, 2, 3].map(i => bar(368 + i * 52, 60 + i * 12, 24, 84 - i * 12, CX.fMuted, 0.22)),
    circle(340, 100, 7, [CX.fAcc, CX.fPulse]));
};

/** Perps — margin, the maintenance step, and the mark walking toward it. */
const perps = (): SVGElement => ground(
  plate(56, 74, 470, 52),
  rect(56, 74, 300, 52, [CX.fGain], { rx: 8, 'fill-opacity': 0.22 }),
  rect(356, 74, 96, 52, [CX.fWarm], { rx: 8, 'fill-opacity': 0.3 }),
  rect(452, 74, 74, 52, [CX.fLoss], { rx: 8, 'fill-opacity': 0.3 }),
  line(400, 44, 400, 156, [CX.fInk, CX.fThin]), circle(400, 44, 7, [CX.fAcc, CX.fPulse]),
  arrow(300, 160, 470, 160, CX.fLoss), label(56, 44, 'margin'), label(526, 44, 'liquidation', 'acc', 'end'));

/** Orders — a book of rows, two of them tied together, one cut into slices. */
const orders = (): SVGElement => ground(
  ...[0, 1, 2, 3].map(i => plate(56, 34 + i * 42, 240, 30)),
  ...[0, 1, 2, 3].map(i => bar(70, 42 + i * 42, 130 - i * 24, 12, i === 3 ? CX.fLoss : CX.fAcc, 0.8)),
  path('M304 64C336 64 336 106 304 106', [CX.fAcc2, CX.fStroke], { 'stroke-width': 2.4 }),
  circle(304, 64, 6, [CX.fAcc2]), circle(304, 106, 6, [CX.fAcc2]),
  ...[0, 1, 2, 3, 4].map(i => bar(370 + i * 44, 150 - i * 22, 30, 12 + i * 6, CX.fAcc2, 0.7)),
  arrow(370, 172, 570, 172, CX.fMuted));

/** Liquidity — the constant-product curve with a concentrated range on it. */
const liquidity = (): SVGElement => ground(
  rect(196, 44, 148, 132, [CX.fAcc2], { rx: 10, 'fill-opacity': 0.14 }),
  path(hyperbola(60, 30, 330, 132, 0.62), [CX.fAcc, CX.fStroke]),
  line(196, 30, 196, 180, [CX.fLine, CX.fDash]), line(344, 30, 344, 180, [CX.fLine, CX.fDash]),
  circle(268, 108, 7, [CX.fGain, CX.fPulse]),
  plate(432, 52, 150, 30, 'acc'), plate(432, 92, 150, 30), plate(432, 132, 150, 30, 'loss'));

/** Fork — one chain, and the branch you own. */
const fork = (): SVGElement => ground(
  ...[0, 1, 2].map(i => plate(56 + i * 92, 84, 66, 42)),
  ...[0, 1].map(i => arrow(122 + i * 92, 105, 148 + i * 92, 105, CX.fMuted)),
  arrow(306, 105, 340, 70, CX.fAcc), arrow(306, 105, 340, 146, CX.fMuted, true),
  ...[0, 1].map(i => plate(348 + i * 92, 42, 66, 42, 'acc')),
  ...[0, 1].map(i => plate(348 + i * 92, 128, 66, 42)),
  arrow(414, 63, 440, 63, CX.fAcc), arrow(414, 149, 440, 149, CX.fMuted, true),
  circle(548, 63, 8, [CX.fGain, CX.fPulse]));

/** DeXaI — prose with its numbers held in sourced slots. */
const copilot = (): SVGElement => ground(
  plate(56, 40, 350, 120),
  bar(74, 62, 210, 11), rect(292, 62, 62, 11, [CX.fAcc], { rx: 5, 'fill-opacity': 0.9 }),
  bar(74, 92, 128, 11), rect(210, 92, 74, 11, [CX.fAcc2], { rx: 5, 'fill-opacity': 0.9 }), bar(292, 92, 60, 11),
  bar(74, 122, 172, 11),
  ...[0, 1, 2].map(i => plate(444, 40 + i * 42, 140, 32)),
  ...[0, 1, 2].map(i => arrow(436, 56 + i * 42, 412, 76 + i * 20, CX.fMuted, true)));

export const COVERS2: Readonly<Record<string, () => SVGElement>> = Object.freeze({
  'bots-build-and-bring': bots,
  'rewind-and-backtesting': rewind,
  'perpetuals-funding-liquidation': perps,
  'order-types-and-algos': orders,
  'liquidity-desk-amms-and-il': liquidity,
  'local-fork-sandbox': fork,
  'dexai-on-device-copilot': copilot,
});
