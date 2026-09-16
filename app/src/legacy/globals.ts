/**
 * Typed, fail-soft access to the legacy payload's globals.
 *
 * Legacy function declarations live on window and are reached directly. `S` and `bySym` are
 * top-level `const`/`let` of a classic script: they are NOT on window and a module cannot see
 * them. Rather than an eval (the payload is eval-free by law), the legacy side hands us accessors
 * once, from inside its own scope: `DLAPP.legacy.bind({ state: () => S, coin: s => bySym[s] })`,
 * injected by buildlib/arch.py. Until then every accessor returns "absent".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;

export interface LegacyCoin { sym: string; price: number; vol: number; mcap: number; c24: number; spark?: number[] }
export interface LegacyState {
  bal: Record<string, number>;
  basis: Record<string, { qty: number; costUSD: number; t0?: number }>;
  stats: { wins: number; losses: number; feesUSD: number; realizedUSD: number; trades: number };
  journal: any[];
  orders: any[];
  [k: string]: any;
}

export interface Binding { state(): LegacyState | undefined; coin(sym: string): LegacyCoin | null | undefined }
let bound: Binding | null = null;

/** Called once by the payload, from inside the legacy script scope. Idempotent; first wins. */
export function bind(b: Binding): void { if (!bound) bound = b; }

export const legacy = {
  S: (): LegacyState | undefined => { try { return bound ? bound.state() : undefined; } catch { return undefined; } },
  coin: (sym: string): LegacyCoin | null => { try { return (bound && bound.coin(sym)) || null; } catch { return null; } },
  /** Raw, uncoerced: the legacy pairPrice returns NaN for a listed coin with no price yet, and callers
      compare against it (`stop > NaN` is false). Coercing to 0 would arm such a stop upward. */
  pairPrice: (sym: string, quote: string): number => (typeof G.pairPrice === 'function' ? G.pairPrice(sym, quote) : 0),
  /** Not caught: a failing quote conversion must abort the fill, as it did in the legacy execFill. */
  pUSD: (sym: string): number => (typeof G.pUSD === 'function' ? G.pUSD(sym) : 1),
  /** Live 8h funding for a perp from Leverage Weather (layer 33), with the venue it came from — null when stale or absent. */
  funding8h: (sym: string): { rate: number; venue: string } | null => {
    try { const W = G.DLWEATHER, r = W && W.funding8h(sym); return r != null && isFinite(r) ? { rate: +r, venue: String((W.state && W.state.src) || '') } : null; } catch { return null; }
  },
  /** UI effects (toast, render, sfx): a failing effect is contained — it never undoes or blocks a committed fill. */
  call: (fn: string, ...args: unknown[]): any => { try { const f = G[fn]; return typeof f === 'function' ? f(...args) : undefined; } catch { return undefined; } },
  /** the same, for a method of a legacy module object (DLWEATHER.open …) */
  callIn: (ns: string, fn: string, ...args: unknown[]): any => { try { const o = G[ns], f = o && o[fn]; return typeof f === 'function' ? f.apply(o, args) : undefined; } catch { return undefined; } },
};
