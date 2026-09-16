import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button } from '../ui/fields';
import { Pill } from '../ui/pill';
import type { Payload } from '../../lib/bots/telemetry';

export interface PayloadProps {
  readonly id: string;
  readonly which: 'request' | 'response';
  readonly body: Payload | null;
  onCopy(text: string): void;
}

const when = (t: number): string => { try { return new Date(t).toLocaleTimeString(); } catch { return ''; } };
const bytes = (n: number): string => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' chars');

/**
 * One side of the last exchange, verbatim.
 *
 * A browser tells you almost nothing about why a cross-origin call failed — every refusal arrives
 * as the same empty TypeError — so the only honest way to help someone debug their own bot is to
 * show them the call itself. `lib/bots/telemetry` keeps the newest request and the newest response
 * and nothing else, and it writes its own truncation notice INTO the text when it cuts: a payload
 * that was shortened says so on screen, in the block, where it cannot be missed.
 */
export function BotPayload(p: PayloadProps): HTMLElement {
  const label = p.which === 'request' ? 'Last request' : 'Last response';
  const id = (p.which === 'request' ? 'botReq-' : 'botRes-') + p.id;
  if (!p.body) {
    return h('div', { class: [CX.forkSec] },
      h('div', { class: [CX.forkHead] }, h('span', {}, label)),
      h('code', { class: [CX.botPre], id }, p.which === 'request'
        ? 'Nothing sent yet — this bot has not polled your endpoint, so there is no request to show.'
        : 'Nothing received yet. When your endpoint answers, its raw body appears here exactly as it arrived — not a parsed summary of it.'));
  }
  return h('div', { class: [CX.forkSec] },
    h('div', { class: [CX.forkHead] },
      h('span', {}, label),
      Pill({ status: 'neutral', text: when(p.body.t) }),
      Pill({ status: p.body.truncated ? 'warn' : 'neutral', text: bytes(p.body.chars) + (p.body.truncated ? ' · cut' : '') }),
      Button({ id: (p.which === 'request' ? 'botCopyReq-' : 'botCopyRes-') + p.id, label: 'Copy', title: 'copy the raw ' + p.which + ' to the clipboard', onClick: () => p.onCopy(p.body ? p.body.text : '') })),
    h('code', { class: [CX.botPre], id, data: { chars: String(p.body.chars), truncated: String(p.body.truncated) } }, p.body.text));
}
