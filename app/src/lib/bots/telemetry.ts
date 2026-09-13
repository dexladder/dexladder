/**
 * Connection telemetry for a "bring your own bot" endpoint. A browser tells you almost nothing
 * about why a cross-origin call failed — every refusal, every missing CORS header and every wrong
 * port arrives as one empty TypeError — so the only honest way to say whether someone's bot is
 * healthy is to keep the calls themselves and show the shape of them.
 *
 * A ring of the last 100 polls, not a running average: an average hides the thing that matters,
 * which is that the last four calls in a row failed while the first ninety-six were fine. The ring
 * is bounded because this lives in localStorage next to the user's trades — an unbounded poll log
 * on a 1m bot is a megabyte a day.
 *
 * Pure and immutable: push returns a new ring, the clock arrives inside the sample, and nothing
 * here fetches anything. The layer owns the fetch; this owns what it meant.
 */

/** how many polls the ring remembers — about 33 minutes of a 20 s loop, or 100 bars of a 1m bot */
export const RING_CAP = 100;

/** characters of the last request and last response kept for the payload inspector */
export const BODY_CAP = 4000;

/** what a failure was, when there was no HTTP status to report */
export type FaultClass = 'network' | 'timeout' | 'cors' | 'parse' | 'aborted';

/** an HTTP status when the browser got one, a named fault when it did not */
export type PollStatus = number | FaultClass;

export interface Sample {
  readonly t: number;
  /** round-trip in ms, measured by the caller around its own fetch */
  readonly ms: number;
  readonly ok: boolean;
  readonly status: PollStatus;
  /** bytes sent (the query string is the request) and bytes read back */
  readonly reqBytes: number;
  readonly resBytes: number;
}

/** raw text of one side of the last exchange, kept for the inspector */
export interface Payload {
  readonly t: number;
  /** the kept text, with the truncation notice inside it when there was one */
  readonly text: string;
  /** characters in the original, before anything was cut */
  readonly chars: number;
  readonly truncated: boolean;
}

export interface Exchange {
  readonly request: string;
  readonly response: string;
}

export interface Ring {
  readonly samples: readonly Sample[];
  /** every poll ever made, so the desk can say "the last 100 of 4,312" and not imply that is all */
  readonly seen: number;
  /** consecutive failures ending at the newest sample */
  readonly streak: number;
  /**
   * the longest failure streak seen. Kept on the ring rather than recomputed from the window,
   * because a bot that died for twenty minutes two hours ago must not look healthy just because
   * those samples have since been evicted.
   */
  readonly worst: number;
  readonly lastRequest: Payload | null;
  readonly lastResponse: Payload | null;
}

export const emptyRing = (): Ring => ({ samples: [], seen: 0, streak: 0, worst: 0, lastRequest: null, lastResponse: null });

/** the notice a truncated payload carries; the inspector must never cut text without saying so */
export const TRUNCATED = '… truncated —';

function snip(text: string, t: number): Payload {
  const chars = text.length;
  if (chars <= BODY_CAP) return { t, text, chars, truncated: false };
  return {
    t, chars, truncated: true,
    text: text.slice(0, BODY_CAP) + '\n' + TRUNCATED + ' showing the first ' + BODY_CAP.toLocaleString('en-US') + ' of ' + chars.toLocaleString('en-US') + ' characters. Your endpoint is answering with more than a decision; DexLadder reads only action, size and reason.',
  };
}

/**
 * Record one poll. `raw` is the request and the response as text — pass it on every poll you can
 * afford to; the ring keeps only the newest of each, so this costs a bounded amount however long
 * a bot runs.
 */
