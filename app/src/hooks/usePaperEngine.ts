/**
 * usePaperEngine — the presenter every trading surface talks to.
 *
 * It owns sequencing and nothing else: validation, stop arming, the transaction's fate on-chain,
 * execution, the fill into the account, and the fate of the remainder are pure functions in
 * lib/paper-engine; the effects (placing a resting order, applying a fill, charging gas) are
 * injected, so the same presenter drives the legacy ticket today and a new ticket tomorrow, and
 * runs in tests with no DOM at all.
 *
 * On-chain orders (Advanced mode on the DEX venue) go through the network first:
 *   timeout   no validator picks the swap up → it is cancelled; the cancellation's gas is paid
 *   pending   it waits a few blocks → it meets a moved price (drift); beyond tolerance it REVERTS
 *   included  next block, at the quoted price (what the preview showed is what fills)
 * A revert pays the gas it burned. A front-end refusal (post-only, beyond tolerance at the quote,
 * FOK that cannot complete, near-zero liquidity, unaffordable) sends nothing and pays nothing.
 */
import { ticketError, isStopType, armStop, remainder, type Ticket, type Remainder, type StopArm } from '../lib/paper-engine/ticket';
import type { BookEngine } from '../lib/paper-engine/engine';
import type { Execution, MevFacts, MevOpts } from '../lib/paper-engine/match';
import { fateOf, reverted, pendingDrift, normal, BLOCK_SECONDS, GAS_UNITS, TIER_MULT, type Fate, type GasSignal, type PriorityTier } from '../lib/paper-engine/gas';

/** What the presenter needs to know to send an order on-chain. */
export interface NetworkCtx {
  readonly signal: GasSignal;
  readonly tier: PriorityTier;
  /** the coin's 24h move, percent — scales how far a pending swap's price can drift */
  readonly chg24: number;
  /** gas cost in the pair's quote asset for `units` at `gwei` */
  cost(units: number, gwei: number): number;
  /** simulated MEV bots are watching the public mempool (Advanced, opt-in) */
  readonly mev?: boolean;
}

/** What the ledger records about a fill beyond price and size. */
export interface FillMeta { readonly asked: number; readonly mevQuote: number }

export interface PaperDeps {
  readonly engine: BookEngine;
  price(sym: string, quote: string): number;
  held(sym: string): number;
  /**
   * Can the account pay for this fill (plus its gas)? Asked by the engine BEFORE it consumes any
   * liquidity, so an unaffordable order leaves the market untouched.
   */
  afford?(side: Ticket['side'], sym: string, quote: string, qty: number, px: number, rate: number, networkQuote: number): boolean;
  /**
   * apply a fill to the account at `rate`, paying `networkQuote` gas; false = unaffordable (nothing
   * changed). `meta` is for the ledger: the order's full size and what a sandwich cost.
   */
  fill(side: Ticket['side'], sym: string, quote: string, qty: number, px: number, rate: number, label: string, networkQuote: number, meta?: FillMeta): boolean;
  /** charge gas for a transaction that traded nothing (ledger row: `note`); returns what was paid */
  charge?(quote: string, amount: number, note: string): number;
  /** place a resting order; returns its id */
  place(type: string, side: Ticket['side'], sym: string, quote: string, qty: number, px: number, extra: Record<string, unknown>): string;
  /** present when this order settles on-chain */
  network?(t: Ticket): NetworkCtx | null;
  /** uniform [0,1) — the network's dice */
  random?(): number;
  /** domain events, emitted in the order they happen (a view renders them; a test records them) */
  emit?(e: PaperEvent): void;
}

type Filled = Extract<Execution, { remaining: number }>;
type Refusal = Extract<Execution, { unfunded: true }>;

export interface NetworkReport { readonly fate: Fate; readonly gasPaid: number }

export type PaperEvent =
  | { readonly type: 'network'; readonly report: NetworkReport }
  | { readonly type: 'filled'; readonly exec: Filled; readonly filled: number; readonly rest: number }
  | { readonly type: 'sandwiched'; readonly mev: MevFacts }
  | { readonly type: 'remainder'; readonly remainder: Remainder; readonly rest: number; readonly ahead: number };

export type Outcome =
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'armed'; readonly arm: StopArm; readonly cur: number; readonly id: string }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'unfunded'; readonly exec: Filled | Refusal }
  | { readonly status: 'dropped'; readonly network: NetworkReport }
  | { readonly status: 'reverted'; readonly reason: string; readonly network: NetworkReport }
  | {
      readonly status: 'done';
      readonly exec: Filled | null;
      readonly filled: number;
      readonly rest: number;
      readonly remainder: Remainder;
      readonly ahead: number;
      readonly restId: string | null;
      readonly network: NetworkReport | null;
    };

export interface PaperEngine {
  submit(t: Ticket): Outcome;
}

