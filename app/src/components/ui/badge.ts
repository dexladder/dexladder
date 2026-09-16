import { h } from './h';
import { CX } from '../../design/classes';
import type { Status } from '../../design/tokens';

/** A compact uppercase tag (SIM, LIVE, PRO …). */
export function Badge(text: string, status: Status = 'neutral'): HTMLElement {
  return h('span', { class: [CX.badge, CX[status]] }, text);
}
