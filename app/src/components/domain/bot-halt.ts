import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button } from '../ui/fields';
import { Pill } from '../ui/pill';
import type { HaltPlan } from '../../lib/bots/kill';

export interface HaltReportLike {
  readonly outcomes: readonly { readonly plan: HaltPlan; readonly name: string; readonly sealed: boolean }[];
  readonly headline: string;
  readonly sealNote: string;
}

export interface KillProps {
  /** bots that are still in the market — live, paused, or stopped by errors while holding */
  readonly haltable: number;
  /** '' = idle, 'all' = the global switch is armed, otherwise the bot id it is armed for */
  readonly armed: string;
  /** what firing right now would do — printed verbatim, so the user agrees to the actual plan */
  readonly plans: readonly HaltPlan[];
  readonly report: HaltReportLike | null;
  readonly name: string;
  onArm(scope: string): void;
  onCancel(): void;
  onFire(): void;
  onDismiss(): void;
}

const STEP_LABEL: Readonly<Record<string, string>> = {
  freeze: '1 · Freeze', cancel: '2 · Cancel', flatten: '3 · Flatten', seal: '4 · Seal', status: '5 · Stand down',
};

/** One plan as five finished sentences, in the order they will happen. */
function planCard(p: HaltPlan, name: string): HTMLElement {
  return h('div', { class: [CX.forkFind, CX.warn], data: { haltPlan: p.id } },
    h('div', { class: [CX.forkFindHead] }, name),
    ...p.steps.map(s => h('div', { class: [CX.forkLogRow, s.acted ? CX.warn : CX.neutral] },
      h('span', { class: [CX.forkLogWhen] }, STEP_LABEL[s.kind] || s.kind),
      h('span', {}, s.text))));
}

/** The confirmation. It does not ask "are you sure" — it prints what is about to happen. */
function confirmPanel(p: KillProps): HTMLElement {
  const n = p.plans.length;
  const who = p.armed === 'all' ? 'every bot that is still in the market' : p.name;
  return h('div', { class: [CX.perp], id: 'botHaltConfirm' },
    h('div', { class: [CX.botKill] },
      h('span', { class: [CX.forkKey] }, n
        ? 'Halting ' + who + ' will do exactly this, in this order, and it cannot be undone: the paper positions below are sold at the mark and the bots stop deciding. Your trading account is not touched — it never is.'
        : 'Nothing to halt: no bot is in the market right now.'),
      n ? Button({ id: 'botHaltGo', label: 'Yes — halt ' + n + ' bot' + (n === 1 ? '' : 's'), primary: true, onClick: p.onFire }) : null,
      Button({ id: 'botHaltCancel', label: n ? 'Leave them running' : 'Close', onClick: p.onCancel })),
    ...p.plans.map(pl => planCard(pl, pl.draft.data.name + ' · ' + pl.draft.data.why)));
}

/** What happened, after the fact — the same five sentences, now in the past tense of the ledger. */
function reportPanel(p: KillProps, rep: HaltReportLike): HTMLElement {
  return h('div', { class: [CX.perp], id: 'botHaltOut' },
    h('div', { class: [CX.forkOut, rep.sealNote ? CX.warn : CX.good] }, rep.headline),
    rep.sealNote ? h('div', { class: [CX.forkOut, CX.bad], id: 'botHaltSealNote' }, rep.sealNote) : null,
    ...rep.outcomes.map(o => h('div', { class: [CX.forkFind, o.sealed ? CX.neutral : CX.warn], data: { haltDone: o.plan.id } },
      h('div', { class: [CX.forkHead] },
        h('span', { class: [CX.forkFindHead] }, o.name),
        Pill({ status: o.sealed ? 'good' : 'warn', text: o.sealed ? 'sealed' : 'not sealed' })),
      // the plan writes step 4 in the past tense because sealing is simply what it asked for;
      // when the chain was not there to write to, the step says so instead of claiming a receipt
      ...o.plan.steps.map(s => {
        const missed = s.kind === 'seal' && !o.sealed;
        return h('div', { class: [CX.forkLogRow, missed ? CX.bad : s.acted ? CX.info : CX.neutral] },
          h('span', { class: [CX.forkLogWhen] }, STEP_LABEL[s.kind] || s.kind),
          h('span', {}, missed ? 'NOT sealed — this page has no proof ledger to write to. It would have read: ' + s.text : s.text));
      }))),
    h('div', { class: [CX.forkBar] }, Button({ id: 'botHaltDismiss', label: 'Close', onClick: p.onDismiss })));
}

/**
 * The kill switch: one red bar the desk always shows, a confirmation that names what will happen,
 * and the receipt afterwards. Nothing here decides anything — every sentence on screen is a
 * sentence `lib/bots/kill.ts` wrote.
 */
export function BotKill(p: KillProps): HTMLElement {
  if (p.report) return reportPanel(p, p.report);
  if (p.armed) return confirmPanel(p);
  return h('div', { class: [CX.botKill], id: 'botKillBar' },
    h('span', {}, '🛑 Emergency halt'),
    h('span', { class: [CX.forkKey] }, p.haltable
      ? p.haltable + ' bot' + (p.haltable === 1 ? ' is' : 's are') + ' in the market. Halting freezes the decision source, cancels every resting order, sells the position at the mark and seals one entry per bot into the proof ledger.'
      : 'No bot is in the market. There is nothing to halt right now.'),
    Button({ id: 'botHalt', label: 'Halt every bot', primary: true, disabled: !p.haltable, title: 'freeze, cancel, flatten, seal, stand down — for every bot at once', onClick: () => p.onArm('all') }));
}
