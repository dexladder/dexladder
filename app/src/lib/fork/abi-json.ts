/**
 * Whatever the developer pasted → one typed ABI set.
 *
 * Accepts a JSON ABI array, a Hardhat/Foundry artifact (`{ "abi": [ … ] }` — what `artifacts/` and
 * `out/` actually contain, so it can be pasted straight from the build directory), or one
 * human-readable signature per line. Custom `error` entries are kept, so a revert from their
 * contract can be decoded by name instead of shown as raw bytes.
 */
import { AbiError, parseEvent, parseFunction, selectorOf, signatureOf, canonicalType, type AbiEvent, type AbiFn, type AbiParam, type Mutability } from './abi-sig';

export interface AbiCustomError { readonly kind: 'error'; readonly name: string; readonly inputs: readonly AbiParam[]; readonly signature: string; readonly selector: string }
export interface AbiSet {
  readonly functions: readonly AbiFn[];
  readonly events: readonly AbiEvent[];
  readonly errors: readonly AbiCustomError[];
  readonly source: 'json' | 'lines';
  /** entries that could not be read, with the reason — shown, never swallowed */
  readonly skipped: readonly string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const params = (list: any): AbiParam[] => (Array.isArray(list) ? list : []).map((p: any) => {
  if (p && Array.isArray(p.components)) throw new AbiError('tuple and struct parameters are not supported in the sandbox console yet: ' + (p.name || p.type));
  return { type: canonicalType(String((p && p.type) || '')), name: String((p && p.name) || '') };
});

function fromJson(entries: any[]): AbiSet {
  const functions: AbiFn[] = [], events: AbiEvent[] = [], errors: AbiCustomError[] = [], skipped: string[] = [];
  for (const e of entries) {
    const type = String((e && e.type) || 'function');
    const name = String((e && e.name) || '');
    try {
      if (type === 'function' && name) {
        const inputs = params(e.inputs), signature = signatureOf(name, inputs);
        const mut = String(e.stateMutability || (e.constant ? 'view' : 'nonpayable')) as Mutability;
        functions.push({ kind: 'function', name, inputs, outputs: params(e.outputs), mutability: mut === 'view' || mut === 'pure' || mut === 'payable' ? mut : 'nonpayable', signature, selector: selectorOf(signature) });
      } else if (type === 'event' && name) {
        const inputs = params(e.inputs), signature = signatureOf(name, inputs);
        events.push({ ...parseEvent(signature), indexed: (Array.isArray(e.inputs) ? e.inputs : []).map((p: any) => !!(p && p.indexed)), inputs, signature });
      } else if (type === 'error' && name) {
        const inputs = params(e.inputs), signature = signatureOf(name, inputs);
        errors.push({ kind: 'error', name, inputs, signature, selector: selectorOf(signature) });
      }
    } catch (err) { skipped.push(name + ': ' + (err instanceof Error ? err.message : String(err))); }
  }
  return { functions, events, errors, source: 'json', skipped };
}

function fromLines(text: string): AbiSet {
  const functions: AbiFn[] = [], events: AbiEvent[] = [], errors: AbiCustomError[] = [], skipped: string[] = [];
  for (const raw of text.split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    try {
      if (/^event\b/.test(line)) events.push(parseEvent(line));
      else if (/^error\b/.test(line)) {
        const f = parseFunction(line.replace(/^error\s+/, ''));
        errors.push({ kind: 'error', name: f.name, inputs: f.inputs, signature: f.signature, selector: f.selector });
      } else functions.push(parseFunction(line));
    } catch (err) { skipped.push(line + ' → ' + (err instanceof Error ? err.message : String(err))); }
  }
  return { functions, events, errors, source: 'lines', skipped };
}

/** Parse an ABI. Throws only when nothing at all could be read. */
export function parseAbi(text: string): AbiSet {
  const src = String(text || '').trim();
  if (!src) throw new AbiError('paste an ABI (JSON array, a Hardhat/Foundry artifact, or one signature per line)');
  let set: AbiSet | null = null;
  if (src.startsWith('[') || src.startsWith('{')) {
    let json: any;
    try { json = JSON.parse(src); } catch (e) { throw new AbiError('that looks like JSON but does not parse: ' + (e instanceof Error ? e.message : String(e))); }
    const entries = Array.isArray(json) ? json : Array.isArray(json && json.abi) ? json.abi : null;
    if (!entries) throw new AbiError('JSON with no ABI array in it (an artifact needs an "abi" key)');
    set = fromJson(entries);
  } else set = fromLines(src);
  if (!set.functions.length && !set.events.length && !set.errors.length) {
    throw new AbiError('no function, event or error could be read from that ABI' + (set.skipped.length ? ' — ' + set.skipped[0] : ''));
  }
  return set;
}
