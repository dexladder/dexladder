/**
 * Test-only access to the ORIGINAL legacy code, so parity tests compare the new pure modules
 * against what actually shipped rather than against a remembered value.
 *
 * Source: web/src/index.v153.html — the canonical input the payload build sha-asserts, never
 * edited by any build step. Functions are cut out by name with a brace matcher (the file is
 * minified) and evaluated in an isolated vm context with only the globals they need.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const WEB = join(process.cwd(), '..');
const V153_SHA = 'ccbeddf6f664da8a8e36b1358ce89a93a33cf8e5a757ae78ce7b872c1e3a0b02';

let cached: string | null = null;
export function v153(): string {
  if (cached) return cached;
  const s = readFileSync(join(WEB, 'src', 'index.v153.html'), 'utf8');
  const sha = createHash('sha256').update(s, 'utf8').digest('hex');
  if (sha !== V153_SHA) throw new Error('src/index.v153.html is not the canonical v153 payload');
  return (cached = s);
}

/** Cut `function name(...){...}` (or any text starting at `start`) out of the payload by brace matching. */
export function cut(start: string, from = v153()): string {
  const i = from.indexOf(start);
  if (i < 0) throw new Error('legacy anchor not found: ' + start);
  if (from.indexOf(start, i + 1) >= 0) throw new Error('legacy anchor not unique: ' + start);
  let j = from.indexOf('{', i), d = 0, q: string | null = null;
  for (let k = j; k < from.length; k++) {
    const ch = from[k]!;
    if (q) { if (ch === '\\') { k++; continue; } if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}' && --d === 0) return from.slice(i, k + 1);
  }
  throw new Error('unbalanced legacy function: ' + start);
}

/** Evaluate legacy source in a fresh context; returns the context so tests can read its globals. */
export function load(src: string, globals: Record<string, unknown> = {}): Record<string, any> {
  const ctx = vm.createContext({ Math, Date, Object, Array, JSON, Number, String, isFinite, parseFloat, ...globals });
  vm.runInContext(src, ctx);
  return ctx as Record<string, any>;
}

export const legacyCore = createRequire(import.meta.url)(join(process.cwd(), 'test', 'fixtures', 'legacy-core-42c3c7c.cjs')) as {
  sma(a: number[], n: number): number | null; rsi(a: number[], n?: number): number | null;
  stdev(a: number[]): number; logRets(a: number[]): number[]; brier(p: number, hit: boolean): number;
};

/** Deterministic series generator (mulberry32) — a random walk with occasional flat runs and gaps. */
export function series(seed: number, n: number, start = 100): number[] {
  let t = seed >>> 0;
  const r = () => { t += 0x6d2b79f5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const o: number[] = []; let p = start;
  for (let i = 0; i < n; i++) { const u = r(); p = u < 0.08 ? p : p * (1 + (u - 0.5) * 0.06); o.push(+p.toFixed(6)); }
  return o;
}
