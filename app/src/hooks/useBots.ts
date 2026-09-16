/**
 * useBots — the presenter that runs every bot against the live market. It owns the loop and
 * nothing else: the wallet, the rules, the scoring are pure functions in lib/bots; the clock, the
 * bars, the live price, the two "bring your own" deciders and the store are injected, so a test
 * drives a whole life (history → closed bar → signal → fill → stop-loss) without a timer or a socket.
 *
 * Isolation is structural: a bot's fills go to ITS wallet (a value in this hook), never to the
 * trader's paper account, which this file cannot even name.
 */
import { evaluate, type Action, type BotCtx, type BotDef, type BotOrder, type BotStatus, type Candle, type Exchange, type Health, type LogEventKind, type LogEventLevel, type LogLine, type Sample, type Signal, type Wallet } from '../lib/bots';
import { slipped } from '../lib/bots/backtest';
import { buildCtx } from '../lib/bots/sandbox';
import { INTERVAL_MS, barStart, mergeBars } from '../lib/bots/intervals';
import { fill, holding, mark, open, riskExit, score, type Score } from '../lib/bots/wallet';

export interface RunState {
  readonly def: BotDef;
  status: BotStatus;
  wallet: Wallet;
  /** the bot's OWN resting orders — never the trader's book. The kill switch cancels exactly
   *  these, by id, before it flattens; a bot with none still reports the step. */
  orders: BotOrder[];
  bars: Candle[];
  log: LogLine[];
  /** start time of the last closed bar the bot has decided on */
  lastBarT: number;
  lastAction: Action | null;
  health: Health;
  barsSinceExit: number;
  /** what the store keeps between visits */
  startedAt: number;
  busy: boolean;
}

/** the slice of a run that survives a reload (bars are re-fetched, never stored) */
export interface Persisted {
  readonly def: BotDef; readonly status: BotStatus; readonly wallet: Wallet; readonly log: readonly LogLine[];
  readonly lastBarT: number; readonly lastAction: Action | null; readonly startedAt: number; readonly barsSinceExit: number;
}

/** what the layer measured around its own call, for the endpoint telemetry ring */
export interface PollReport { readonly sample: Sample; readonly raw?: Exchange }
export type Decision = { readonly signal: Signal; readonly ms: number; readonly poll?: PollReport } | { readonly error: string; readonly ms: number; readonly poll?: PollReport };

export interface BotsDeps {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  /** the closed bars of a market at a bar size, oldest first (history or a refresh) */
  bars(def: BotDef): Promise<readonly Candle[]>;
  /** the live mark, or 0 when unknown */
  price(sym: string): number;
  feeRate(): number;
  decideJs(def: BotDef, ctx: BotCtx): Promise<Decision>;
  decideSignal(def: BotDef, ctx: BotCtx): Promise<Decision>;
  persist(runs: readonly Persisted[]): void;
  emit?(kind: 'change' | 'fill' | 'error', id: string, text?: string): void;
  /** basis points every live fill moves against itself — the same setting the backtest uses */
  slipBps?(): number;
  /** every line the runner writes, for the desk's execution logbook (the desk owns the book) */
  log?(id: string, kind: LogEventKind, level: LogEventLevel, text: string): void;
}

export const TICK_MS = 20_000;
const LOG_CAP = 250;
const MAX_ERRORS = 5;

export interface Bots {
  runs(): readonly RunState[];
  get(id: string): RunState | undefined;
  restore(rows: readonly Persisted[]): void;
  add(def: BotDef): RunState;
  remove(id: string): void;
  start(id: string): Promise<void>;
  pause(id: string): void;
  stop(id: string): void;
  reset(id: string): void;
  /** one loop iteration: marks, then any bars that closed */
  tick(): Promise<void>;
  /** start / stop the scheduler */
  wake(): void;
  sleep(): void;
  /** persist and repaint after the HOST changed a run in place — the kill switch is the one
   *  caller: the halt plan is applied outside this hook (it seals a ledger entry, which is an
   *  effect a presenter may not hold), and the store must still be told. */
  commit(id?: string): void;
  scoreOf(id: string): Score | null;
  awake(): boolean;
}

