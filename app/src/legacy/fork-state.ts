/**
 * The Local Fork sandbox's state: what the trader typed, what the node last said, and the one
 * reading the paper engine is allowed to price against.
 *
 * Settings live on the paper account (S.dlsim.fork), so they survive a reload with everything else.
 * The live reading does NOT: a pool read is a fact about a node that may not be running next time,
 * and a stale curve is worse than no curve.
 *
 * The transport is installed by the payload layer that owns the network (layers/43-fork.js). Until
 * it is, nothing here can reach anything — which is what keeps the typed core free of I/O.
 */
import type { ForkVenue } from '../lib/fork/market';
import type { ForkPool } from '../lib/fork/market';
import type { NodeStatus } from '../hooks/useForkNode';
import type { Status } from '../design/tokens';
import { legacy, type LegacyState } from './globals';

export interface ForkSettings {
  url: string; pool: string; router: string; contract: string; abi: string; bytecode: string;
  flip: boolean; route: boolean;
}

export const DEFAULT_URL = 'http://127.0.0.1:8545';

const DEFAULTS: ForkSettings = { url: DEFAULT_URL, pool: '', router: '', contract: '', abi: '', bytecode: '', flip: false, route: false };

/* eslint-disable @typescript-eslint/no-explicit-any */
const bag = (S: LegacyState | undefined): any => {
  if (!S) return null;
  const d = S.dlsim || (S.dlsim = {});
  return d.fork || (d.fork = { ...DEFAULTS });
};

export function settings(): ForkSettings {
  const b = bag(legacy.S());
  if (!b) return { ...DEFAULTS };
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof ForkSettings)[]) {
    const v = b[k];
    if (typeof DEFAULTS[k] === 'boolean') (out as any)[k] = !!v;
    else if (typeof v === 'string') (out as any)[k] = v;
  }
  return out;
}

/** Write settings through to the paper account (and its save), so a reload finds them. */
export function patch(p: Partial<ForkSettings>): void {
  const b = bag(legacy.S());
  if (!b) return;
  Object.assign(b, p);
  legacy.call('saveP');
}

// ------------------------------------------------------------------ the live reading
let status: NodeStatus | null = null;
let pool: ForkPool | null = null;
let venue: ForkVenue | null = null;
let account = '';

export const nodeStatus = (): NodeStatus | null => status;
export const forkPool = (): ForkPool | null => pool;
export const sender = (): string => account;

export function setStatus(s: NodeStatus | null): void {
  status = s;
  account = (s && s.facts.accounts[0]) || '';
  if (!s || !s.facts.reachable) { pool = null; venue = null; }
}

export function setPool(p: ForkPool | null, v: ForkVenue | null): void { pool = p; venue = v; }

/**
 * The pool the ticket is routed to — or null. Read on EVERY preview and fill (realismOf), so it
 * stays a field lookup: routing off, no node, or no pool all mean "price normally".
 */
export function routedVenue(): ForkVenue | null {
  if (!venue || !settings().route) return null;
  return venue;
}

/** The node's own gas price (gwei), for the gas model — 0 when it is not routed or not known. */
export function forkGwei(): number {
  return routedVenue() && status && status.gwei > 0 ? status.gwei : 0;
}

// ------------------------------------------------------------------ the log
export interface ForkLine { readonly at: string; readonly text: string; readonly status: Status }
const LINES: ForkLine[] = [];
const KEEP = 60;

export function log(text: string, s: Status = 'neutral', at = ''): void {
  LINES.unshift({ at, text, status: s });
  if (LINES.length > KEEP) LINES.length = KEEP;
}
export const lines = (): readonly ForkLine[] => LINES;
export function clearLog(): void { LINES.length = 0; }

// ------------------------------------------------------------------ the transport
export type Post = (url: string, body: string) => Promise<string>;
let post: Post | null = null;

/** Called once by layers/43-fork.js. The typed core never performs I/O itself. */
export function install(p: Post): void { if (!post) post = p; }
export const installed = (): boolean => !!post;

export function sendTo(url: string): (body: string) => Promise<string> {
  return (body: string) => {
    if (!post) return Promise.reject(new Error('the fork sandbox has no transport installed'));
    return post(url, body);
  };
}
