/**
 * Venue realism profiles (published fee schedules as of the v151 research pass).
 * t = spot taker, m = spot maker, pt = perp taker, gas = simulated USD network cost per fill.
 */
export interface Venue { readonly n: string; readonly t: number; readonly m: number; readonly pt: number; readonly gas: number; readonly d: string }

const V = (v: Venue): Venue => Object.freeze(v);

export const VENUES: Readonly<Record<'binance' | 'coinbase' | 'kraken' | 'hyperliquid' | 'dexamm', Venue>> = Object.freeze({
  binance: V({ n: 'Binance', t: 0.001, m: 0.001, pt: 5e-4, gas: 0, d: 'Spot 0.10% taker · 0.10% maker · perps 0.05% taker' }),
  coinbase: V({ n: 'Coinbase Adv.', t: 0.006, m: 0.004, pt: 6e-4, gas: 0, d: 'Spot 0.60% taker · 0.40% maker (retail tier) · perps 0.06%' }),
  kraken: V({ n: 'Kraken', t: 0.0026, m: 0.0016, pt: 5e-4, gas: 0, d: 'Spot 0.26% taker · 0.16% maker · perps 0.05%' }),
  hyperliquid: V({ n: 'Hyperliquid', t: 45e-5, m: 15e-5, pt: 45e-5, gas: 0, d: 'Perp DEX 0.045% taker · 0.015% maker — funding every hour' }),
  dexamm: V({ n: 'DEX (AMM)', t: 0.003, m: 0.003, pt: 0.003, gas: 2.2, d: 'AMM swap 0.30% + ~$2.20 simulated network gas per fill' }),
});

export type VenueId = keyof typeof VENUES;

export function venue(id: string | null | undefined): Venue {
  return (VENUES as Record<string, Venue>)[id || 'binance'] || VENUES.binance;
}

/** Thin-liquidity penalty (bps) the Pro profile adds to a quote: by 24h volume ÷ market cap. */
export function thinLiquidityBps(vol24: number, mcap: number): number {
  if (!mcap || !vol24) return 2;
  const liq = vol24 / mcap;
  return liq < 0.01 ? 16 : liq < 0.03 ? 8 : liq < 0.08 ? 3.5 : 1.4;
}
