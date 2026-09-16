/**
 * The host half of the two things the pure cores deliberately refuse to do: APPLY a halt plan, and
 * run a backtest somewhere other than the main thread.
 *
 * `lib/bots/kill.ts` decides what a halt is — five steps in a fixed order, the resulting wallet,
 * the flatten fill, the order ids to cancel and one flat ledger draft — and stops there, because
 * hashing is the chain's job and cancelling is the book's. Everything it decided is carried out
 * here, in that order, and exactly once.
 */
import { haltAllText, isHaltable, planHalt, type HaltCause, type HaltInput, type HaltPlan } from '../lib/bots/kill';
import { slipped, runStrategy, type BacktestResult } from '../lib/bots/backtest';
import { BOTS, feeRate, price, seal, slipBps, transport, type BtProgress } from './bots';
import { write } from './bots-book';
import type { Candle, Strategy } from '../lib/bots';
import type { RunState } from '../hooks/useBots';

export interface HaltOutcome {
  readonly plan: HaltPlan;
  readonly name: string;
  /** false = the halt finished but no receipt was written; the desk says so out loud */
  readonly sealed: boolean;
}

export interface HaltReport {
  readonly outcomes: readonly HaltOutcome[];
  readonly headline: string;
  /** '' when every entry was sealed; otherwise the sentence the desk must show */
  readonly sealNote: string;
}

/**
 * One bot, as the halt planner needs to see it.
 *
 * The mark is slipped before it is handed over, because an emergency flatten is a market order and
 * pays the same concession every other live fill pays. Handing over the raw tape price would seal
 * a ledger entry quoting a price the bot was not filled at.
 */
const inputOf = (r: RunState, cause: HaltCause, now: number): HaltInput => {
  const mark = price(r.def.sym) || r.wallet.lastPx;
  return {
    def: r.def, status: r.status, wallet: r.wallet, orders: r.orders,
    hasEndpoint: r.def.kind === 'signal', hasSandbox: r.def.kind === 'js',
    mark: mark > 0 ? slipped(mark, 'sell', slipBps()) : 0,
    feeRate: feeRate(), cause, now,
  };
};

const scoped = (id?: string): RunState[] => BOTS.runs().filter(r => (!id || r.def.id === id) && isHaltable(r.status));

/**
 * What firing now would do, without doing it. The confirmation prints these sentences verbatim, so
 * what the user agrees to is the plan that runs — recomputed on confirm off a mark that may have
 * moved by a tick, never a different set of steps.
 */
export const preview = (id?: string, cause: HaltCause = 'user', now = Date.now()): readonly HaltPlan[] =>
  scoped(id).map(r => planHalt(inputOf(r, cause, now)));

/** Carry one plan out: cancel exactly the ids it named, take its wallet and its fill, stand down. */
function apply(r: RunState, plan: HaltPlan): void {
  const cancelled = new Set(plan.cancelled);
  r.orders = r.orders.filter(o => !cancelled.has(o.id));
  r.wallet = plan.wallet;
  r.status = 'halted';
  try { transport()?.stop?.(r.def); } catch { /* a sandbox that will not die is still halted */ }
  const t = Date.now();
  for (const s of plan.steps) write({ bot: r.def.id, t, kind: 'halt', level: s.acted ? 'warn' : 'info', text: s.text });
}

/**
 * Fire. Every haltable bot (or the one named) is frozen, cancelled, flattened, sealed and marked
 * halted, in that order, and the ledger gets ONE entry each — never one per step.
 *
 * When `window.chainAdd` is not on this page the seal simply does not happen: the halt still
 * completes, the bots are still out of the market, and the report says the receipt could not be
 * written. Refusing to halt because a receipt failed would be the worst possible failure mode.
 */
export function fire(id?: string, cause: HaltCause = 'user'): HaltReport {
  const now = Date.now();
  const outcomes = scoped(id).map(r => {
    const plan = planHalt(inputOf(r, cause, now));
    apply(r, plan);
    const sealed = seal(plan.draft.type, plan.draft.data);
    if (!sealed) write({ bot: r.def.id, t: now, kind: 'halt', level: 'error', text: 'The halt finished, but no BOT_EMERGENCY_KILL entry could be sealed — the proof ledger is not on this page. Everything above still happened; only the receipt is missing.' });
    return { plan, name: r.def.name, sealed };
  });
  BOTS.commit(id);
  const unsealed = outcomes.filter(o => !o.sealed).length;
  // `haltAllText` ends by counting the entries sealed, because from the plan's side sealing is
  // simply the fourth step. Only the host knows whether the chain accepted them, so when it did
  // not, that clause is replaced rather than left standing next to a note contradicting it.
  const said = haltAllText(outcomes.map(o => o.plan));
  return {
    outcomes,
    headline: unsealed
      ? said.replace(/ · \d+ ledger entr(?:y|ies) sealed\.$/, '') + ' · ' + (outcomes.length - unsealed) + ' of ' + outcomes.length + ' sealed into the proof ledger.'
      : said,
    sealNote: unsealed ? unsealed + ' of ' + outcomes.length + ' halt(s) could not be sealed into the proof ledger — this page has no chain to write to. The bots are out of the market regardless; only the receipt is missing.' : '',
  };
}

// ---------------------------------------------------------------- the backtest, off the main thread

export interface BtRun {
  readonly result: BacktestResult;
  readonly ms: number;
  /** false = this page had no Worker and the fold ran on the main thread instead */
  readonly viaWorker: boolean;
  readonly note: string;
}

/**
 * Run a strategy over bars, in a Worker when this page has one.
 *
 * The Worker is handed the same five arguments the main thread would pass and runs the same
 * `runStrategy` out of the same bundle, so "identical numbers" is a property of the construction
 * rather than a hope — and `DLBOTS.btProof()` re-proves it at runtime by running both and
 * comparing the two results field for field.
 */
export async function backtest(strategy: Strategy, bars: readonly Candle[], stake: number, onProgress?: (p: BtProgress) => void): Promise<BtRun> {
  const req = { strategy, bars, stake, feeRate: feeRate(), slipBps: slipBps() };
  const t = transport();
  const t0 = Date.now();
  if (t && t.backtest) {
    try {
      const result = await t.backtest(req, p => onProgress?.(p));
      return { result, ms: Date.now() - t0, viaWorker: true, note: 'Run in a Worker of its own, so the desk stayed responsive while it walked ' + bars.length.toLocaleString('en-US') + ' bars.' };
    } catch (e) {
      onProgress?.({ step: 0, of: 3, text: 'The Worker could not run it — falling back to this thread.' });
      const result = runStrategy(strategy, bars, stake, req.feeRate, { slipBps: req.slipBps });
      return { result, ms: Date.now() - t0, viaWorker: false, note: 'The background Worker could not start (' + ((e as Error).message || e) + '), so this ran on the main thread — same arguments, same numbers, but the page was blocked while it did.' };
    }
  }
  const result = runStrategy(strategy, bars, stake, req.feeRate, { slipBps: req.slipBps });
  return { result, ms: Date.now() - t0, viaWorker: false, note: 'Run on the main thread — this page installed no backtest Worker.' };
}
