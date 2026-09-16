/**
 * useBacktest — the presenter behind the Rewind desk. It owns playback and nothing else: the
 * fills, the equity curve, the metrics and the verdict are pure functions in lib/backtest, and
 * the clock is injected, so a test drives a whole run without a timer and the desk replays
 * exactly what the engine computed.
 *
 * Time only moves forward. Scrubbing back would need the trader's decisions replayed too, which
 * nobody can honestly reproduce — so the desk restarts instead, and says so.
 */
import { advance, cancel as cancelOrder, closeOut, init, metrics, submit, verdict, type BtEvent, type BtOrder, type BtOrderType, type BtSide, type BtState, type Candle, type IntervalId, type Metrics, type Verdict } from '../lib/backtest';

export interface Loaded {
  readonly sym: string;
  readonly interval: IntervalId;
  /** bars drawn for context before the run's first bar — never traded */
  readonly context: readonly Candle[];
  /** the bars of the run itself */
  readonly bars: readonly Candle[];
  readonly source: string;
  readonly feeRate: number;
  /** "1h bars · 12 Mar → 20 Apr 2026" */
  readonly label: string;
}

export type RunEvent =
  | { readonly kind: 'loaded'; readonly run: Loaded }
  | { readonly kind: 'bar'; readonly state: BtState }
  | { readonly kind: 'order'; readonly events: readonly BtEvent[] }
  | { readonly kind: 'rejected'; readonly why: string }
  | { readonly kind: 'end'; readonly state: BtState };

export interface BacktestDeps {
  /** run `fn` after `ms`; returns a cancel */
  schedule(fn: () => void, ms: number): () => void;
  id(): string;
  emit?(e: RunEvent): void;
  /** ms per bar at 1× (default 900) */
  readonly beat?: number;
}

export const SPEEDS = [1, 4, 16, 64] as const;

export interface Backtest {
  load(run: Loaded, cash: number): void;
  run(): Loaded | null;
  state(): BtState;
  playing(): boolean;
  speed(): number;
  setSpeed(x: number): void;
  step(n?: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  restart(): void;
  finish(): void;
  order(o: { type: BtOrderType; side: BtSide; qty: number; px?: number }): string | null;
  cancel(id: string): void;
  metrics(): Metrics;
  verdict(): Verdict;
  /** bars drawn so far: the context plus every bar the run has reached */
  visible(): readonly Candle[];
}

export function useBacktest(d: BacktestDeps): Backtest {
  let loaded: Loaded | null = null, st: BtState = init(0), cash0 = 10_000, spd = 1, stop: (() => void) | null = null;
  const emit = (e: RunEvent): void => { try { d.emit?.(e); } catch { /* a view error never breaks a run */ } };
  const bars = (): readonly Candle[] => (loaded ? loaded.bars : []);
  const atEnd = (): boolean => st.i >= bars().length - 1;

  function pause(): void { if (stop) { stop(); stop = null; } }

  function tick(): void {
    stop = null;
    if (!loaded || st.done) return;
    step(1);
    if (!atEnd() && !st.done) stop = d.schedule(tick, Math.max(40, (d.beat ?? 900) / spd));
  }

  function step(n = 1): void {
    if (!loaded) return;
    for (let k = 0; k < n && !atEnd() && !st.done; k++) {
      const r = advance(st, loaded.bars, loaded.feeRate);
      st = r.state;
      if (r.events.length) emit({ kind: 'order', events: r.events });
      emit({ kind: 'bar', state: st });
    }
    if (atEnd() && !st.done) finish();
  }

  function finish(): void {
    if (!loaded || st.done) return;
    pause();
    st = closeOut(st, loaded.bars, loaded.feeRate);
    emit({ kind: 'end', state: st });
  }

  return {
    load(run, cash) { pause(); loaded = run; cash0 = cash; st = init(cash); emit({ kind: 'loaded', run }); },
    run: () => loaded,
    state: () => st,
    playing: () => stop !== null,
    speed: () => spd,
    setSpeed(x) { spd = SPEEDS.includes(x as 1) ? x : 1; if (stop) { pause(); tick(); } },
    step, play() { if (loaded && !stop && !st.done) tick(); }, pause,
    toggle() { if (stop) pause(); else this.play(); },
    restart() { pause(); st = init(cash0); if (loaded) emit({ kind: 'loaded', run: loaded }); },
    finish,
    order(o) {
      if (!loaded) return 'Load a range first.';
      if (st.done) return 'The run has finished — restart to trade it again.';
      if (st.i < 0) return 'Step one bar first: an order placed now would fill at a price you have not seen.';
      const order: BtOrder = { id: d.id(), type: o.type, side: o.side, qty: o.qty, placedAt: st.i, ...(o.px ? { px: o.px } : {}) };
      const r = submit(st, order, loaded.bars[st.i]);
      if (r.error) { emit({ kind: 'rejected', why: r.error }); return r.error; }
      st = r.state; emit({ kind: 'bar', state: st });
      return null;
    },
    cancel(id) { st = cancelOrder(st, id); emit({ kind: 'bar', state: st }); },
    metrics: () => metrics(st, bars(), loaded ? loaded.interval : '1h'),
    verdict: () => verdict(metrics(st, bars(), loaded ? loaded.interval : '1h'), loaded ? loaded.label : ''),
    visible: () => (loaded ? [...loaded.context, ...loaded.bars.slice(0, Math.max(0, st.i + 1))] : []),
  };
}
