import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button, Select } from '../ui/fields';
import type { Status } from '../../design/tokens';
import type { LogEvent, LogEventKind, LogEventLevel } from '../../lib/bots/logbook';

/** the height of one row, in px — the same number `botRow` sets in CSS. A virtualised list only
 *  lands on the right scroll offset if every row is exactly this tall, so the two must agree. */
export const ROW_PX = 26;

export interface LogViewProps {
  /** the window, already sliced — this component NEVER receives the whole book */
  readonly rows: readonly LogEvent[];
  /** how many entries the filter matched in total, so the spacers can be sized */
  readonly total: number;
  /** index of rows[0] within those matches */
  readonly from: number;
  readonly cap: string;
  readonly level: string;
  readonly kind: string;
  readonly bot: string;
  readonly bots: readonly { readonly value: string; readonly label: string }[];
  onScroll(top: number): void;
  onFilter(k: 'level' | 'kind' | 'bot', v: string): void;
  onClear(): void;
}

const LEVELS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Every level' }, { value: 'debug', label: 'Debug — every bar seen' },
  { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors only' },
];
const KINDS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Everything' }, { value: 'tick', label: 'Bars received' }, { value: 'eval', label: 'Conditions evaluated' },
  { value: 'dispatch', label: 'Orders dispatched' }, { value: 'fill', label: 'Fills' }, { value: 'halt', label: 'Halts' }, { value: 'error', label: 'Errors' },
];
const TONE: Readonly<Record<LogEventLevel, Status>> = { debug: 'neutral', info: 'info', warn: 'warn', error: 'bad' };
const TAG: Readonly<Record<LogEventKind, string>> = { tick: 'bar', eval: 'eval', dispatch: 'send', fill: 'fill', halt: 'halt', error: 'err' };
const clock = (t: number): string => { try { return new Date(t).toLocaleTimeString(); } catch { return ''; } };

const spacer = (px: number): HTMLElement => h('div', { class: [CX.botSpacer], vars: { '--h': Math.max(0, px) + 'px' } });

/**
 * One row. The sentence is clipped rather than wrapped so every row is exactly ROW_PX tall; the
 * whole sentence is on the row's title, one hover away — never truncated without the full text
 * being reachable, and never a second line that would put the virtualisation out by a pixel.
 */
const row = (e: LogEvent): HTMLElement =>
  h('div', { class: [CX.botRow, CX[TONE[e.level]]], title: e.text, data: { logSeq: String(e.seq), logKind: e.kind, logBot: e.bot } },
    h('span', {}, clock(e.t)),
    h('span', {}, TAG[e.kind]),
    h('span', {}, e.text));

/**
 * The live execution log: every bar a bot saw, every condition it evaluated, every order it sent,
 * every fill, halt and error — in order, in sentences.
 *
 * It is virtualised: only `rows` are ever in the DOM, held in place by a spacer above and below.
 * A 600-entry book at 26 px is 15,600 px of scroll and about a dozen elements.
 */
export function BotLogView(p: LogViewProps): HTMLElement {
  const view = h('div', { class: [CX.botScroll], id: 'botLogView', role: 'log', aria: { label: 'Bot execution log' } },
    spacer(p.from * ROW_PX),
    ...p.rows.map(row),
    spacer((p.total - p.from - p.rows.length) * ROW_PX));
  // A repaint replaces this element, and a scroll event still in flight would then be delivered
  // to the detached old one — which reports scrollTop 0 and would jump the reader back to the top
  // of the log. A detached viewport has nothing to say about where the live one is scrolled.
  view.addEventListener('scroll', () => { if (view.isConnected) p.onScroll(view.scrollTop); }, { passive: true });
  return h('div', { class: [CX.perp], id: 'botLog' },
    h('div', { class: [CX.perpGrid] },
      Select({ id: 'botLogLevel', label: 'Level', value: p.level, options: LEVELS, onChange: v => p.onFilter('level', v) }),
      Select({ id: 'botLogKind', label: 'Event', value: p.kind, options: KINDS, onChange: v => p.onFilter('kind', v) }),
      Select({ id: 'botLogBot', label: 'Bot', value: p.bot, options: [{ value: '', label: 'Every bot' }, ...p.bots], onChange: v => p.onFilter('bot', v) })),
    h('div', { class: [CX.forkBar] },
      h('span', { class: [CX.forkKey], id: 'botLogCap' }, p.cap),
      Button({ id: 'botLogClear', label: 'Clear the log', onClick: p.onClear })),
    view,
    h('div', { class: [CX.forkKey] }, p.total
      ? 'Showing ' + p.rows.length + ' of ' + p.total.toLocaleString('en-US') + ' matching entr' + (p.total === 1 ? 'y' : 'ies') + ' — the rest exist, they are just not in the DOM. Hover a line for the whole sentence.'
      : 'Nothing matches this filter yet. A bot writes here on every bar it sees, not only when it trades.'));
}
