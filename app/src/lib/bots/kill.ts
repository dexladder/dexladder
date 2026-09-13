/**
 * The emergency halt. One bot, or every bot at once, taken off the market in a fixed order and
 * sealed into the proof ledger — the one action a trader reaches for when something is wrong and
 * there is no time to read.
 *
 * The order is not a style choice. Freezing the decision source FIRST is what makes the rest
 * final: a bot that is still being asked for decisions can answer "buy" between the cancel and
 * the flatten, and the halt would then end with a position it just opened. Cancels come before
 * the flatten for the same reason — a resting order that survives the flatten re-enters the market
 * the moment the price touches it, and the wallet the ledger sealed would be a lie by the next tick.
 *
 * Everything here is a value in, a value out: the mark, the fee rate and the clock arrive as
 * arguments, so a test drives a whole halt with no browser, no timer and no network. The paper
 * wallet a bot flattens into is its own — this module cannot name the trader's account, let alone
 * reach it.
 */
import type { BotDef, BotFill, BotStatus, Wallet } from './types';
import { equity, fill, holding } from './wallet';

/** Why a bot was pulled. 'user' is the red button; the other two are the desk protecting itself. */
export type HaltCause = 'user' | 'rate-limit' | 'repeated-failure';

/**
 * The status a halted bot carries. It is deliberately NOT one of BotStatus's five — a bot that was
 * halted for safety must never be mistaken for one the user stopped, because only the first needs
 * an explanation on the desk before it may run again.
 */
export const HALTED_SAFETY = 'HALTED_SAFETY';
export type HaltedStatus = typeof HALTED_SAFETY;
export type BotSafetyStatus = BotStatus | HaltedStatus;

/**
 * A bot's own resting order. A bot keeps its orders in its own book, deliberately separate from
 * lib/paper-engine's RestingOrder: sharing that type would put a bot one field away from the
 * trader's order book, and isolation here is structural, not a convention.
 */
export interface BotOrder {
  readonly id: string;
  readonly kind: 'limit' | 'stop' | 'take-profit' | 'trailing' | 'twap';
  readonly side: 'buy' | 'sell';
  readonly qty: number;
  readonly px: number;
}

/** Everything the halt needs to know, as data. Nothing is read from the world. */
export interface HaltInput {
  readonly def: BotDef;
  readonly status: BotSafetyStatus;
  readonly wallet: Wallet;
  readonly orders: readonly BotOrder[];
  /** a signal endpoint is attached — the poller must stop before anything else happens */
  readonly hasEndpoint: boolean;
  /** a JavaScript sandbox (a Worker) is attached — it is terminated, not asked to stop */
  readonly hasSandbox: boolean;
  /** the price the flatten prints at; 0 or less means the desk has no mark and cannot flatten */
  readonly mark: number;
  readonly feeRate: number;
  readonly cause: HaltCause;
  readonly now: number;
}

export type HaltStepKind = 'freeze' | 'cancel' | 'flatten' | 'seal' | 'status';

export interface HaltStep {
  readonly kind: HaltStepKind;
  /** false = there was nothing to do at this step. The step is still reported, never skipped:
   *  a halt that silently drops a line reads as a halt that forgot to do it. */
  readonly acted: boolean;
  /** what the host must do, or what was done — a finished sentence, shown verbatim */
  readonly text: string;
}

/**
 * What the host seals. The chain owns the hashing: window.chainAdd(type, data) computes
 * sha256(i|t|ty|JSON.stringify(d)|prev) and appends — this module must not hash, stamp or seal
 * anything, or there would be two chains disagreeing about the same event.
 *
 * `data` is small and flat on purpose. The chain keeps 300 entries and truncates to the last 120,
 * so every byte a bot writes is pressure on the user's own trade history: a chatty kill entry —
 * the order list, the log tail, the wallet — would evict the trades they came to the ledger to
 * check. Counts and totals here; the detail lives in the logbook, which nobody is hashing.
 */
export interface KillEntry {
  readonly bot: string;
  readonly name: string;
  readonly why: HaltCause;
  /** how many resting orders were cancelled */
  readonly cancelled: number;
  /** quantity market-flattened; 0 when the bot held nothing */
  readonly flat: number;
  /** the mark the flatten printed at; 0 when nothing was flattened */
  readonly px: number;
  /** the bot's own wallet, closing equity, after the flatten */
  readonly eq: number;
}

export interface LedgerDraft {
  readonly type: 'BOT_EMERGENCY_KILL';
  readonly data: KillEntry;
}

export interface HaltPlan {
  readonly id: string;
  /** the five steps, always in this order, always all five */
  readonly steps: readonly HaltStep[];
  readonly wallet: Wallet;
  readonly fill: BotFill | null;
  readonly status: HaltedStatus;
  readonly draft: LedgerDraft;
  /** ids the host must cancel — the host holds the book, this module only decides */
  readonly cancelled: readonly string[];
}

const CAUSE: Readonly<Record<HaltCause, string>> = {
  user: 'you pulled it',
  'rate-limit': 'the venue rate-limited this bot',
  'repeated-failure': 'the bot failed too many times in a row',
};

const money = (x: number): string => x.toFixed(2);

/**
 * Halt one bot. The five steps come back in the order they must happen in, whether or not each
 * had work to do, followed by the state that results.
 */
