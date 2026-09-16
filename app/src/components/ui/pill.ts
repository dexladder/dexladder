import { h } from './h';
import { CX } from '../../design/classes';
import type { Status } from '../../design/tokens';

export interface PillProps { readonly status: Status; readonly text: string; readonly title?: string }

/** A status pill: good / bad / warn / info / neutral, coloured only through the STATUS table. */
export function Pill(p: PillProps): HTMLElement {
  return h('span', { class: [CX.pill, CX[p.status]], role: 'status', ...(p.title ? { title: p.title } : {}) }, p.text);
}
