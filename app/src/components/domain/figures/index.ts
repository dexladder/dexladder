/** The figure registry: an id in an article maps to a drawing. Unknown ids render nothing. */
import { COVERS } from './covers';
import { COVERS2 } from './covers2';
import { COVERS3 } from './covers3';
import { ammCurve, gasLanes, sandwich, simVsReal } from './diagrams';
import { ledgerChain, lessonPath, deskMap, layerStack, twapSlices } from './diagrams2';
import { botLoop, nextBarFill, liqLadder, dataLadder, sentinelRule, modePair, slotProse, trustBoundary } from './diagrams3';

export const FIGURES: Readonly<Record<string, () => SVGElement>> = Object.freeze({
  'amm-curve': ammCurve, 'gas-lanes': gasLanes, sandwich, 'sim-vs-real': simVsReal,
  'ledger-chain': ledgerChain, 'lesson-path': lessonPath, 'desk-map': deskMap, 'layer-stack': layerStack, 'twap-slices': twapSlices,
  'bot-loop': botLoop, 'next-bar-fill': nextBarFill, 'liq-ladder': liqLadder,
  'data-ladder': dataLadder, 'sentinel-rule': sentinelRule, 'mode-pair': modePair,
  'slot-prose': slotProse, 'trust-boundary': trustBoundary,
});

const ALL_COVERS: Readonly<Record<string, () => SVGElement>> = Object.freeze({ ...COVERS, ...COVERS2, ...COVERS3 });

export const figure = (id: string): SVGElement | null => (FIGURES[id] ? FIGURES[id]!() : null);
export const cover = (slug: string): SVGElement | null => (ALL_COVERS[slug] ? ALL_COVERS[slug]!() : null);
export const FIGURE_IDS = Object.keys(FIGURES);
export const COVER_SLUGS = Object.keys(ALL_COVERS);