export function useBots(d: BotsDeps): Bots {
  const R = new Map<string, RunState>();
  let cancel: (() => void) | null = null, ticking = false;

  // The card's own log keeps its five kinds; the desk's logbook has its own vocabulary, so one
  // map here is the only place the two ever meet.
  const EV: Readonly<Record<LogLine['kind'], [LogEventKind, LogEventLevel]>> = {
    info: ['tick', 'info'], signal: ['eval', 'info'], fill: ['fill', 'info'],
    risk: ['fill', 'warn'], error: ['error', 'error'], health: ['tick', 'info'],
  };
  const say = (r: RunState, kind: LogLine['kind'], text: string): void => {
    r.log.push({ t: d.now(), kind, text });
    if (r.log.length > LOG_CAP) r.log.splice(0, r.log.length - LOG_CAP);
    const ev = EV[kind];
    d.log?.(r.def.id, ev[0], ev[1], text);
  };
  /** the price a live fill actually gets, moved against itself by the desk's slippage setting */
  const at = (side: 'buy' | 'sell', px: number): number => slipped(px, side, d.slipBps?.() ?? 0);
  const changed = (r: RunState): void => { d.emit?.('change', r.def.id); };
  const persisted = (): Persisted[] => [...R.values()].map(r => ({ def: r.def, status: r.status, wallet: r.wallet, log: r.log, lastBarT: r.lastBarT, lastAction: r.lastAction, startedAt: r.startedAt, barsSinceExit: r.barsSinceExit }));
  const save = (): void => { try { d.persist(persisted()); } catch { /* the store is an effect; a failing one never stops a bot */ } };

  const fresh = (def: BotDef): RunState => ({ def, status: 'draft', wallet: open(def.stake), orders: [], bars: [], log: [], lastBarT: 0, lastAction: null, health: { ok: true, text: 'not started', ms: 0, errors: 0 }, barsSinceExit: -1, startedAt: 0, busy: false });

  function applyRisk(r: RunState, px: number): void {
    const s = r.def.strategy;
    if (!s) return;
    const hit = riskExit(r.wallet, s.risk, px);
    if (!hit) return;
    const f = fill(r.wallet, 'sell', 1, at('sell', px), d.feeRate(), d.now(), hit.why, hit.reason);
    r.wallet = f.wallet; r.barsSinceExit = 0; r.lastAction = 'sell';
    say(r, 'risk', hit.reason + ' → ' + f.text);
    d.emit?.('fill', r.def.id, hit.why + ' · ' + f.text);
  }

  /** mark the wallet at the live price; a risk rule that trips sells here, wick and all */
  function markLive(r: RunState): void {
    const px = d.price(r.def.sym);
    if (!(px > 0)) return;
    r.wallet = mark(r.wallet, px, d.now());
    if (r.def.kind === 'rules') applyRisk(r, px);
  }

  async function decide(r: RunState, ctx: BotCtx): Promise<Decision> {
    const t0 = d.now();
    if (r.def.kind === 'rules' && r.def.strategy) return { signal: evaluate(r.def.strategy, r.bars, r.bars.length - 1, holding(r.wallet), r.barsSinceExit), ms: d.now() - t0 };
    if (r.def.kind === 'js') return d.decideJs(r.def, ctx);
    return d.decideSignal(r.def, ctx);
  }

  function act(r: RunState, sig: Signal): void {
    r.lastAction = sig.action;
    if (sig.action === 'hold') { say(r, 'signal', 'hold · ' + sig.reason); return; }
    const px = d.price(r.def.sym) || r.bars[r.bars.length - 1]?.c || 0;
    if (sig.action === 'buy' && holding(r.wallet) && r.def.kind === 'rules') { say(r, 'signal', 'buy ignored — already holding · ' + sig.reason); return; }
    if (sig.action === 'sell' && !holding(r.wallet)) { say(r, 'signal', 'sell ignored — nothing held · ' + sig.reason); return; }
    const share = sig.size ?? (sig.action === 'buy' ? (r.def.strategy?.risk.stakePct ?? 1) : 1);
    d.log?.(r.def.id, 'eval', 'info', 'Conditions met on the close → ' + sig.action + ' · ' + sig.reason);
    d.log?.(r.def.id, 'dispatch', 'info', 'Sending a market ' + sig.action + ' for ' + (share * 100).toFixed(0) + '% of the ' + (sig.action === 'buy' ? 'wallet’s cash' : 'position') + ' at the ' + px.toPrecision(8) + ' mark.');
    const f = fill(r.wallet, sig.action, share, at(sig.action, px), d.feeRate(), d.now(), 'signal', sig.reason);
    r.wallet = f.wallet;
    if (f.fill) {
      if (sig.action === 'sell' && !holding(r.wallet)) r.barsSinceExit = 0;
      say(r, 'fill', sig.action + ' → ' + f.text + ' · because ' + sig.reason);
      d.emit?.('fill', r.def.id, sig.action + ' · ' + f.text);
    } else say(r, 'error', 'could not ' + sig.action + ': ' + f.text);
  }

  /** bars closed since the bot last decided: decide on the newest, once */
  async function onBars(r: RunState): Promise<void> {
    const iv = INTERVAL_MS[r.def.interval];
    const last = r.bars[r.bars.length - 1];
    if (!last || last.t <= r.lastBarT) return;
    const missed = r.lastBarT ? Math.round((last.t - r.lastBarT) / iv) - 1 : 0;
    if (missed > 0) { say(r, 'info', missed + ' bar(s) closed while this page was away — no trades were taken for them; the bot decides on the newest.'); r.barsSinceExit = r.barsSinceExit >= 0 ? r.barsSinceExit + missed : -1; }
    if (r.barsSinceExit >= 0) r.barsSinceExit += 1;
    r.lastBarT = last.t;
    d.log?.(r.def.id, 'tick', 'debug', 'A ' + r.def.interval + ' bar closed at ' + last.c.toPrecision(8) + ' (open ' + last.o.toPrecision(8) + ', high ' + last.h.toPrecision(8) + ', low ' + last.l.toPrecision(8) + ') — the bot is deciding on it.');
    const ctx = buildCtx(r.def.sym, r.def.interval, r.bars, r.wallet, r.lastAction);
    const out = await decide(r, ctx);
    if ('error' in out) {
      r.health = { ok: false, text: out.error, ms: out.ms, errors: r.health.errors + 1 };
      say(r, 'error', out.error);
      d.emit?.('error', r.def.id, out.error);
      if (r.health.errors >= MAX_ERRORS) { r.status = 'error'; say(r, 'health', 'stopped after ' + MAX_ERRORS + ' consecutive errors — fix the bot and start it again'); }
      return;
    }
    r.health = { ok: true, text: 'answered in ' + out.ms + ' ms', ms: out.ms, errors: 0 };
    act(r, out.signal);
  }

  async function refresh(r: RunState): Promise<void> {
    const rows = await d.bars(r.def);
    const m = mergeBars(r.bars, rows, r.def.interval, d.now());
    r.bars = m.bars;
  }

  async function step(r: RunState): Promise<void> {
    if (r.status !== 'live' || r.busy) return;
    r.busy = true;
    try {
      markLive(r);
      const due = barStart(d.now(), r.def.interval) - INTERVAL_MS[r.def.interval];   // start of the newest CLOSED bar
      if (due > r.lastBarT) {
        await refresh(r);
        await onBars(r);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r.health = { ok: false, text: msg, ms: 0, errors: r.health.errors + 1 };
      say(r, 'error', 'bars: ' + msg);
    } finally { r.busy = false; }
    changed(r);
  }

  const api: Bots = {
    runs: () => [...R.values()],
    get: id => R.get(id),
    restore(rows) {
      // v162 · this loop ran unguarded inside the caller's single try/catch, so
      // one row with a missing log (a partial write, an older shape) threw on
      // [...p.log] and every OTHER bot was dropped with it — an empty desk and no
      // error shown. Each row now stands or falls on its own.
      let bad = 0;
      for (const p of rows) {
        try {
          const r = fresh(p.def);
          r.status = p.status === 'live' ? 'live' : p.status; r.wallet = p.wallet; r.log = Array.isArray(p.log) ? [...p.log] : []; r.lastBarT = p.lastBarT; r.lastAction = p.lastAction; r.startedAt = p.startedAt; r.barsSinceExit = p.barsSinceExit;
          if (r.status === 'live') say(r, 'health', 'resumed — reloading history');
          R.set(p.def.id, r);
        } catch { bad++; }
      }
      if (bad) d.emit?.('error', 'restore', bad + ' saved bot(s) could not be restored and were dropped');
      if ([...R.values()].some(r => r.status === 'live')) api.wake();
    },
    add(def) { const r = fresh(def); R.set(def.id, r); save(); changed(r); return r; },
    remove(id) { R.delete(id); save(); d.emit?.('change', id); },
    async start(id) {
      const r = R.get(id);
      if (!r || r.status === 'live') return;
      r.status = 'live'; r.health = { ok: true, text: 'loading history', ms: 0, errors: 0 };
      if (!r.startedAt) r.startedAt = d.now();
      say(r, 'health', r.wallet.marks ? 'started again' : 'started with ' + r.def.stake.toLocaleString('en-US') + ' USDT of paper cash on ' + r.def.sym + ' · ' + r.def.interval + ' bars');
      changed(r);
      try {
        await refresh(r);
        if (!r.lastBarT && r.bars.length) r.lastBarT = r.bars[r.bars.length - 1]!.t;   // a new bot decides from the NEXT close, never on history it did not live through
        markLive(r);
        say(r, 'info', r.bars.length + ' closed bars loaded · first decision at the next ' + r.def.interval + ' close');
        r.health = { ok: true, text: 'waiting for the next close', ms: 0, errors: 0 };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        r.health = { ok: false, text: msg, ms: 0, errors: 1 }; say(r, 'error', 'could not load bars: ' + msg);
      }
      save(); changed(r); api.wake();
    },
    pause(id) { const r = R.get(id); if (r && r.status === 'live') { r.status = 'paused'; say(r, 'health', 'paused — the wallet keeps its position, nothing is decided until you resume'); save(); changed(r); } },
    stop(id) {
      const r = R.get(id); if (!r) return;
      const px = d.price(r.def.sym) || r.wallet.lastPx;
      if (holding(r.wallet) && px > 0) { const f = fill(r.wallet, 'sell', 1, at('sell', px), d.feeRate(), d.now(), 'close-out', 'stopped — measured flat'); r.wallet = f.wallet; say(r, 'fill', 'close-out → ' + f.text); }
      r.status = 'stopped'; say(r, 'health', 'stopped'); save(); changed(r);
    },
    reset(id) { const r = R.get(id); if (!r) return; const n = fresh(r.def); R.set(id, n); say(n, 'health', 'reset — a new wallet of ' + r.def.stake.toLocaleString('en-US') + ' USDT'); save(); changed(n); },
    async tick() {
      if (ticking) return;
      ticking = true;
      try { for (const r of R.values()) await step(r); } finally { ticking = false; }
      save();
    },
    wake() {
      if (cancel) return;
      const loop = (): void => { cancel = d.schedule(() => { void api.tick().then(loop); }, TICK_MS); };
      loop();
    },
    sleep() { if (cancel) { cancel(); cancel = null; } },
    commit(id) { save(); d.emit?.('change', id ?? ''); },
    awake: () => !!cancel,
    scoreOf(id) { const r = R.get(id); return r ? score(r.wallet) : null; },
  };
  return api;
}
