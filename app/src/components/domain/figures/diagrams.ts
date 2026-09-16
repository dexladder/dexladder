/** In-article figures, part 1: the execution engine's three ideas. 640×360, drawn from tokens. */
import { canvas, grid, plate, arrow, hyperbola, label, path, rect, circle, line, sv } from './kit';
import { CX } from '../../../design/classes';

const W = 640, H = 360;
const box = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.figArt], grid(W, H, 48), ...kids.filter(Boolean) as SVGElement[]);
const axes = (): SVGElement => sv('g', {}, path(`M70 40V310H600`, [CX.fLine, CX.fThin], { 'stroke-width': 1.6 }));

/** The constant-product curve: the quote, the fill, and the impact between them. */
export const ammCurve = (): SVGElement => box(
  axes(),
  label(70, 28, 'price (quote per base)'), label(600, 334, 'base in the pool', 'muted', 'end'),
  path(hyperbola(80, 44, 470, 250, 0.62), [CX.fAcc2, CX.fStroke]),
  // the quote price, the average fill, the price the pool is left at
  line(90, 148, 470, 148, [CX.fGain, CX.fDash]),
  line(90, 214, 470, 214, [CX.fLoss, CX.fDash]),
  path('M250 148L250 310', [CX.fLine, CX.fThin], { opacity: 0.6 }),
  path('M250 148 L430 148 L430 214 L250 214 Z', [CX.fLoss], { 'fill-opacity': 0.14, stroke: 'none' }),
  circle(250, 148, 7, [CX.fGain]), circle(430, 214, 8, [CX.fLoss, CX.fPulse]),
  arrow(262, 154, 418, 206, CX.fLoss),
  label(96, 142, 'quoted price', 'muted'), label(96, 208, 'your average fill', 'muted'),
  label(300, 236, 'price impact', 'acc'),
  plate(452, 250, 160, 52, 'acc'), label(468, 272, 'bigger size', 'ink'), label(468, 290, 'worse average', 'acc'));

/** Three priority lanes: what a tip buys, and what a Low tip risks. */
export const gasLanes = (): SVGElement => {
  const lane = (y: number, name: string, tone: string, blocks: number, dropped: boolean): SVGElement => sv('g', {},
    plate(70, y, 500, 62), label(84, y + 24, name, 'ink'),
    ...Array.from({ length: blocks }, (_, i) => sv('g', { class: [CX.fDrift] },
      rect(180 + i * 58, y + 14, 44, 34, [tone === 'acc' ? CX.fAcc : tone === 'warm' ? CX.fWarm : CX.fGain], { rx: 6, 'fill-opacity': 0.85 }))),
    dropped ? sv('g', {}, rect(486, y + 14, 44, 34, [CX.fLoss, CX.fDash], { rx: 6 }), label(496, y + 36, '✕', 'muted')) : circle(540, y + 31, 8, [CX.fGain, CX.fPulse]));
  return box(
    label(70, 30, 'the queue for the next block'),
    lane(44, 'High', 'acc', 4, false), lane(140, 'Medium', 'gain', 3, false), lane(236, 'Low', 'warm', 2, true),
    label(70, 336, 'a dropped swap trades nothing — and still pays the cancellation gas', 'muted'));
};

/** The sandwich: front-run, the victim's fill at the edge of tolerance, back-run. */
export const sandwich = (): SVGElement => box(
  label(70, 30, 'one block, three swaps'),
  path('M70 250 L210 250 L210 150 L410 150 L410 196 L600 196', [CX.fLoss, CX.fStroke]),
  ...[[70, 'Bot buys', 'loss'], [250, 'You fill worse', 'warm'], [430, 'Bot sells', 'loss']].map(([x, t, tone]) =>
    sv('g', {}, plate(Number(x), 276, 170, 54, tone as 'loss' | 'warm'), label(Number(x) + 16, 308, String(t), 'ink'))),
  line(210, 60, 210, 276, [CX.fLine, CX.fThin], { opacity: 0.5 }),
  line(410, 60, 410, 276, [CX.fLine, CX.fThin], { opacity: 0.5 }),
  line(70, 120, 600, 120, [CX.fGain, CX.fDash]), label(78, 112, 'your tolerance ceiling', 'muted'),
  circle(410, 150, 8, [CX.fWarm, CX.fPulse]),
  label(226, 82, 'the bot pushes you to your ceiling', 'acc'),
  label(444, 232, 'and keeps the difference', 'muted'));

/** Beginner and Advanced, side by side: the same order meeting two worlds. */
export const simVsReal = (): SVGElement => box(
  plate(56, 50, 250, 260), plate(334, 50, 250, 260, 'acc'),
  label(74, 82, 'Beginner', 'ink'), label(352, 82, 'Advanced', 'ink'),
  ...['order book', 'venue fee', 'fills at the screen price'].map((t, i) => sv('g', {},
    circle(88, 126 + i * 44, 5, [CX.fGain]), label(106, 131 + i * 44, t, 'muted'))),
  ...['pool curve · price impact', 'slippage tolerance', 'gas · pending · reverts', 'MEV bots (opt-in)'].map((t, i) => sv('g', {},
    circle(366, 126 + i * 44, 5, [CX.fAcc]), label(384, 131 + i * 44, t, 'muted'))),
  arrow(306, 180, 334, 180, CX.fAcc),
  label(56, 336, 'the same ticket — one mode forgives, the other tells the truth', 'muted'));
