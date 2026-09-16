/** In-article figures, part 3: the bot loop, the next-bar law, the margin ladder, the data ladder,
 *  a compiled alert, and the two appearances side by side. */
import { canvas, grid, plate, arrow, label, path, rect, circle, line } from './kit';
import { CX, type ClassName } from '../../../design/classes';

const W = 640, H = 360;
const box = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.figArt], grid(W, H, 48), ...kids.filter(Boolean) as SVGElement[]);
const bar = (x: number, y: number, w: number, h: number, tone: ClassName = CX.fMuted, o = 0.5): SVGElement => rect(x, y, w, h, [tone], { rx: 4, 'fill-opacity': o });

/** The bot loop: a bar closes, the bot answers, the wallet fills — and the kill switch cuts it. */
export const botLoop = (): SVGElement => box(
  label(48, 32, 'one answer per closed bar, with a deadline'),
  ...[0, 1, 2, 3].map(i => plate(44 + i * 148, 60, 124, 74, i === 3 ? 'acc' : 'surface')),
  ...['bar closes', 'bot answers', 'order', 'bot wallet'].map((t, i) => label(58 + i * 148, 92, t, i === 3 ? 'acc' : 'ink')),
  ...[0, 1, 2].map(i => arrow(168 + i * 148, 97, 192 + i * 148, 97, CX.fAcc)),
  path('M106 134C106 210 540 210 540 134', [CX.fAcc2, CX.fThin, CX.fDash]),
  label(258, 196, 'the next bar', 'muted'),
  plate(196, 244, 248, 72, 'loss'),
  label(216, 274, 'kill · freeze, cancel, flatten, seal', 'ink'),
  label(216, 298, 'one ledger entry, never one per step', 'muted'),
  ...[0, 1, 2, 3].map(i => arrow(106 + i * 148, 240, 106 + i * 148, 150, CX.fLoss, true)));

/** The next-bar law: a signal on the bar that closed, a fill on the bar that opens next. */
export const nextBarFill = (): SVGElement => {
  const hs = [70, 110, 86, 132, 96, 150, 118];
  return box(
    label(48, 32, 'the signal is on the closed bar; the fill is on the one after it'),
    ...hs.map((h, i) => bar(60 + i * 78, 250 - h, 30, h, i === 4 ? CX.fAcc : i % 3 === 1 ? CX.fLoss : CX.fGain, 0.85)),
    line(60, 250, 592, 250, [CX.fLine, CX.fThin]),
    line(414, 60, 414, 300, [CX.fAcc, CX.fDash]),
    circle(387, 130, 8, [CX.fAcc, CX.fPulse]), label(300, 108, 'signal here', 'acc', 'end'),
    circle(465, 122, 8, [CX.fGain]), arrow(430, 90, 462, 114, CX.fGain),
    label(478, 84, 'fill at this open', 'ink'),
    plate(60, 296, 250, 44, 'loss'), label(78, 324, 'never a price not yet seen', 'ink'));
};

/** The margin ladder: where a position stops being yours. */
export const liqLadder = (): SVGElement => box(
  label(48, 34, 'equity = margin + unrealised · liquidation when maintenance meets it'),
  plate(48, 62, 544, 92),
  rect(48, 62, 330, 92, [CX.fGain], { rx: 10, 'fill-opacity': 0.2 }),
  rect(378, 62, 110, 92, [CX.fWarm], { rx: 10, 'fill-opacity': 0.28 }),
  rect(488, 62, 104, 92, [CX.fLoss], { rx: 10, 'fill-opacity': 0.3 }),
  label(66, 118, 'equity above maintenance', 'ink'), label(396, 118, 'margin call zone', 'ink'), label(506, 118, 'liquidated', 'ink'),
  line(300, 44, 300, 178, [CX.fInk, CX.fThin]), circle(300, 44, 8, [CX.fAcc, CX.fPulse]), label(300, 30, 'mark', 'acc', 'middle'),
  arrow(300, 196, 500, 196, CX.fLoss), label(316, 222, 'funding paid out of the margin moves this line', 'muted'),
  plate(48, 248, 544, 76),
  label(68, 278, 'stop-loss before the liquidation price fires first', 'ink'),
  label(68, 302, 'a stop and a liquidation both fill at the mark — in a gap, that is the gap', 'muted'));

/** The data ladder: witnesses with health, a median, and a reason when there is no answer. */
export const dataLadder = (): SVGElement => box(
  label(48, 32, 'probe · cool down · median · or null with a reason'),
  ...[0, 1, 2, 3, 4].map(i => plate(48, 56 + i * 54, 210, 42, i === 2 ? 'loss' : 'surface')),
  ...[0, 1, 2, 3, 4].map(i => bar(68, 70 + i * 54, 120 - i * 14, 12, i === 2 ? CX.fLoss : CX.fAcc, 0.8)),
  ...[0, 1, 2, 3, 4].map(i => circle(230, 77 + i * 54, 7, [i === 2 ? CX.fLoss : CX.fGain])),
  ...[0, 1, 2, 3, 4].map(i => line(238, 77 + i * 54, 360, 185, [i === 2 ? CX.fLoss : CX.fLine, CX.fThin], { opacity: i === 2 ? 0.5 : 0.7 })),
  circle(360, 185, 16, [CX.fAcc, CX.fPulse]), label(360, 226, 'median', 'acc', 'middle'),
  arrow(384, 185, 430, 185, CX.fAcc),
  plate(438, 128, 154, 56, 'acc'), label(456, 162, 'the figure', 'ink'),
  plate(438, 200, 154, 56), label(456, 226, 'or null, with', 'ink'), label(456, 248, 'a stated reason', 'muted'));

