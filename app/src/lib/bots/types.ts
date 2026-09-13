/**
 * Bots — value types shared by the rule builder (Build Your Own Bot), the two "bring your own"
 * adapters (a sandboxed JavaScript strategy, or a signal endpoint your own process serves) and
 * the Arena that runs every bot against the live market on its own paper wallet.
 *
 * Nothing here knows about the DOM, the network or the clock. A bot is data; a run is a fold.
 */
import type { Candle } from '../backtest/types';

export type { Candle };

/** bar sizes a bot can trade on (Binance kline ids, which every venue adapter maps from) */
export type BotInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/** what a bot may look at when it decides */
export type IndicatorId =
  | 'close' | 'open' | 'high' | 'low' | 'volume'
  | 'sma' | 'ema' | 'rsi' | 'macd' | 'macdSignal' | 'macdHist'
  | 'bbUpper' | 'bbLower' | 'bbMid' | 'atr' | 'roc' | 'highest' | 'lowest' | 'volSma';

export interface IndOperand { readonly kind: 'ind'; readonly id: IndicatorId; readonly p1?: number; readonly p2?: number }
export interface ConstOperand { readonly kind: 'const'; readonly value: number }
export type Operand = IndOperand | ConstOperand;

export type Comparator = '>' | '<' | '>=' | '<=' | 'crossAbove' | 'crossBelow';

export interface Condition { readonly left: Operand; readonly op: Comparator; readonly right: Operand }

export interface RiskRules {
  /** share of the wallet's cash a buy spends, 0–1 */
  readonly stakePct: number;
  /** exit when the mark falls this % below the average entry (absent = none) */
  readonly stopLossPct?: number;
  /** exit when the mark rises this % above the average entry */
  readonly takeProfitPct?: number;
  /** exit when the mark falls this % from its high since entry */
  readonly trailingPct?: number;
  /** bars to wait after an exit before the next entry */
  readonly cooldownBars: number;
}

/** A strategy the rule builder writes — the whole bot, as data. */
export interface Strategy {
  readonly v: 1;
  readonly name: string;
  readonly entry: readonly Condition[];
  readonly entryLogic: 'all' | 'any';
  readonly exit: readonly Condition[];
  readonly exitLogic: 'all' | 'any';
  readonly risk: RiskRules;
}

export type BotKind = 'rules' | 'js' | 'signal';
/** 'halted' is the safety stop: the kill switch froze the bot, cancelled its orders and flattened
    it. It is NOT 'stopped' — a bot the user stopped still holds what it held, and one the kill
    switch caught does not. Keeping them apart is what makes the sealed ledger entry meaningful. */
export type BotStatus = 'draft' | 'live' | 'paused' | 'stopped' | 'error' | 'halted';

/** One bot as the user keeps it. */
export interface BotDef {
  readonly id: string;
  readonly name: string;
  readonly kind: BotKind;
  readonly sym: string;
  readonly interval: BotInterval;
  /** paper cash the bot starts with — its own wallet, never the trader's */
  readonly stake: number;
  readonly strategy?: Strategy;
  /** kind 'js': the user's source */
  readonly code?: string;
  /** kind 'signal': the endpoint DexLadder polls */
  readonly url?: string;
  readonly created: number;
}

export type Action = 'buy' | 'sell' | 'hold';

/** What a strategy said on one bar, and why — the "why" is printed to the user verbatim. */
export interface Signal {
  readonly action: Action;
  /** fraction of the wallet (buy: of cash, sell: of holdings); absent = the strategy's stake / all */
  readonly size?: number;
  readonly reason: string;
}

export type BotFillWhy = 'signal' | 'stop-loss' | 'take-profit' | 'trailing' | 'manual' | 'close-out';

export interface BotFill {
  readonly side: 'buy' | 'sell';
  readonly qty: number;
  readonly px: number;
  readonly fee: number;
  readonly t: number;
  readonly why: BotFillWhy;
  readonly reason: string;
}

export interface BotTrade {
  readonly qty: number; readonly entry: number; readonly exit: number;
  readonly pl: number; readonly plPct: number; readonly fee: number;
  readonly openedAt: number; readonly closedAt: number;
}

/** The bot's own paper wallet, marked at every price it sees. */
export interface Wallet {
  readonly start: number;
  readonly cash: number;
  readonly qty: number;
  /** average-cost basis of what is held, quote */
  readonly cost: number;
  /** highest mark since the position opened (for the trailing stop) */
  readonly hwm: number;
  readonly openedAt: number;
  readonly fills: readonly BotFill[];
  readonly trades: readonly BotTrade[];
  /** [t, equity] at each mark, thinned to a bounded length */
  readonly equity: readonly (readonly [number, number])[];
  readonly peak: number;
  readonly maxDD: number;
  readonly marks: number;
  readonly marksInMarket: number;
  readonly feesUSD: number;
  /** the first and the last price marked — buy-and-hold is measured between them */
  readonly firstPx: number;
  readonly lastPx: number;
}

export type LogKind = 'info' | 'signal' | 'fill' | 'risk' | 'error' | 'health';

export interface LogLine { readonly t: number; readonly kind: LogKind; readonly text: string }

/** The health of a bot's decision source, in words the desk shows. */
export interface Health {
  readonly ok: boolean;
  readonly text: string;
  /** ms the last decision took */
  readonly ms: number;
  readonly errors: number;
}
