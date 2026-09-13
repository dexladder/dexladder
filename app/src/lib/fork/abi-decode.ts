/**
 * ABI decoding: return values, event payloads and revert data.
 *
 * The revert path matters as much as the happy one — a sandbox whose failures read
 * `0x08c379a0…` teaches nothing. `require(x, "reason")`, `assert`/overflow panics and the
 * contract's own custom errors all come back as a sentence.
 */
import { AbiError, type AbiEvent, type AbiParam } from './abi-sig';
import type { AbiCustomError } from './abi-json';
import { bytesToHex, bytesToUtf8, hexToBytes, strip } from './hex';
import { EIGHT, ZERO, pow2 } from './bi';

export type Decoded = bigint | string | boolean | Uint8Array | Decoded[];

const arrayOf = (type: string): { inner: string; len: number | null } | null => {
  const m = type.match(/^(.*)\[(\d*)\]$/);
  return m ? { inner: m[1] || '', len: m[2] ? parseInt(m[2], 10) : null } : null;
};

const dynamic = (type: string): boolean => {
  if (type === 'bytes' || type === 'string') return true;
  const a = arrayOf(type);
  return a ? a.len === null || dynamic(a.inner) : false;
};

const headSize = (type: string): number => {
  const a = arrayOf(type);
  return dynamic(type) ? 32 : a && a.len !== null ? a.len * headSize(a.inner) : 32;
};

function uintAt(d: Uint8Array, at: number): bigint {
  if (at + 32 > d.length) throw new AbiError('the returned data is shorter than its own type says (truncated response)');
  let x = ZERO;
  for (let i = 0; i < 32; i++) x = (x << EIGHT) | BigInt(d[at + i] as number);
  return x;
}

function decodeOne(type: string, d: Uint8Array, base: number, at: number): Decoded {
  const arr = arrayOf(type);
  if (arr) {
    if (arr.len === null) {
      const p = base + Number(uintAt(d, at)), n = Number(uintAt(d, p));
      return decodeTuple(new Array(n).fill(arr.inner), d, p + 32);
    }
    const p = dynamic(type) ? base + Number(uintAt(d, at)) : at;
    return decodeTuple(new Array(arr.len).fill(arr.inner), d, p);
  }
  if (type === 'bytes' || type === 'string') {
    const p = base + Number(uintAt(d, at)), n = Number(uintAt(d, p));
    const body = d.slice(p + 32, p + 32 + n);
    return type === 'string' ? bytesToUtf8(body) : body;
  }
  if (type === 'address') return '0x' + bytesToHex(d.slice(at + 12, at + 32), false);
  if (type === 'bool') return uintAt(d, at) !== ZERO;
  const fixed = type.match(/^bytes(\d+)$/);
  if (fixed) return d.slice(at, at + parseInt(fixed[1] || '0', 10));
  const num = type.match(/^(u?)int(\d+)$/);
  if (num) {
    const x = uintAt(d, at);
    if (num[1] === 'u') return x;
    const bits = parseInt(num[2] || '256', 10);
    return x >= pow2(bits - 1) ? x - pow2(bits) : x;
  }
  throw new AbiError('cannot decode type ' + type);
}

export function decodeTuple(types: readonly string[], d: Uint8Array, base = 0): Decoded[] {
  const out: Decoded[] = [];
  let at = base;
  for (const t of types) { out.push(decodeOne(t, d, base, at)); at += headSize(t); }
  return out;
}

export function decodeParams(types: readonly string[], hex: string): Decoded[] {
  return decodeTuple(types, hexToBytes(hex));
}

/** One value as the panel prints it: numbers plain, bytes as hex, arrays bracketed. */
export function formatDecoded(v: Decoded): string {
  if (Array.isArray(v)) return '[' + v.map(formatDecoded).join(', ') + ']';
  if (v instanceof Uint8Array) return bytesToHex(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

const PANIC: Readonly<Record<string, string>> = {
  '0x00': 'generic compiler panic',
  '0x01': 'assert(false)',
  '0x11': 'arithmetic overflow or underflow',
  '0x12': 'division or modulo by zero',
  '0x21': 'an invalid value was converted to an enum',
  '0x22': 'an incorrectly encoded storage byte array was accessed',
  '0x31': '.pop() on an empty array',
  '0x32': 'array index out of bounds',
  '0x41': 'out of memory (an allocation too large)',
  '0x51': 'a zero-initialised internal function was called',
};

export type Revert =
  | { readonly kind: 'none' }
  | { readonly kind: 'reason'; readonly text: string }
  | { readonly kind: 'panic'; readonly text: string; readonly code: string }
  | { readonly kind: 'custom'; readonly text: string; readonly name: string; readonly args: readonly Decoded[] }
  | { readonly kind: 'raw'; readonly text: string; readonly data: string };

/** Revert data → what actually went wrong, in words. `errors` lets the contract's own errors speak. */
export function decodeRevert(data: string, errors: readonly AbiCustomError[] = []): Revert {
  const hex = strip(data || '');
  if (!hex) return { kind: 'none' };
  const sel = '0x' + hex.slice(0, 8), body = hexToBytes('0x' + hex.slice(8));
  try {
    if (sel === '0x08c379a0') return { kind: 'reason', text: String(decodeTuple(['string'], body)[0]) };
    if (sel === '0x4e487b71') {
      const code = '0x' + (decodeTuple(['uint256'], body)[0] as bigint).toString(16).padStart(2, '0');
      return { kind: 'panic', code, text: 'Solidity panic ' + code + ' — ' + (PANIC[code] || 'see the panic code table') };
    }
    const custom = errors.find(e => e.selector === sel);
    if (custom) {
      const args = decodeTuple(custom.inputs.map(i => i.type), body);
      return { kind: 'custom', name: custom.name, args, text: custom.name + '(' + args.map(formatDecoded).join(', ') + ')' };
    }
  } catch (e) { /* fall through to raw: better honest bytes than a wrong sentence */ }
  return { kind: 'raw', text: 'the contract reverted with data this ABI cannot name (' + sel + ')', data: '0x' + hex };
}

/** An event log → named values. Indexed parameters come from the topics, the rest from the data. */
export function decodeLog(ev: AbiEvent, topics: readonly string[], data: string): Record<string, string> {
  const out: Record<string, string> = {};
  const named = (p: AbiParam, i: number): string => p.name || 'arg' + i;
  const plain = ev.inputs.filter((_, i) => !ev.indexed[i]);
  let values: Decoded[] = [];
  try { values = decodeTuple(plain.map(p => p.type), hexToBytes(data || '0x')); } catch (e) { values = []; }
  let ti = 1, pi = 0;
  ev.inputs.forEach((p, i) => {
    if (ev.indexed[i]) {
      const topic = topics[ti++] || '';
      let v: Decoded = topic;
      try { if (topic) v = decodeTuple([p.type], hexToBytes(topic))[0] as Decoded; } catch (e) { v = topic; }
      out[named(p, i)] = formatDecoded(v);
    } else out[named(p, i)] = pi < values.length ? formatDecoded(values[pi++] as Decoded) : '?';
  });
  return out;
}
