import { h } from '../ui/h';
import { CX } from '../../design/classes';
import type { Status } from '../../design/tokens';

/** One line of the sandbox's own log: what was sent, what came back, what it cost. */
export interface LogLine { readonly at: string; readonly text: string; readonly status: Status }

export function LogList(lines: readonly LogLine[]): HTMLElement {
  return h('div', { class: [CX.forkLog], role: 'log', aria: { label: 'Fork sandbox log', live: 'polite' } },
    ...(lines.length ? lines : [{ at: '', text: 'Nothing sent yet. Connect a node, load a pool, and every call and transaction shows up here.', status: 'neutral' as Status }])
      .map(l => h('div', { class: [CX.forkLogRow, CX[l.status]] },
        h('span', { class: [CX.forkLogWhen] }, l.at || '—'),
        h('span', {}, l.text))));
}