export function planHalt(input: HaltInput): HaltPlan {
  const { def, wallet, orders, mark, feeRate, cause, now } = input;
  const steps: HaltStep[] = [];

  const source = input.hasEndpoint ? 'endpoint' : input.hasSandbox ? 'sandbox' : null;
  steps.push({
    kind: 'freeze', acted: source !== null,
    text: source === 'endpoint'
      ? 'Frozen the signal endpoint — ' + (def.url || 'the URL') + ' will not be polled again, so the bot cannot answer with another decision mid-halt.'
      : source === 'sandbox'
        ? 'Terminated the sandbox — the Worker running your JavaScript is gone, which is the only way to stop code that will not stop itself.'
        : 'Nothing to freeze — this bot decides from rules inside DexLadder, and the rules are not consulted once it is halted.',
  });

  const cancelled = orders.map(o => o.id);
  steps.push({
    kind: 'cancel', acted: cancelled.length > 0,
    text: cancelled.length
      ? 'Cancelled ' + cancelled.length + ' resting order(s): ' + orders.map(o => o.kind + ' ' + o.side + ' ' + o.qty.toPrecision(6) + ' @ ' + o.px.toPrecision(8)).join(' · ') + '.'
      : 'No resting orders to cancel — the bot had nothing working in the book.',
  });

  const held = holding(wallet);
  const canFlatten = held && mark > 0;
  const flat = canFlatten
    ? fill(wallet, 'sell', 1, mark, feeRate, now, 'close-out', 'emergency halt — ' + CAUSE[cause])
    : null;
  const w = flat ? flat.wallet : wallet;
  steps.push({
    kind: 'flatten', acted: !!(flat && flat.fill),
    text: flat && flat.fill
      ? 'Market-flattened ' + flat.fill.qty.toPrecision(6) + ' ' + def.sym + ' at the ' + mark.toPrecision(8) + ' mark into this bot’s own wallet — ' + flat.text + '. Your account was not touched; it never is.'
      : held
        ? 'Could not flatten ' + wallet.qty.toPrecision(6) + ' ' + def.sym + ' — there is no mark to print against right now. The position stays open and the bot stays halted; flatten it by hand once a price is back.'
        : 'Nothing held — the wallet was already flat.',
  });

  const eq = mark > 0 ? equity(w, mark) : w.cash + w.qty * w.lastPx;
  const draft: LedgerDraft = {
    type: 'BOT_EMERGENCY_KILL',
    data: {
      bot: def.id,
      name: def.name,
      why: cause,
      cancelled: cancelled.length,
      flat: flat && flat.fill ? +flat.fill.qty.toPrecision(8) : 0,
      px: flat && flat.fill ? +flat.fill.px.toPrecision(8) : 0,
      eq: +eq.toFixed(2),
    },
  };
  steps.push({
    kind: 'seal', acted: true,
    text: 'Sealed one BOT_EMERGENCY_KILL entry into the proof ledger: ' + def.name + ', ' + CAUSE[cause] + ', ' + cancelled.length + ' order(s) cancelled, ' + (draft.data.flat ? draft.data.flat.toPrecision(6) + ' flattened at ' + draft.data.px.toPrecision(8) : 'nothing flattened') + ', wallet closing at ' + money(draft.data.eq) + ' USDT.',
  });

  steps.push({
    kind: 'status', acted: true,
    text: def.name + ' is HALTED_SAFETY — ' + CAUSE[cause] + '. It will not decide, order or fill again until you read this and start it yourself.',
  });

  return { id: def.id, steps, wallet: w, fill: flat ? flat.fill : null, status: HALTED_SAFETY, draft, cancelled };
}

/**
 * Is this bot still in the market in any sense? A halt has to cover more than 'live': a paused bot
 * keeps its position and resumes on its own the moment someone taps resume, and a bot stopped by
 * repeated errors can still be holding. Only a draft that never ran, one already stopped flat, and
 * one already halted are left alone — halting those would seal a ledger entry that says nothing.
 */
export const isHaltable = (s: BotSafetyStatus): boolean => s === 'live' || s === 'paused' || s === 'error';

/**
 * The global kill switch: one pass, one plan and one ledger draft per bot that was still in the
 * market. Bots that were already out are skipped rather than sealed — an entry per idle draft bot
 * would push the user's trades out of the chain's 120-entry tail for no information.
 * The order of the plans follows the order of the runs given, so the desk can print them as it
 * already lists them.
 */
export function planHaltAll(runs: readonly HaltInput[]): readonly HaltPlan[] {
  return runs.filter(r => isHaltable(r.status)).map(planHalt);
}

/** One line for the toast over the whole sweep — the desk shows this before anyone reads a plan. */
export function haltAllText(plans: readonly HaltPlan[]): string {
  if (!plans.length) return 'No bot was running — nothing to halt.';
  const flat = plans.filter(p => p.fill).length;
  const orders = plans.reduce((n, p) => n + p.cancelled.length, 0);
  return 'Halted ' + plans.length + ' bot(s) · ' + orders + ' order(s) cancelled · ' + flat + ' position(s) flattened · ' + plans.length + ' ledger entr' + (plans.length === 1 ? 'y' : 'ies') + ' sealed.';
}
