/**
 * Canonical market figures — the pure core of DLSNAP (web/layers/21-snapshot.js).
 *
 * A figure is a number or it is null WITH A REASON from a closed set; there is no path on which
 * a missing number becomes 0. Several witnesses resolve to their median, and a spread past the
 * tolerance is recorded as a disagreement instead of being hidden. Ratios are only taken inside
 * one universe from one source. A subset can never silently out-measure its superset.
 *
 * Pure: the freshness classifier (which reads a clock) and the number parser are passed in.
 */

export const QUORUM_TOLERANCE_PCT = 1.5;
export const REASONS = Object.freeze({ unavailable: 1, unsupported: 1, 'insufficient-history': 1, loading: 1, stale: 1 });
export type Reason = keyof typeof REASONS;
export const U_GLOBAL = 'Whole crypto market';
export const U_TRACKED = 'Tracked set';

export type Quorum = 'single' | 'agree' | 'disagree' | 'none';
export interface Witness { readonly source: string; readonly value: number; readonly at: number }

export interface FieldOpts {
  unit?: string; universe?: string; universeLabel?: string; precision?: number | null; source?: string;
  observedAt?: number | null; fetchedAt?: number; servedAt?: number; cycleAt?: number; stale?: boolean;
  witnesses?: Witness[]; quorum?: Quorum; dev?: number | null; derivedFrom?: string | null;
}

export interface Field {
  readonly value: number | null; readonly reason: Reason | null; readonly unit: string; readonly universe: string; readonly universeLabel: string;
  readonly precision: number | null; readonly source: string; readonly observedAt: number | null; readonly fetchedAt: number; readonly servedAt: number;
  readonly staleMs: number | null; readonly freshness: string; readonly witnesses: readonly Witness[]; readonly quorum: Quorum;
  readonly dev: number | null; readonly derivedFrom: string | null;
}

export interface FieldEnv {
  /** live / recent / stale for a served-at time (DLCORE.provClass in the app) */
  freshness(at: number, stale: boolean): string;
  /** the payload's nullable number parser (DLF.n); defaults to a strict finite check */
  num?(v: unknown): number | null;
}

const strict = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(+(v as number)) ? +(v as number) : null);

/** The ONLY constructor for a canonical figure. */
export function field(env: FieldEnv, v: unknown, reason: Reason | null | undefined, o: FieldOpts = {}): Field {
  const n = (env.num || strict)(v);
  let r: Reason | null = reason || null;
  if (n == null && !r) r = 'unavailable';
  if (n != null) r = null;
  if (r && !Object.prototype.hasOwnProperty.call(REASONS, r)) throw new Error('reason not in the closed set: ' + r);
  let fresh: string;
  try { fresh = env.freshness(o.servedAt || 0, !!o.stale); } catch { fresh = 'stale'; }
  return {
    value: n, reason: r, unit: o.unit || 'USD', universe: o.universe || 'global',
    universeLabel: o.universeLabel || (o.universe === 'tracked' ? U_TRACKED : U_GLOBAL),
    precision: o.precision == null ? null : o.precision, source: o.source || 'derived',
    observedAt: o.observedAt == null ? null : o.observedAt, fetchedAt: o.fetchedAt || 0, servedAt: o.servedAt || 0,
    staleMs: o.cycleAt && o.servedAt ? Math.max(0, o.cycleAt - o.servedAt) : null,
    freshness: fresh, witnesses: o.witnesses || [], quorum: o.quorum || 'single',
    dev: o.dev == null ? null : o.dev, derivedFrom: o.derivedFrom || null,
  };
}

/** The ONLY constructor for a witness; `positive` = a zero from the provider means "said nothing". */
export function wit(source: string, v: unknown, at?: number, positive?: boolean): Witness | null {
  if (v == null || !Number.isFinite(+(v as number))) return null;
  if (positive && +(v as number) <= 0) return null;
  return { source, value: +(v as number), at: at || 0 };
}

