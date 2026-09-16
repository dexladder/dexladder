/**
 * The live gas signal, from a public data path the app already uses (the Ethereum JSON-RPC at
 * publicnode, through DLCORE.jget — its cache, timeout and host health), read without ever
 * blocking the ticket: signal() answers immediately from what is known and refreshes in the
 * background when the reading is older than a minute. Readings are kept on the paper account
 * (S.dlsim.gasHist, at most one per 5 minutes, last 48) so "busy" is judged against this
 * device's own recent history.
 *
 * S.dlsim.gasMode can pin the network to calm / busy / congested for practice — the Academy
 * and the gates use it; the ticket labels the signal "practice" when it is pinned.
 */
import { signal as mkSignal, FALLBACK_GWEI, median, type Congestion, type GasSignal } from '../lib/paper-engine/gas';
import { legacy, type LegacyState } from './globals';
import { forkGwei } from './fork-state';

const RPC = 'https://ethereum-rpc.publicnode.com';
const FRESH_MS = 60_000, SAMPLE_MS = 300_000, KEEP = 48;
/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;

let last: { gwei: number; at: number; cached: boolean } | null = null;
let inflight = false;

function hist(S: LegacyState | undefined): number[] {
  const d = S && S.dlsim;
  return d && Array.isArray(d.gasHist) ? d.gasHist.filter((x: unknown) => typeof x === 'number' && x > 0) : [];
}

function record(gwei: number, at: number, cached: boolean): void {
  last = { gwei, at, cached };
  const S = legacy.S();
  if (!S) return;
  const d = S.dlsim || (S.dlsim = {});
  const h: number[] = hist(S);
  if (!d.gasAt || at - d.gasAt >= SAMPLE_MS) {
    h.push(+gwei.toFixed(4)); d.gasHist = h.slice(-KEEP); d.gasAt = at; legacy.call('saveP');
  }
}

function refresh(now: number): void {
  if (inflight || (last && now - last.at < FRESH_MS)) return;
  // the Explorer page may already have read it
  if (typeof G.expGwei === 'number' && G.expGwei > 0 && !last) record(G.expGwei, now, true);
  const C = G.DLCORE;
  if (!C || typeof C.jget !== 'function') return;
  inflight = true;
  C.jget(RPC, {
    key: 'dlx.gas.eth', ttl: FRESH_MS, ms: 7000,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_gasPrice","params":[]}' },
  }).then((r: any) => {
    const wei = parseInt(r && r.data && r.data.result, 16);
    if (wei > 0) record(wei / 1e9, r.at || Date.now(), !!r.cached);
  }).catch(() => undefined).then(() => { inflight = false; });
}

const PRACTICE: Readonly<Record<Congestion, number>> = { calm: 1, busy: 1.5, congested: 3 };

/** The gas signal right now. Never waits; kicks a background refresh when stale. */
export function signal(): GasSignal & { practice: Congestion | null } {
  const now = Date.now(), S = legacy.S();
  // An order routed to the trader's own node pays THAT node's gas price — the one their fork
  // reports, not Ethereum's. It is a live reading, so it is never labelled an estimate.
  const fg = forkGwei();
  if (fg > 0) return { gwei: fg, reference: fg, at: now, source: 'node', practice: null };
  refresh(now);
  const mode = S && S.dlsim && S.dlsim.gasMode;
  const h = hist(S);
  if (mode === 'calm' || mode === 'busy' || mode === 'congested') {
    const ref = median(h) || (last && last.gwei) || FALLBACK_GWEI;
    return { gwei: ref * PRACTICE[mode as Congestion], reference: ref, at: now, source: 'estimate', practice: mode };
  }
  return { ...mkSignal(last ? last.gwei : null, h, last ? last.at : 0, last ? (last.cached ? 'cached' : 'live') : 'estimate'), practice: null };
}
