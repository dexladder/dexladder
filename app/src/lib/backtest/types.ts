/**
 * Bar-by-bar backtesting value types. A run is a pure fold over candles: the state after bar i
 * depends only on the bars up to i and the orders the trader had placed by then — never on a
 * price the trader could not have seen. That is the whole point of the desk.
 */

export interface Candle { readonly t: number; readonly o: number; readonly h: number; readonly l: number; readonly c: number; readonly v: number }

export type BtSide = 'buy' | 'sell';
export type BtOrderType = 'market' | 'limit' | 'stop';

export interface BtOrder {
  readonly id: string;
  readonly type: BtOrderType;
  readonly side: BtSide;
  /** base units */
  readonly qty: number;
  /** limit / stop price (absent for market) */
  readonly px?: number;
  /** the bar index the trader was looking at when they placed it */
  readonly placedAt: number;
}

export type FillWhy = 'market-open' | 'limit' | 'stop' | 'stop-gap' | 'limit-gap' | 'close-out';

export interface BtFill {
  readonly orderId: string;
  readonly side: BtSide;
  readonly qty: number;
  readonly px: number;
  readonly fee: number;
  readonly bar: number;
  readonly t: number;
  readonly why: FillWhy;
}

/** One closed round trip (a sell against the average cost of what was held). */
export interface BtTrade {
  readonly qty: number; readonly entry: number; readonly exit: number;
  readonly pl: number; readonly plPct: number; readonly fee: number;
  readonly openedAt: number; readonly closedAt: number; readonly bars: number;
}

export interface BtState {
  /** index of the last bar the trader has seen (−1 before the first) */
  readonly i: number;
  readonly cash: number;
  readonly qty: number;
  /** average-cost basis of what is held, quote */
  readonly cost: number;
  /** bar index the current position was opened at */
  readonly openedBar: number;
  readonly orders: readonly BtOrder[];
  readonly fills: readonly BtFill[];
  readonly trades: readonly BtTrade[];
  /** equity at each seen bar's close, starting with the first */
  readonly equity: readonly number[];
  readonly feesUSD: number;
  readonly peak: number;
  readonly maxDD: number;
  readonly barsInMarket: number;
  readonly start: number;
  readonly done: boolean;
}

export interface BtEvent {
  readonly bar: number;
  readonly kind: 'fill' | 'rejected' | 'expired';
  readonly text: string;
  readonly fill?: BtFill;
}
