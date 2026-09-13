/**
 * Bring Your Own Bot · signal endpoint. Your bot is a process you run — Python, Node, Rust,
 * a spreadsheet macro — that answers one GET with one small JSON object. DexLadder asks once per
 * closed bar, with the market and the wallet in the query string, and fills whatever it says on
 * its own paper wallet. No key, no account: a URL, and a CORS header on your side.
 *
 * Request (GET, no custom headers — a "simple" request, so your server needs no preflight):
 *   {url}?sym=BTC&iv=1h&i=412&t=…&px=61240.5&qty=0&avg=0&cash=10000&eq=10000&last=hold&c=…,…
 *   `c` is the last 120 closes, oldest first, so a bot can decide with no feed of its own.
 * Response (JSON, with `Access-Control-Allow-Origin: *`):
 *   { "action": "buy" | "sell" | "hold", "size": 0.5, "reason": "why, in a sentence" }
 */
import { normalise } from './sandbox';
import type { Action, Signal, Wallet } from './types';

export const CLOSES_IN_QUERY = 120;

export interface SignalQuery {
  readonly sym: string; readonly interval: string; readonly i: number; readonly t: number; readonly px: number;
  readonly wallet: Wallet; readonly closes: readonly number[]; readonly last: Action | null;
}

/** The exact URL DexLadder will GET. Pure, so the desk can show it before the first call. */
export function signalUrl(base: string, q: SignalQuery): string {
  const u = base.trim();
  const sep = u.includes('?') ? '&' : '?';
  const c = q.closes.slice(-CLOSES_IN_QUERY).map(x => +x.toPrecision(8)).join(',');
  const p: [string, string][] = [
    ['sym', q.sym], ['iv', q.interval], ['i', String(q.i)], ['t', String(q.t)], ['px', String(+q.px.toPrecision(10))],
    ['qty', String(+q.wallet.qty.toPrecision(10))], ['avg', String(q.wallet.qty > 0 ? +(q.wallet.cost / q.wallet.qty).toPrecision(10) : 0)],
    ['cash', q.wallet.cash.toFixed(2)], ['eq', (q.wallet.cash + q.wallet.qty * q.px).toFixed(2)], ['last', q.last || 'none'], ['c', c],
  ];
  return u + sep + p.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/** The body your endpoint answered, as a Signal — or the reason it could not be one. */
export function parseSignal(body: string): { signal: Signal } | { error: string } {
  const text = body.trim();
  if (!text) return { error: 'the endpoint answered with an empty body' };
  if (/^<!doctype|^<html/i.test(text)) return { error: 'the endpoint answered with an HTML page, not JSON — is the URL the signal route?' };
  let v: unknown;
  try { v = JSON.parse(text); } catch {
    const bare = text.replace(/^"|"$/g, '').toLowerCase();
    if (bare === 'buy' || bare === 'sell' || bare === 'hold') return normalise(bare);
    return { error: 'the endpoint did not answer JSON: ' + text.slice(0, 60) };
  }
  return normalise(v);
}

/**
 * Why a call to a local endpoint fails, ranked. A browser reports every cross-origin failure as
 * one empty TypeError — refused connection, a missing CORS header, mixed content — so the desk
 * names the likely causes and the line that fixes each, rather than guessing out loud.
 */
export function doctor(url: string, secureOrigin: boolean, fault: string): string[] {
  const out: string[] = [];
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url.trim());
  if (/answer within/.test(fault)) return ['Your bot did not answer in time — it must reply within 8 s. Cache anything slow.'];
  if (/^\d{3}$/.test(fault)) return ['Your endpoint answered HTTP ' + fault + '. It must return 200 with a JSON body.'];
  out.push('Is your bot running? Start it, then try again — a refused connection looks like this.');
  out.push('Send the CORS header: Access-Control-Allow-Origin: * (the starter kits do). Without it the browser hides the answer.');
  if (secureOrigin && !local) out.push('This page is https:// and your URL is http:// on a remote host — the browser blocks that (mixed content). Serve https, or run the bot on 127.0.0.1 / localhost, which browsers allow.');
  if (secureOrigin && local && /^http:\/\/localhost/i.test(url)) out.push('Some browsers (Safari) refuse http://localhost from an https page — use http://127.0.0.1 instead.');
  if (!local) out.push('A remote URL must be reachable from this browser and answer with CORS enabled.');
  return out;
}
