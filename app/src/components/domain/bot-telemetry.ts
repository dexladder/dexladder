import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Stat } from '../ui/stat';
import { Pill } from '../ui/pill';
import { Section } from './fork-facts';
import { BotPayload } from './bot-payload';
import type { Status } from '../../design/tokens';
import type { Payload, PollStatus, Vitals } from '../../lib/bots/telemetry';

export interface TelemetryProps {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly v: Vitals;
  readonly request: Payload | null;
  readonly response: Payload | null;
  onCopy(which: 'request' | 'response', text: string): void;
}

const ms = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(2) + ' s' : Math.round(n) + ' ms');
const lastText = (s: PollStatus | null): string =>
  s === null ? 'no call yet' : typeof s === 'number' ? 'HTTP ' + s : s;

const health = (v: Vitals): Status => (!v.polls ? 'neutral' : v.streak >= 3 ? 'bad' : v.streak > 0 || v.successPct < 90 ? 'warn' : 'good');

/**
 * What one endpoint bot's connection is actually doing: the latencies it printed, the share of
 * calls that came back, the failure streak now and the worst one ever seen, and one sentence
 * saying what that adds up to.
 *
 * Every figure here is measured, never modelled. p50 and p95 are nearest-rank — each is a latency
 * the endpoint really printed, so a reader can find it in the poll list rather than wondering
 * which two samples it was interpolated between. `worst` is kept on the ring rather than
 * recomputed from the window, so a bot that died for twenty minutes two hours ago does not look
 * healthy merely because those samples have since been evicted.
 */
export function BotTelemetry(p: TelemetryProps): HTMLElement {
  const v = p.v;
  return h('div', { class: [CX.perp], id: 'botTele-' + p.id, data: { tele: p.id } },
    Section('Endpoint health', Pill({ status: health(v), text: v.polls ? lastText(v.last) : 'not called yet' }),
      h('div', { class: [CX.perpGrid] },
        Stat({ label: 'Typical', value: ms(v.p50), hint: 'p50 — half of the calls were faster' }),
        Stat({ label: 'Slow tail', value: ms(v.p95), hint: 'p95 — one call in twenty was slower' }),
        Stat({ label: 'Answered', value: v.polls ? v.successPct.toFixed(0) + '%' : '—', hint: v.polls ? v.ok + ' of ' + v.polls + ' kept' + (v.seen > v.polls ? ' · ' + v.seen.toLocaleString('en-US') + ' polls ever' : '') : 'nothing to measure' }),
        Stat({ label: 'Failing now', value: String(v.streak), hint: 'worst run ever ' + v.worst + ' in a row' }),
        Stat({ label: 'Failed', value: String(v.failed), hint: 'in the last ' + v.polls + ' kept' }),
        Stat({ label: 'Endpoint', value: p.url ? p.url.replace(/^https?:\/\//, '') : '—', hint: 'polled once per closed bar' })),
      h('div', { class: [CX.verdict] },
        h('div', { class: [CX.verdictRow, CX[health(v)]], id: 'botTeleVerdict-' + p.id }, v.verdict))),
    Section('Payload inspector', null,
      h('div', { class: [CX.forkKey] }, 'The last call, exactly as it went out and came back. DexLadder reads only action, size and reason out of the answer; everything else your endpoint sends is shown here and ignored.'),
      BotPayload({ id: p.id, which: 'request', body: p.request, onCopy: t => p.onCopy('request', t) }),
      BotPayload({ id: p.id, which: 'response', body: p.response, onCopy: t => p.onCopy('response', t) })));
}
