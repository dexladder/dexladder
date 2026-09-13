/** Paper-engine value types. Everything is plain data: serialisable, comparable, replayable. */

export type Side = 'buy' | 'sell';
export type Tif = 'GTC' | 'IOC' | 'FOK';

/** What the engine needs to know about a market. All fields are USD-denominated 24h figures. */
export interface MarketStats {
  /** 24h traded volume, USD. 0 when unknown. */
  readonly vol24: number;
  /** Market capitalisation, USD. 0 when unknown. */
  readonly mcap: number;
  /** 24h change, percent (e.g. -3.2). */
  readonly chg24: number;
  /** Last price in USD. */
  readonly price: number;
}

/** One stored book level. `eat` is liquidity consumed by our own fills, healing back over time. */
export interface RawLevel {
  readonly p: number;
  /** relative weight before scaling (kept so a rebuilt book can be compared) */
  readonly w: number;
  /** resting quantity at full health, base units */
  readonly a: number;
  /** quantity eaten by our fills at `eatT` (0 = untouched) */
  readonly eat: number;
  readonly eatT: number;
}

export interface Book {
  readonly mid: number;
  readonly asks: readonly RawLevel[];
  readonly bids: readonly RawLevel[];
  /** build time, ms */
  readonly t: number;
}

/** A level as a taker sees it right now: price, available quantity, and its index in the book side. */
export interface LiveLevel { readonly p: number; readonly a: number; readonly i: number }
export interface LiveBook { readonly mid: number; readonly asks: readonly LiveLevel[]; readonly bids: readonly LiveLevel[] }

export interface Take { readonly i: number; readonly q: number; readonly p: number }

export interface Walk {
  readonly mid: number;
  readonly filled: number;
  readonly remaining: number;
  /** quote spent (buy) or received (sell), before fees */
  readonly cost: number;
  readonly avg: number;
  readonly taken: readonly Take[];
  readonly levels: number;
  /** a market order that ran out of book */
  readonly exhausted: boolean;
}

export interface FeeSchedule { readonly maker: number; readonly taker: number }
