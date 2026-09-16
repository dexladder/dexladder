/**
 * useMarketData — the one read path for market figures in new code.
 *
 * It reads the canonical snapshot (DLSNAP, the only producer of whole-market figures) and never
 * fetches: orchestration (the 60 s cycle, the provider ladder, the quorum) stays in the snapshot
 * layer, which already rides the payload's single live loop. Components get fields — a value or
 * null with a reason — and a subscription; they never see a provider.
 */
import type { Field } from '../lib/snapshot/field';

export interface SnapshotSource {
  readonly current: unknown;
  get(path: string): Field;
  asset(sym: string): unknown;
  on(f: (snap: unknown) => void): void;
  off(f: (snap: unknown) => void): void;
}

export interface MarketData {
  /** A canonical figure by path, e.g. "global.mcap" or "universes.tracked.vol24". Never throws. */
  field(path: string): Field;
  /** The figure's value or null — for arithmetic; render with field() so the reason is shown. */
  value(path: string): number | null;
  /** The canonical per-asset record the snapshot resolved for `sym`, or null. */
  asset(sym: string): unknown;
  /** Called with each new frozen snapshot; returns the unsubscribe function. */
  subscribe(fn: (snap: unknown) => void): () => void;
  readonly ready: boolean;
}

export function useMarketData(src: SnapshotSource | null | undefined): MarketData {
  const empty: Field = Object.freeze({
    value: null, reason: 'loading', unit: 'USD', universe: 'global', universeLabel: 'Whole crypto market', precision: null, source: 'derived',
    observedAt: null, fetchedAt: 0, servedAt: 0, staleMs: null, freshness: 'stale', witnesses: [], quorum: 'none', dev: null, derivedFrom: null,
  }) as Field;
  return {
    field: path => { try { return src ? src.get(path) : empty; } catch { return empty; } },
    value: path => { try { const f = src ? src.get(path) : null; return f && f.value != null ? f.value : null; } catch { return null; } },
    asset: sym => { try { return src ? src.asset(sym) : null; } catch { return null; } },
    subscribe: fn => { if (!src) return () => undefined; src.on(fn); return () => src.off(fn); },
    get ready() { return !!(src && src.current); },
  };
}