/** A sentence in, a readable rule out — and you can edit it before it arms. */
export const sentinelRule = (): SVGElement => box(
  label(48, 34, 'you say it; the compiler writes a rule you can read'),
  plate(48, 58, 544, 76),
  label(70, 96, 'tell me if it moves more than usual before Friday', 'ink'),
  arrow(320, 150, 320, 194, CX.fAcc),
  plate(48, 204, 544, 116, 'acc'),
  label(70, 240, 'kind · move-in-window', 'ink'),
  label(70, 268, 'threshold · above the usual range for this coin', 'ink'),
  label(70, 296, 'until · Friday 00:00 · one alert, then it disarms', 'muted'),
  circle(556, 262, 9, [CX.fGain, CX.fPulse]));

/** One layout, two appearances, the same contrast floor in both. */
export const modePair = (): SVGElement => box(
  label(48, 34, 'the same screen, both appearances, both gated at 4.5:1'),
  ...[0, 1].map(s => plate(40 + s * 300, 58, 260, 200, s ? 'acc' : 'surface')),
  ...[0, 1].map(s => bar(64 + s * 300, 84, 150, 16, CX.fInk, 0.75)),
  ...[0, 1].map(s => bar(64 + s * 300, 112, 208, 12, CX.fMuted, 0.55)),
  ...[0, 1].map(s => bar(64 + s * 300, 136, 178, 12, CX.fMuted, 0.4)),
  ...[0, 1].map(s => rect(64 + s * 300, 168, 96, 30, [s ? CX.fAcc2 : CX.fAcc], { rx: 8, 'fill-opacity': 0.85 })),
  ...[0, 1].map(s => bar(64 + s * 300, 214, 130, 12, CX.fMuted, 0.35)),
  line(320, 48, 320, 268, [CX.fLine, CX.fDash]),
  label(40, 296, 'seeded from your system once, then it is your choice', 'muted'),
  label(40, 322, 'no second appearance axis · no inline token overrides', 'muted'));

/** The numeric-slot law: prose may reference a fact, never type one. */
export const slotProse = (): SVGElement => box(
  label(48, 34, 'the model writes the sentence; the tools fill the numbers'),
  plate(48, 58, 544, 108),
  bar(72, 84, 250, 13), rect(334, 84, 92, 13, [CX.fAcc], { rx: 6, 'fill-opacity': 0.9 }), bar(438, 84, 120, 13),
  bar(72, 114, 160, 13), rect(244, 114, 104, 13, [CX.fAcc2], { rx: 6, 'fill-opacity': 0.9 }), bar(360, 114, 96, 13),
  line(300, 140, 380, 140, [CX.fLoss, CX.fStroke], { 'stroke-width': 2.4 }),
  bar(300, 134, 80, 13, CX.fLoss, 0.45),
  label(396, 148, 'a bare numeral is struck out, not shown', 'muted'),
  ...[0, 1, 2].map(i => plate(48 + i * 186, 214, 168, 92, i === 1 ? 'acc' : 'surface')),
  ...['coin · price', 'journal · your book', 'news · headlines'].map((t, i) => label(66 + i * 186, 248, t, 'ink')),
  ...[0, 1, 2].map(i => label(66 + i * 186, 276, 'source · freshness', 'muted')),
  ...[0, 1, 2].map(i => arrow(132 + i * 186, 208, 132 + i * 186, 172, CX.fAcc)));

/** The boundary: nothing to steal inside it, one deliberate door to your own machine. */
export const trustBoundary = (): SVGElement => box(
  label(48, 32, 'no account, no key, no upload — and one asserted exception'),
  rect(150, 54, 344, 200, [CX.fAcc2, CX.fThin], { rx: 20, 'fill-opacity': 0.1, 'stroke-width': 1.6 }),
  plate(180, 84, 284, 66), label(200, 122, 'your device · account, ledger, journal', 'ink'),
  plate(180, 166, 284, 62, 'acc'), label(200, 202, 'one file · no eval, no remote script', 'ink'),
  arrow(40, 96, 138, 96, CX.fLoss, true), label(40, 84, 'remote script', 'muted'),
  arrow(40, 214, 138, 214, CX.fLoss, true), label(40, 202, 'open network', 'muted'),
  line(120, 82, 150, 112, [CX.fLoss, CX.fThin]), line(120, 200, 150, 230, [CX.fLoss, CX.fThin]),
  arrow(506, 156, 596, 156, CX.fGain), label(506, 142, 'loopback only · 127.0.0.1', 'acc'),
  circle(596, 156, 8, [CX.fGain, CX.fPulse]),
  plate(48, 282, 544, 54),
  label(70, 314, 'the negative is gated too: widen it to the internet and the build fails', 'ink'));
