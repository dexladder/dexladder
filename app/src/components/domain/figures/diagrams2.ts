/** In-article figures, part 2: the ledger, the lesson path, the desk and the build. */
import { canvas, grid, plate, arrow, label, path, rect, circle, line, sv } from './kit';
import { CX } from '../../../design/classes';

const W = 640, H = 360;
const box = (...kids: (SVGElement | false)[]): SVGElement => canvas(W, H, [CX.figArt], grid(W, H, 48), ...kids.filter(Boolean) as SVGElement[]);

/** The proof ledger: each block seals the one before it — and a changed block breaks every link after it. */
export const ledgerChain = (): SVGElement => box(
  label(60, 34, 'each block hashes the block before it'),
  ...[0, 1, 2].flatMap(i => {
    const x = 60 + i * 190, broken = i === 1;
    return [
      plate(x, 70, 150, 120, broken ? 'loss' : 'surface'),
      label(x + 16, 100, broken ? 'block · changed' : 'block', broken ? 'ink' : 'ink'),
      rect(x + 16, 116, 110, 9, [CX.fMuted], { rx: 4, opacity: 0.55 }),
      rect(x + 16, 134, 84, 9, [CX.fMuted], { rx: 4, opacity: 0.4 }),
      rect(x + 16, 158, 118, 12, [broken ? CX.fLoss : CX.fAcc], { rx: 6, 'fill-opacity': 0.85 }),
      i < 2 ? arrow(x + 150, 130, x + 190, 130, broken ? CX.fLoss : CX.fAcc, broken) : circle(x + 176, 130, 9, [CX.fGain, CX.fPulse])];
  }),
  plate(60, 236, 520, 74, 'loss'),
  label(80, 268, 'verify · re-hash every block, walk every link', 'ink'),
  label(80, 292, 'content changed — recomputed hash differs from the sealed one', 'muted'));

/** The lesson path: twelve lessons, the labs hanging off them. */
export const lessonPath = (): SVGElement => {
  const pts = Array.from({ length: 12 }, (_, i) => [56 + i * 48, 200 - Math.sin(i * 0.68) * 90] as const);
  return box(
    label(56, 34, 'the path · twelve lessons, then the certificate'),
    path(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(''), [CX.fAcc2, CX.fThin, CX.fFlow], { 'stroke-width': 2.4 }),
    ...pts.map(([x, y], i) => circle(x, y, i < 5 ? 9 : 6, [i < 5 ? CX.fAcc : CX.fMuted, i === 5 && CX.fPulse], { 'fill-opacity': i < 5 ? 0.95 : 0.5 })),
    ...[['DeFi Playground', 3], ['The MEV Auction', 8]].map(([t, i]) => sv('g', {},
      line(pts[Number(i)]![0], pts[Number(i)]![1] + 12, pts[Number(i)]![0], 292, [CX.fLine, CX.fThin]),
      plate(pts[Number(i)]![0] - 84, 292, 168, 40, 'acc'), label(pts[Number(i)]![0] - 68, 317, String(t), 'ink'))),
    circle(pts[11]![0], pts[11]![1], 14, [CX.fGain, CX.fThin], { 'fill-opacity': 0.14 }),
    label(560, 96, 'certificate', 'muted', 'end'));
};

/** The desk: six destinations, one paper account, everything on the device. */
export const deskMap = (): SVGElement => {
  const names = ['Terminal', 'Markets', 'Portfolio', 'Academy', 'Explorer', 'P2P'];
  return box(
    ...names.map((t, i) => sv('g', {},
      plate(56 + (i % 3) * 180, 60 + Math.floor(i / 3) * 120, 160, 92, i === 3 ? 'acc' : 'surface'),
      label(74 + (i % 3) * 180, 92 + Math.floor(i / 3) * 120, t, 'ink'),
      rect(74 + (i % 3) * 180, 106 + Math.floor(i / 3) * 120, 96, 9, [CX.fMuted], { rx: 4, opacity: 0.45 }),
      rect(74 + (i % 3) * 180, 124 + Math.floor(i / 3) * 120, 64, 9, [CX.fAcc], { rx: 4, opacity: 0.6 }))),
    plate(196, 306, 250, 40, 'gain'), label(216, 331, 'one paper account · on your device', 'ink'));
};

/** TWAP: one parent order cut into equal slices, sent on the clock, averaged. */
export const twapSlices = (): SVGElement => {
  const px = [188, 150, 206, 132, 178, 118];
  return box(
    label(56, 34, 'one parent order, six slices, one average'),
    path(px.map((y, i) => `${i ? 'L' : 'M'}${70 + i * 96} ${y}`).join(''), [CX.fMuted, CX.fThin, CX.fDash]),
    line(56, 162, 600, 162, [CX.fGain, CX.fThin]), label(468, 154, 'average paid', 'muted'),
    ...px.map((y, i) => sv('g', {},
      line(70 + i * 96, y, 70 + i * 96, 268, [CX.fLine, CX.fThin], { opacity: 0.6 }),
      rect(52 + i * 96, 268, 36, 44, [CX.fAcc], { rx: 7, 'fill-opacity': 0.85 }),
      circle(70 + i * 96, y, 7, [CX.fAcc, i === 2 && CX.fPulse]))),
    plate(56, 60, 190, 40, 'acc'), label(74, 85, 'total size', 'ink'),
    arrow(252, 80, 300, 80, CX.fAcc), label(312, 85, 'cut into equal slices', 'muted'),
    label(56, 336, 'on-chain each slice is its own swap — and pays its own gas', 'muted'));
};

/** The build: a pinned base, self-mounting layers, count-asserted patches — one file. */
export const layerStack = (): SVGElement => box(
  label(56, 34, 'how the file is assembled'),
  ...['pinned base (sha)', 'typed core → bundle', 'layers', 'count-asserted patches'].map((t, i) =>
    sv('g', {}, plate(56, 62 + i * 58, 300, 44, i === 1 ? 'acc' : 'surface'), label(76, 90 + i * 58, t, 'ink'))),
  arrow(366, 180, 412, 180, CX.fAcc),
  sv('g', { class: [CX.fRise] }, plate(424, 96, 160, 168), label(444, 130, 'index.html', 'ink'),
    ...[0, 1, 2, 3].map(i => rect(444, 146 + i * 22, 120 - i * 16, 10, [i ? CX.fMuted : CX.fAcc], { rx: 5, opacity: i ? 0.45 : 0.9 }))),
  label(56, 336, 'every gate green, or it is not a release', 'muted'));
