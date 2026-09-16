import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Badge } from '../ui/badge';
import type { Verdict } from '../../lib/backtest';

export interface BtVerdictProps { readonly verdict: Verdict; readonly done: boolean }

/** Why the run came out the way it did — buy-and-hold first, then the uncomfortable parts. */
export function BtVerdict(p: BtVerdictProps): HTMLElement {
  return h('div', { class: [CX.verdict], id: 'btVerdict', role: 'group', aria: { label: 'Run verdict' } },
    h('div', { class: [CX.previewHead] }, h('span', {}, p.done ? 'Run finished · ' + p.verdict.headline : 'So far · ' + p.verdict.headline),
      Badge(p.done ? 'Measured flat' : 'Live', p.done ? 'info' : 'neutral')),
    ...p.verdict.lines.map(l => h('div', { class: [CX.verdictRow, CX[l.status]] }, h('b', {}, l.label), h('span', {}, l.text))));
}