export function usePaperEngine(deps: PaperDeps): PaperEngine {
  const rnd = () => (deps.random ? deps.random() : Math.random());
  const report = (fate: Fate, gasPaid: number): NetworkReport => {
    const r = { fate, gasPaid };
    deps.emit?.({ type: 'network', report: r });
    return r;
  };
  /** a swap that was sent and failed on-chain: it burned revert gas at the price it was sent at */
  const revert = (quote: string, net: NetworkCtx, fate: Fate, reason: string): Outcome => {
    const rv = reverted(fate);
    const paid = deps.charge ? deps.charge(quote, net.cost(rv.units, rv.gwei), 'reverted swap') : 0;
    return { status: 'reverted', reason, network: report(rv, paid) };
  };
  return {
    submit(t) {
      const err = ticketError(t, deps.held(t.sym));
      if (err) return { status: 'invalid', message: err };
      if (isStopType(t.type)) {
        const cur = deps.price(t.sym, t.quote), arm = armStop(t, cur);
        return { status: 'armed', arm, cur, id: deps.place(arm.type, t.side, t.sym, t.quote, t.amt, arm.px, arm.extra) };
      }
      const estGas = (n: NetworkCtx): number => n.cost(GAS_UNITS.swap, n.signal.gwei * TIER_MULT[n.tier]);
      const wouldSend = (n: NetworkCtx): boolean => {
        const pv = deps.engine.preview(t.sym, t.quote, t.side, t.amt, { limit: t.limit, type: t.type, postOnly: t.postOnly, ...(t.tolerancePct != null ? { tolerancePct: t.tolerancePct } : {}) });
        if (!pv || !(pv.filled > 1e-12) || t.postOnly) return false;
        if (pv.amm && (!pv.amm.withinTolerance || pv.amm.nearZero)) return false;
        if (String(t.tif || '').toUpperCase() === 'FOK' && pv.remaining > 1e-9) return false;
        return !deps.afford || deps.afford(t.side, t.sym, t.quote, pv.filled, pv.avg, pv.feeRate, estGas(n));
      };
      // ---- the network, for on-chain orders
      // Only a swap the wallet would actually send goes on-chain. The front-end refuses — sending
      // nothing and paying nothing — an order that would not trade now (a limit away from the price,
      // post-only), one already beyond tolerance at the quote, a fill-or-kill that cannot complete,
      // and one the account cannot pay for (a wallet's gas estimate fails the same way).
      const onChain = deps.network ? deps.network(t) : null;
      const net = onChain && wouldSend(onChain) ? onChain : null;
      // an on-chain order the wallet refused is still judged WITH its gas (so it stays unaffordable)
      let fate: Fate | null = null, drift = 0, swapGas = onChain && !net ? estGas(onChain) : 0;
      if (net) {
        fate = fateOf(net.signal, net.tier, rnd(), rnd());
        if (fate.fate === 'timeout') {
          const paid = deps.charge ? deps.charge(t.quote, net.cost(fate.units, fate.gwei), 'cancelled swap (never mined)') : 0;
          return { status: 'dropped', network: report(fate, paid) };
        }
        // included next block = the quoted price (preview = fill); pending = it meets a moved price
        if (fate.fate === 'pending') drift = pendingDrift(net.chg24, fate.blocks * BLOCK_SECONDS, normal(rnd(), rnd()), fate.congestion);
        swapGas = net.cost(GAS_UNITS.swap, fate.gwei);
      }
      // bots pay two swaps at High priority; they only attack when that is worth it (mev.ts)
      const mev: MevOpts | null = net && net.mev && fate ? { botGasQuote: 2 * net.cost(GAS_UNITS.swap, net.signal.gwei * TIER_MULT.high) } : null;
      const R = deps.engine.execute(t.sym, t.quote, t.side, t.amt, {
        ...(mev ? { mev } : {}),
        limit: t.limit, tif: t.tif, postOnly: t.postOnly,
        ...(t.tolerancePct != null ? { tolerancePct: t.tolerancePct } : {}),
        ...(drift ? { driftPct: drift } : {}),
        ...(deps.afford ? { afford: (q: number, px: number, rate: number) => deps.afford!(t.side, t.sym, t.quote, q, px, rate, swapGas) } : {}),
      });
      if ('rejected' in R && R.rejected) {
        // an on-chain swap that cannot meet its terms (tolerance, fill-or-kill) is mined and REVERTS
        if (net && fate && (R.code === 'tolerance' || R.code === 'fok')) return revert(t.quote, net, fate, R.reason);
        return { status: 'rejected', reason: R.reason };
      }
      if ('unfunded' in R) {
        // sent, then unaffordable at execution (a sandwich made it dearer): it reverts, gas is burned
        if (net && fate) return revert(t.quote, net, fate, 'Your balance could not cover the swap at the price it met on-chain.');
        return { status: 'unfunded', exec: R };
      }
      const exec = 'remaining' in R ? R : null;
      const filled = (exec && exec.filled) || 0, rest = (exec && exec.remaining) || 0;
      let network: NetworkReport | null = null;
      if (filled > 1e-12 && exec) {
        const meta: FillMeta = { asked: t.amt, mevQuote: (exec.amm && exec.amm.sandwich && exec.amm.sandwich.extraQuote) || 0 };
        if (!deps.fill(t.side, t.sym, t.quote, filled, exec.avg, exec.feeRate, t.type, swapGas, meta)) return { status: 'unfunded', exec };
        if (net && fate) network = report(fate, swapGas);
        if (exec.amm && exec.amm.sandwich) deps.emit?.({ type: 'sandwiched', mev: exec.amm.sandwich });
        deps.emit?.({ type: 'filled', exec, filled, rest });
      }
      const rem = remainder(t, rest, (exec && exec.mid) || 0, !!(exec && exec.amm));
      let ahead = 0, restId: string | null = null;
      if (rem.kind === 'rest') {
        ahead = deps.engine.queueAhead(t.sym, t.quote, t.side, rem.px);
        restId = deps.place('limit', t.side, t.sym, t.quote, rest, rem.px, { tif: t.tif, post: t.postOnly, reduce: t.reduceOnly, qAhead: ahead, q0: ahead, orig: t.amt });
      }
      if (rem.kind !== 'none') deps.emit?.({ type: 'remainder', remainder: rem, rest, ahead });
      return { status: 'done', exec, filled, rest, remainder: rem, ahead, restId, network };
    },
  };
}
