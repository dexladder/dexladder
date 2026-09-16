import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Select, TextField, Button } from '../ui/fields';
import { INDICATORS, meta, param } from '../../lib/bots/indicators';
import { comparatorLabel } from '../../lib/bots/rules';
import type { Comparator, Condition, IndicatorId, Operand } from '../../lib/bots/types';

export interface RuleRowProps {
  readonly id: string;
  readonly c: Condition;
  readonly index: number;
  onChange(c: Condition): void;
  onRemove(): void;
}

const COMPARATORS: readonly Comparator[] = ['>', '<', '>=', '<=', 'crossAbove', 'crossBelow'];
const OPTS = INDICATORS.map(m => ({ value: m.id, label: m.label }));

const withId = (o: Operand, id: string): Operand => {
  if (id === '__const') return { kind: 'const', value: o.kind === 'const' ? o.value : 0 };
  const m = meta(id as IndicatorId);
  return { kind: 'ind', id: m.id, ...(m.defaults[0] != null ? { p1: m.defaults[0] } : {}), ...(m.defaults[1] != null ? { p2: m.defaults[1] } : {}) };
};

/** One side of a comparison: an indicator with its parameters, or a plain number. */
function side(idBase: string, o: Operand, onChange: (o: Operand) => void, allowConst: boolean): HTMLElement {
  const kids: HTMLElement[] = [
    Select({ id: idBase + 'Ind', label: 'Value', value: o.kind === 'const' ? '__const' : o.id, onChange: v => onChange(withId(o, v)),
      options: [...OPTS, ...(allowConst ? [{ value: '__const', label: 'a number' }] : [])] }),
  ];
  if (o.kind === 'const') {
    kids.push(TextField({ id: idBase + 'Val', label: 'Number', value: String(o.value), onInput: v => onChange({ kind: 'const', value: Number(v) || 0 }) }));
  } else {
    const m = meta(o.id);
    m.params.forEach((name, i) => {
      kids.push(TextField({ id: idBase + 'P' + i, label: name, value: String(param(o, i as 0 | 1)),
        onInput: v => onChange({ ...o, ...(i === 0 ? { p1: Number(v) || 0 } : { p2: Number(v) || 0 }) }) }));
    });
  }
  return h('div', { class: [CX.perpGrid] }, ...kids);
}

/** "RSI(14) < 30" as three editable parts, plus what the indicator means. */
export function RuleRow(p: RuleRowProps): HTMLElement {
  const about = p.c.left.kind === 'ind' ? meta(p.c.left.id).about : '';
  return h('div', { class: [CX.forkFind], id: p.id },
    h('div', { class: [CX.forkHead] }, h('span', {}, 'Condition ' + (p.index + 1)), Button({ label: 'Remove', onClick: p.onRemove })),
    side(p.id + 'L', p.c.left, o => p.onChange({ ...p.c, left: o }), false),
    Select({ id: p.id + 'Op', label: 'is', value: p.c.op, options: COMPARATORS.map(c => ({ value: c, label: comparatorLabel(c) })), onChange: v => p.onChange({ ...p.c, op: v as Comparator }) }),
    side(p.id + 'R', p.c.right, o => p.onChange({ ...p.c, right: o }), true),
    about ? h('div', { class: [CX.forkKey] }, about) : null);
}
