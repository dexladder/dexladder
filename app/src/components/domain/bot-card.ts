import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button } from '../ui/fields';
import { Pill } from '../ui/pill';
import { Stat } from '../ui/stat';
import type { Status } from '../../design/tokens';
import type { BotStatus, Health, LogLine } from '../../lib/bots/types';
import type { Score } from '../../lib/bots/wallet';

export interface BotCardProps {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly market: string;
  readonly status: BotStatus;
  readonly health: Health;
  readonly score: Score;
  readonly holding: string;
  readonly log: readonly LogLine[];
  readonly open: boolean;
  /** still in the market — live, paused, or stopped by errors while holding */
  readonly haltable: boolean;
  fmt(n: number): string;
  onStart(): void; onPause(): void; onStop(): void; onReset(): void; onRemove(): void; onToggle(): void;
  /** the kill switch, for this bot alone. Destructive, so it only arms the confirmation. */
  onHalt(): void;
}

// 'halted' is red, not neutral: the kill switch fired, and a bot that was flattened by a safety
// stop must not sit in the list looking like one the user chose to stop.
const STATE: Readonly<Record<BotStatus, Status>> = { draft: 'neutral', live: 'good', paused: 'warn', stopped: 'neutral', error: 'bad', halted: 'bad' };
const SIGN = (x: number): Status => (x > 0 ? 'good' : x < 0 ? 'bad' : 'neutral');
const pct = (x: number): string => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%';
const KIND: Readonly<Record<LogLine['kind'], Status>> = { info: 'neutral', signal: 'info', fill: 'good', risk: 'warn', error: 'bad', health: 'neutral' };
const clock = (t: number): string => { try { return new Date(t).toLocaleTimeString(); } catch { return ''; } };

/** One bot in the Arena: what it is worth, what it is doing, and every decision it has taken. */
export function BotCard(p: BotCardProps): HTMLElement {
  const s = p.score;
  const acts = h('div', { class: [CX.forkBar] },
    p.status === 'live' ? Button({ label: 'Pause', onClick: p.onPause }) : Button({ label: p.status === 'paused' ? 'Resume' : 'Start', primary: true, onClick: p.onStart }),
    Button({ label: 'Stop & flatten', disabled: p.status === 'stopped', title: 'sell everything at the mark and stop deciding', onClick: p.onStop }),
    Button({ id: 'botCardHalt-' + p.id, label: '🛑 Halt', disabled: !p.haltable, title: p.haltable ? 'freeze this bot, cancel its orders, flatten it and seal the halt into the proof ledger' : 'this bot is already out of the market', onClick: p.onHalt }),
    Button({ label: 'Reset wallet', onClick: p.onReset }),
    Button({ label: 'Delete', onClick: p.onRemove }),
    Button({ label: p.open ? 'Hide the log' : 'Show the log (' + p.log.length + ')', onClick: p.onToggle }));
  return h('div', { class: [CX.forkFind, CX[STATE[p.status]]], id: 'botCard-' + p.id, data: { bot: p.id } },
    h('div', { class: [CX.forkHead] },
      h('span', { class: [CX.forkFindHead] }, p.name),
      Pill({ status: 'neutral', text: p.kindLabel }),
      Pill({ status: 'neutral', text: p.market }),
      Pill({ status: STATE[p.status], text: p.status }),
      p.health.ok ? null : Pill({ status: 'bad', text: p.health.text.slice(0, 60) })),
    h('div', { class: [CX.perpGrid] },
      Stat({ label: 'Wallet', value: p.fmt(s.equity) + ' USDT', hint: p.holding }),
      Stat({ label: 'Return', value: h('span', { class: [CX.pnl, CX[SIGN(s.returnPct)]] }, pct(s.returnPct)), hint: 'buy-and-hold ' + pct(s.buyHoldPct) }),
      Stat({ label: 'Edge over holding', value: h('span', { class: [CX.pnl, CX[SIGN(s.edgePct)]] }, pct(s.edgePct)), hint: s.trades + ' trade(s) · ' + s.winRatePct.toFixed(0) + '% won' }),
      Stat({ label: 'Worst drawdown', value: s.maxDDPct.toFixed(2) + '%', hint: 'fees ' + s.feesUSD.toFixed(2) + ' USDT' })),
    acts,
    p.open ? h('div', { class: [CX.forkLog], id: 'botLog-' + p.id }, ...[...p.log].reverse().slice(0, 60).map(l =>
      h('div', { class: [CX.forkLogRow, CX[KIND[l.kind]]] }, h('span', { class: [CX.forkLogWhen] }, clock(l.t)), h('span', {}, l.text)))) : null);
}
