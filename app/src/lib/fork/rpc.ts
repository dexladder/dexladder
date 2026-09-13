/**
 * JSON-RPC, as data. This module builds request objects and reads responses; it performs no I/O —
 * the transport is injected by the layer that owns the network (the typed core stays free of it,
 * which is also what keeps "all data stays on device" true: the only host ever contacted is the
 * one the user typed).
 */
export interface RpcRequest { readonly jsonrpc: '2.0'; readonly id: number; readonly method: string; readonly params: readonly unknown[] }

export type FaultKind = 'rpc' | 'malformed' | 'transport' | 'timeout' | 'http';
export interface RpcFault {
  readonly kind: FaultKind;
  readonly message: string;
  readonly code?: number;
  /** revert payload, when the node returned one */
  readonly data?: string;
}
export type RpcOutcome = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly fault: RpcFault };

export const request = (id: number, method: string, params: readonly unknown[] = []): RpcRequest => ({ jsonrpc: '2.0', id, method, params });
export const bodyOf = (reqs: RpcRequest | readonly RpcRequest[]): string => JSON.stringify(reqs);

/* eslint-disable @typescript-eslint/no-explicit-any */
function readEnvelope(o: any): RpcOutcome {
  if (!o || typeof o !== 'object') return { ok: false, fault: { kind: 'malformed', message: 'the node did not answer with a JSON-RPC object' } };
  if (o.error) {
    const e = o.error;
    const raw = e.data && typeof e.data === 'object' ? (e.data.data || e.data.originalError && e.data.originalError.data) : e.data;
    return { ok: false, fault: { kind: 'rpc', message: String(e.message || 'the node returned an error'), ...(typeof e.code === 'number' ? { code: e.code } : {}), ...(typeof raw === 'string' && /^0x/.test(raw) ? { data: raw } : {}) } };
  }
  if (!('result' in o)) return { ok: false, fault: { kind: 'malformed', message: 'the answer had neither a result nor an error' } };
  return { ok: true, result: o.result };
}

export function parseResponse(text: string): RpcOutcome {
  let json: any;
  try { json = JSON.parse(text); } catch (e) { return { ok: false, fault: { kind: 'malformed', message: 'the answer was not JSON (' + String(text || '').slice(0, 80) + ')' } }; }
  return readEnvelope(Array.isArray(json) ? json[0] : json);
}

/** A batch answer, put back in the order the requests were sent (nodes may reorder). */
export function parseBatch(text: string, ids: readonly number[]): RpcOutcome[] {
  let json: any;
  try { json = JSON.parse(text); } catch (e) { return ids.map(() => ({ ok: false as const, fault: { kind: 'malformed' as const, message: 'the batch answer was not JSON' } })); }
  if (!Array.isArray(json)) { const one = readEnvelope(json); return ids.map(() => one); }
  return ids.map(id => {
    const hit = json.find((o: any) => o && o.id === id);
    return hit ? readEnvelope(hit) : { ok: false as const, fault: { kind: 'malformed' as const, message: 'the batch answer is missing id ' + id } };
  });
}

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One line for the log: what went wrong, with the node's own code when it gave one. */
export const faultText = (f: RpcFault): string => f.message + (f.code != null ? ' (code ' + f.code + ')' : '');