export interface Resolution { readonly value: number | null; readonly reason: Reason | null; readonly quorum: Quorum; readonly dev: number | null; readonly witnesses: Witness[] }

/** Median across witnesses; the largest deviation from it decides agree / disagree. */
export function resolve(list: readonly (Witness | null | undefined)[] | null | undefined): Resolution {
  const ws = (list || []).filter((w): w is Witness => !!w && w.value != null && Number.isFinite(+w.value));
  if (!ws.length) return { value: null, reason: 'unavailable', quorum: 'none', dev: null, witnesses: [] };
  const ps = ws.map(w => +w.value).slice().sort((a, b) => a - b);
  const med = ps.length % 2 ? ps[(ps.length - 1) / 2]! : (ps[ps.length / 2 - 1]! + ps[ps.length / 2]!) / 2;
  const dev = med ? Math.max(...ps.map(p => (Math.abs(p - med) / med) * 100)) : 0;
  return {
    value: med, reason: null, quorum: ws.length === 1 ? 'single' : dev > QUORUM_TOLERANCE_PCT ? 'disagree' : 'agree', dev,
    witnesses: ws.map(w => ({ source: w.source, value: +w.value, at: w.at || 0 })),
  };
}

/** num / den × 100 — only when both come from the same universe AND the same source. */
export function dominance(env: FieldEnv, numF: Field | null | undefined, denF: Field | null | undefined, o: { universe?: string; cycleAt?: number } = {}): Field {
  if (!numF || !denF) return field(env, null, 'unavailable', o);
  if (numF.universe !== denF.universe || numF.source !== denF.source) return field(env, null, 'unsupported', { universe: o.universe || denF.universe, source: denF.source });
  if (numF.value == null || denF.value == null || !denF.value) return field(env, null, numF.reason || denF.reason || 'unavailable', { universe: denF.universe, source: denF.source, unit: '%' });
  return field(env, (numF.value / denF.value) * 100, null, {
    unit: '%', precision: 1, universe: denF.universe, source: denF.source,
    observedAt: denF.observedAt, fetchedAt: denF.fetchedAt, servedAt: denF.servedAt,
    ...(o.cycleAt != null ? { cycleAt: o.cycleAt } : {}), stale: denF.freshness === 'stale',
    derivedFrom: 'ratio of two fields in the ' + denF.universe + ' universe',
  });
}

export type Containment = { readonly state: 'undecidable' | 'ok' | 'within-witness-range' | 'impossible'; readonly note: string | null };

/** A tracked subset larger than its whole-market superset: say which figure is in doubt. */
export function subsetCheck(sub: Field | null | undefined, sup: Field | null | undefined, what: string, usd: (v: number) => string): Containment {
  if (!sub || !sup || sub.value == null || sup.value == null) return { state: 'undecidable', note: null };
  if (sub.value <= sup.value) return { state: 'ok', note: null };
  const ws = (sup.witnesses || []).map(x => +x.value);
  const hi = ws.length ? Math.max(...ws) : sup.value;
  if (ws.length > 1 && sub.value <= hi) return {
    state: 'within-witness-range',
    note: 'The tracked-set ' + what + ' is larger than the whole-market MEDIAN because the two ' +
      'whole-market witnesses disagree (' + sup.witnesses.map(x => x.source + ' ' + usd(x.value)).join(' vs ') +
      '). The tracked sum lies inside their range, so the pair is not a contradiction — the whole-market ' +
      'figure is the one in doubt, not this one.',
  };
  return {
    state: 'impossible',
    note: 'The tracked-set ' + what + ' is larger than every whole-market witness. A subset cannot exceed ' +
      'its superset, so at least one of the two is wrong; neither should be read as exact.',
  };
}

export function contested(f: Field | null | undefined): boolean {
  return !!(f && f.quorum === 'disagree' && f.witnesses && f.witnesses.length > 1);
}
