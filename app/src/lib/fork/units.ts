/**
 * Token amounts. A token has `decimals` and a balance in base units, and the conversion is done
 * with integers throughout — a float round-trip on an 18-decimal balance loses the tail, and the
 * tail is exactly what a swap's output is measured in.
 */
import { pow10 } from './bi';

export class UnitError extends Error {}

/** "1.25" @ 6 decimals → 1250000n. Rejects anything that is not a plain decimal number. */
export function parseUnits(value: string, decimals: number): bigint {
  const s = String(value == null ? '' : value).trim().replace(/[_,\s]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new UnitError('"' + value + '" is not an amount');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new UnitError('that amount has more than ' + decimals + ' decimal places');
  return BigInt((whole || '0') + frac.padEnd(decimals, '0'));
}

/** 1250000n @ 6 decimals → "1.25" (trailing zeros trimmed, never exponential). */
export function formatUnits(value: bigint, decimals: number, maxFrac = decimals): string {
  const neg = value < BigInt(0), x = neg ? -value : value, base = pow10(decimals);
  const whole = (x / base).toString();
  let frac = (x % base).toString().padStart(decimals, '0').slice(0, Math.max(0, maxFrac)).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

/** For the curve math, which works in floats: exact enough because it is a price, not a balance. */
export function toFloat(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

/** A figure for a dense table: 4 significant decimals for small numbers, thousands separated. */
export function compact(value: bigint, decimals: number): string {
  const n = toFloat(value, decimals);
  if (!Number.isFinite(n)) return formatUnits(value, decimals, 6);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const frac = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: frac });
}
