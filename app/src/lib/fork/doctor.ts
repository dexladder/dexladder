/**
 * The connection doctor: observed facts → what is wrong and what to type to fix it.
 *
 * A browser is not allowed to tell a page WHY a cross-origin request failed — refused connection,
 * a CORS header, mixed content and Chrome's private-network preflight all arrive as the same empty
 * TypeError. So the doctor never claims to know which one it was: it ranks the candidates by the
 * facts it does have (page scheme, host, what answered before) and gives the exact command for
 * each. Pure: every fact is passed in.
 */
export type Severity = 'good' | 'warn' | 'bad' | 'info';
export interface Finding { readonly severity: Severity; readonly title: string; readonly detail: string; readonly fix?: string }

export interface NodeFacts {
  readonly url: string;
  /** the page itself is on https (a fact about the browser, not the node) */
  readonly pageSecure: boolean;
  readonly loopback: boolean;
  readonly reachable: boolean;
  readonly faultMessage: string;
  readonly chainId: number | null;
  readonly client: string;
  readonly blockNumber: number | null;
  readonly accounts: readonly string[];
  /** anvil_nodeInfo / hardhat_metadata answered at all: this is a development node, whatever chain id it reports */
  readonly devNode: boolean;
  /** what that node said it forked */
  readonly forkUrl: string;
  readonly forkBlock: number | null;
  readonly isFork: boolean;
}

export const DEV_CHAINS: Readonly<Record<number, string>> = { 31337: 'Anvil / Hardhat default', 1337: 'Ganache / Hardhat legacy', 1338: 'a local dev chain' };
export const PUBLIC_CHAINS: Readonly<Record<number, string>> = {
  1: 'Ethereum mainnet', 10: 'OP Mainnet', 56: 'BNB Smart Chain', 100: 'Gnosis', 137: 'Polygon',
  8453: 'Base', 42161: 'Arbitrum One', 43114: 'Avalanche C-Chain', 11155111: 'Sepolia testnet',
  84532: 'Base Sepolia', 421614: 'Arbitrum Sepolia',
};

export const chainName = (id: number | null): string =>
  id == null ? 'unknown' : DEV_CHAINS[id] || PUBLIC_CHAINS[id] || 'chain ' + id;

/** A URL the panel refuses before it sends anything, with the reason. */
export function urlProblem(url: string): string | null {
  const u = String(url || '').trim();
  if (!u) return 'paste your node URL — Anvil prints http://127.0.0.1:8545 when it starts';
  if (!/^https?:\/\//i.test(u)) return 'the URL must start with http:// or https:// (a WebSocket ws:// endpoint is not used here)';
  if (/\s/.test(u)) return 'that URL contains a space';
  return null;
}

export const isLoopback = (url: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:\d+)?(\/|$)/i.test(String(url || '').trim());

/** Writes are allowed ONLY on a node that is both unlocked and demonstrably not a public chain. */
export function writePolicy(f: NodeFacts): { readonly ok: boolean; readonly why: string } {
  if (!f.reachable) return { ok: false, why: 'the node is not answering' };
  if (!f.accounts.length) return { ok: false, why: 'this node has no unlocked accounts, so it cannot sign anything for you — reading only' };
  if (f.chainId == null) return { ok: false, why: 'the node did not report a chain id' };
  const n = f.accounts.length + ' unlocked account' + (f.accounts.length === 1 ? '' : 's');
  if (f.isFork) return { ok: true, why: 'a fork — chain id ' + f.chainId + ' is mirrored, not the real chain — with ' + n };
  if (f.devNode) return { ok: true, why: 'a development node (it answers anvil_/hardhat_ methods no public RPC has) with ' + n };
  if (DEV_CHAINS[f.chainId]) return { ok: true, why: 'local dev chain ' + f.chainId + ' with ' + n };
  return { ok: false, why: 'chain id ' + f.chainId + ' (' + chainName(f.chainId) + ') is a public chain and this node never identified itself as a fork or a dev node — DexLadder will not send transactions to it' };
}

function unreachable(f: NodeFacts): Finding[] {
  const out: Finding[] = [{ severity: 'bad', title: 'No answer from ' + f.url, detail: f.faultMessage || 'the request failed before any reply arrived.' }];
  out.push({ severity: 'info', title: 'Is the node running, and does it allow this page?', detail: 'A browser reports a refused connection, a missing CORS header and a blocked private-network request identically, so check them in this order.', fix: 'anvil --host 127.0.0.1 --port 8545 --allow-origin "*"' });
  if (f.pageSecure && f.loopback) {
    out.push({ severity: 'warn', title: 'This page is on https and your node is on http', detail: 'Chrome and Firefox treat 127.0.0.1 as trustworthy and allow it; Safari does not, and Chrome may additionally send a private-network preflight your node has to answer.', fix: 'Open DexLadder over http://localhost (python3 -m http.server 8099), or put the node behind https, or use Chrome/Firefox.' });
  }
  if (!f.loopback) {
    out.push({ severity: 'warn', title: 'That host is not loopback', detail: 'A node on another machine must both accept your origin and be reachable from this browser.', fix: 'anvil --host 0.0.0.0 --allow-origin "' + (f.pageSecure ? 'https://dexladder.com' : '*') + '"' });
  }
  return out;
}

/** Everything the panel prints under the connection, worst first. */
export function diagnose(f: NodeFacts): Finding[] {
  const bad = urlProblem(f.url);
  if (bad) return [{ severity: 'bad', title: 'That URL cannot be used', detail: bad }];
  if (!f.reachable) return unreachable(f);
  const out: Finding[] = [];
  const dev = f.devNode || (f.chainId != null && !!DEV_CHAINS[f.chainId]);
  const pub = !f.devNode && !f.isFork && f.chainId != null && !!PUBLIC_CHAINS[f.chainId];
  out.push({ severity: 'good', title: 'Connected · ' + (f.client || 'unknown client'), detail: 'chain id ' + f.chainId + ' (' + chainName(f.chainId) + ')' + (f.blockNumber != null ? ' at block ' + f.blockNumber : '') + '.' });
  if (f.isFork) out.push({ severity: 'info', title: 'This node is a fork', detail: (f.forkUrl ? 'forked from ' + f.forkUrl : 'fork mode reported by the node') + (f.forkBlock != null ? ' at block ' + f.forkBlock : '') + '. Every contract that existed at that block exists here, and nothing you do reaches the real chain — the state is yours and it disappears when you stop the node.' });
  else if (f.devNode) out.push({ severity: 'info', title: 'Development node', detail: 'It answers anvil_/hardhat_ methods, so it is a local chain you control — not a public endpoint.' });
  else if (pub) out.push({ severity: 'bad', title: 'This looks like a real public chain', detail: chainName(f.chainId) + ' answered, and the node did not identify itself as a fork. Transactions are disabled; reading is allowed.', fix: 'anvil --fork-url <your RPC> — then the same addresses exist locally, with play money.' });
  else if (!dev) out.push({ severity: 'warn', title: 'Unrecognised chain id ' + f.chainId, detail: 'Not a known dev chain and not a known public one. Reading works; writing needs a dev chain or a node that reports fork mode.' });
  const w = writePolicy(f);
  out.push({ severity: w.ok ? 'good' : 'warn', title: w.ok ? 'Transactions enabled' : 'Read-only', detail: w.why + (w.ok ? '. DexLadder never holds a key: every transaction is signed by your node, from an account it already has unlocked.' : '.') });
  if (f.pageSecure && f.loopback) out.push({ severity: 'info', title: 'https page, http node', detail: 'It is working, so this browser allows the loopback exception — Safari would not.' });
  return out;
}
