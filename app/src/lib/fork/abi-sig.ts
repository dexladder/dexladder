/**
 * Function and event signatures: parse them, canonicalise them, hash them.
 *
 * Two input forms are accepted, because those are the two forms a developer has at hand:
 *   a JSON ABI     [{"type":"function","name":"transfer","inputs":[…],"outputs":[…]}]
 *   one per line   function transfer(address to, uint256 amount) returns (bool)
 * Everything downstream sees the same typed shape. Tuples and nested structs are refused BY NAME
 * rather than mis-encoded — the sandbox says what it cannot do.
 */
import { bytesToHex, utf8ToBytes } from './hex';
import { keccak256 } from './keccak';

export type Mutability = 'view' | 'pure' | 'nonpayable' | 'payable';
export interface AbiParam { readonly name: string; readonly type: string }
export interface AbiFn {
  readonly kind: 'function';
  readonly name: string;
  readonly inputs: readonly AbiParam[];
  readonly outputs: readonly AbiParam[];
  readonly mutability: Mutability;
  /** canonical `name(type,type)` */
  readonly signature: string;
  /** 0x + 8 hex digits */
  readonly selector: string;
}
export interface AbiEvent {
  readonly kind: 'event';
  readonly name: string;
  readonly inputs: readonly AbiParam[];
  readonly indexed: readonly boolean[];
  readonly signature: string;
  /** topic0 */
  readonly topic: string;
}

export class AbiError extends Error {}

/** Split on top-level commas only (arrays and tuples keep their own). */
export function splitParams(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(x => x.length > 0);
}

/** `uint` → `uint256`, `int[2]` → `int256[2]`; a tuple is refused here, once, for every caller. */
export function canonicalType(t: string): string {
  const type = t.trim().replace(/\s+/g, ' ');
  if (/\btuple\b|^\(/.test(type)) throw new AbiError('tuple and struct parameters are not supported in the sandbox console yet: ' + type);
  const m = type.match(/^(u?int|bytes|address|bool|string)(\d*)((?:\[\d*\])*)$/);
  if (!m) throw new AbiError('unknown parameter type: ' + type);
  const base = m[1] || '', bits = m[2] || '', arr = m[3] || '';
  if (base === 'uint' || base === 'int') return base + (bits || '256') + arr;
  return base + bits + arr;
}

const param = (piece: string): AbiParam => {
  const bits = piece.trim().split(/\s+/).filter(x => x && x !== 'indexed' && x !== 'calldata' && x !== 'memory' && x !== 'payable');
  return { type: canonicalType(bits[0] || ''), name: bits.length > 1 ? (bits[bits.length - 1] as string) : '' };
};

export const signatureOf = (name: string, inputs: readonly AbiParam[]): string => name + '(' + inputs.map(i => i.type).join(',') + ')';
export const selectorOf = (signature: string): string => bytesToHex(keccak256(utf8ToBytes(signature))).slice(0, 10);
export const topicOf = (signature: string): string => bytesToHex(keccak256(utf8ToBytes(signature)));

/** `transfer(address,uint256)` or `function transfer(address to, uint256 v) returns (bool)`. */
export function parseFunction(line: string): AbiFn {
  const txt = line.trim().replace(/^function\s+/, '').replace(/;$/, '');
  const m = txt.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*([\s\S]*)$/);
  if (!m) throw new AbiError('not a function signature: ' + line);
  const name = m[1] as string, args = m[2] || '', tail = m[3] || '';
  const inputs = splitParams(args).map(param);
  const ret = tail.match(/returns?\s*\(([\s\S]*)\)/);
  const mutability: Mutability = /\bview\b/.test(tail) ? 'view' : /\bpure\b/.test(tail) ? 'pure' : /\bpayable\b/.test(tail) ? 'payable' : 'nonpayable';
  const signature = signatureOf(name, inputs);
  return { kind: 'function', name, inputs, outputs: ret ? splitParams(ret[1] || '').map(param) : [], mutability, signature, selector: selectorOf(signature) };
}

export function parseEvent(line: string): AbiEvent {
  const txt = line.trim().replace(/^event\s+/, '').replace(/;$/, '');
  const m = txt.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
  if (!m) throw new AbiError('not an event signature: ' + line);
  const name = m[1] as string, pieces = splitParams(m[2] || '');
  const inputs = pieces.map(param);
  const signature = signatureOf(name, inputs);
  return { kind: 'event', name, inputs, indexed: pieces.map(p => /\bindexed\b/.test(p)), signature, topic: topicOf(signature) };
}
