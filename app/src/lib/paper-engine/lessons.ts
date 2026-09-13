/**
 * Which Academy lab teaches what just happened on the ticket. Pure: the view maps a lab id to
 * however the Academy opens it. Order of precedence is "the most surprising thing first".
 *
 *   mev   The MEV Auction — searchers bidding for block space: priority tips, sandwiches
 *   amm   DeFi Playground — the x·y=k curve, price impact, liquidity
 */
import type { AmmFacts } from './match';
import type { TxFate } from './gas';

export type LabId = 'mev' | 'amm';
export interface Lab { readonly id: LabId; readonly label: string }

export const LABS: Readonly<Record<LabId, Lab>> = Object.freeze({
  mev: { id: 'mev', label: 'Practise it in the Academy: The MEV Auction' },
  amm: { id: 'amm', label: 'See the curve in the Academy: DeFi Playground' },
});

/** The lab for a ticket preview or outcome — null when there is nothing worth a detour (Beginner). */
export function labFor(amm: AmmFacts | undefined, fate?: TxFate | null): Lab | null {
  if (amm && amm.sandwich) return LABS.mev;
  if (fate === 'pending' || fate === 'timeout' || fate === 'reverted') return LABS.mev;
  if (amm) return LABS.amm;
  return null;
}