export function push(ring: Ring, s: Sample, raw?: Exchange): Ring {
  const samples = [...ring.samples, s];
  const streak = s.ok ? 0 : ring.streak + 1;
  return {
    samples: samples.length > RING_CAP ? samples.slice(samples.length - RING_CAP) : samples,
    seen: ring.seen + 1,
    streak,
    worst: Math.max(ring.worst, streak),
    lastRequest: raw ? snip(raw.request, s.t) : ring.lastRequest,
    lastResponse: raw ? snip(raw.response, s.t) : ring.lastResponse,
  };
}

/**
 * Nearest-rank percentile: the returned number is a latency the endpoint actually printed, never
 * an average of two neighbours. A made-up p95 between two real samples would be the one figure on
 * this panel nobody could reproduce from the poll list next to it.
 */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] as number;
}

export interface Vitals {
  /** polls in the window (≤ RING_CAP) and polls ever made */
  readonly polls: number;
  readonly seen: number;
  readonly ok: number;
  readonly failed: number;
  readonly successPct: number;
  readonly p50: number;
  readonly p95: number;
  readonly streak: number;
  readonly worst: number;
  readonly last: PollStatus | null;
  /** healthy enough to keep trading on */
  readonly healthy: boolean;
  /** one line, the way the desk speaks: what is happening, then the number that proves it */
  readonly verdict: string;
}

const statusText = (s: PollStatus): string => (typeof s === 'number' ? 'HTTP ' + s : s === 'timeout' ? 'no answer in time' : s === 'cors' ? 'no CORS header' : s === 'parse' ? 'an answer that was not a decision' : s === 'aborted' ? 'an aborted call' : 'an unreachable endpoint');

export function vitals(ring: Ring): Vitals {
  const n = ring.samples.length;
  const okCount = ring.samples.reduce((k, s) => k + (s.ok ? 1 : 0), 0);
  const failed = n - okCount;
  const successPct = n ? (okCount / n) * 100 : 0;
  const p50 = percentile(ring.samples.map(s => s.ms), 50);
  const p95 = percentile(ring.samples.map(s => s.ms), 95);
  const newest = n ? (ring.samples[n - 1] as Sample) : null;
  const healthy = n > 0 && ring.streak === 0 && successPct >= 90;
  return {
    polls: n, seen: ring.seen, ok: okCount, failed, successPct, p50, p95,
    streak: ring.streak, worst: ring.worst, last: newest ? newest.status : null, healthy,
    verdict: verdictOf(n, okCount, failed, successPct, p50, p95, ring, newest),
  };
}

function verdictOf(n: number, okCount: number, failed: number, successPct: number, p50: number, p95: number, ring: Ring, newest: Sample | null): string {
  if (!n || !newest) return 'Not called yet — this bot has not polled your endpoint, so there is nothing to judge.';
  const windowText = ring.seen > n ? 'the last ' + n + ' of ' + ring.seen.toLocaleString('en-US') + ' polls' : n + ' poll' + (n === 1 ? '' : 's');
  if (ring.streak >= 3) return 'Down — the last ' + ring.streak + ' polls failed with ' + statusText(newest.status) + '. The bot is deciding nothing until your endpoint answers again.';
  if (ring.streak > 0) return 'Failing — the last ' + ring.streak + ' poll' + (ring.streak === 1 ? '' : 's') + ' failed with ' + statusText(newest.status) + ', after ' + okCount + ' good one(s) in ' + windowText + '.';
  if (successPct < 90) return 'Flaky — ' + failed + ' of ' + windowText + ' failed (' + successPct.toFixed(0) + '% good). It is answering now, typically in ' + Math.round(p50) + ' ms.';
  if (p95 > 2000) return 'Answering, slowly — ' + successPct.toFixed(0) + '% of ' + windowText + ' good, typically ' + Math.round(p50) + ' ms but one in twenty takes ' + Math.round(p95) + ' ms. A poll that overruns the bar budget is a bar the bot sits out.';
  return 'Answering — ' + successPct.toFixed(0) + '% of ' + windowText + ' good, typically ' + Math.round(p50) + ' ms (p95 ' + Math.round(p95) + ' ms).';
}
