import { h, type Child } from '../ui/h';
import { CX } from '../../design/classes';
import type { Finding, Severity } from '../../lib/fork/doctor';
import type { Status } from '../../design/tokens';

/** A dense key → value grid: what the node and the pool actually said. */
export interface Fact { readonly k: string; readonly v: Child; readonly title?: string }

export function FactGrid(facts: readonly Fact[]): HTMLElement {
  return h('div', { class: [CX.forkGrid] }, ...facts.flatMap(f => [
    h('span', { class: [CX.forkKey], ...(f.title ? { title: f.title } : {}) }, f.k),
    h('span', { class: [CX.forkVal] }, f.v),
  ]));
}

const STATUS_OF: Readonly<Record<Severity, Status>> = { good: 'good', warn: 'warn', bad: 'bad', info: 'info' };

/**
 * One diagnosis: what is true, what it means, and the command that changes it. The fix is
 * selectable in one click (user-select: all) because it is meant to be pasted into a terminal.
 */
export function FindingCard(f: Finding): HTMLElement {
  return h('div', { class: [CX.forkFind, CX[STATUS_OF[f.severity]]], role: f.severity === 'bad' ? 'alert' : 'status' },
    h('span', { class: [CX.forkFindHead] }, f.title),
    h('span', { class: [CX.forkKey] }, f.detail),
    f.fix ? h('code', { class: [CX.forkFix] }, f.fix) : null);
}

export const Findings = (list: readonly Finding[]): HTMLElement =>
  h('div', { class: [CX.forkSec] }, ...list.map(FindingCard));

/** A titled block inside the panel. */
export const Section = (title: string, right: Child, ...body: Child[]): HTMLElement =>
  h('div', { class: [CX.forkSec] }, h('div', { class: [CX.forkHead] }, h('span', {}, title), right), ...body);
