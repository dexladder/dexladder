import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { TableRow } from '../ui/table-row';
import { Pill } from '../ui/pill';
import { Section } from './fork-facts';
import type { Status } from '../../design/tokens';
import type { Ranked, VerdictLine } from '../../lib/bots/arena';

const pct = (x: number): string => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%';
const SIGN = (x: number): Status => (x > 0 ? 'good' : x < 0 ? 'bad' : 'neutral');
const CALL: Readonly<Record<string, Status>> = { 'beats the market': 'good', 'trails the market': 'bad', 'too early to say': 'warn', 'level with the market': 'neutral' };

export interface LeaderboardProps {
  readonly rows: readonly Ranked[];
  readonly note: string;
  fmt(n: number): string;
  onPick(id: string): void;
}

/** Every bot on one board, ranked by the only number that matters: the edge over holding the coin. */
export function BotLeaderboard(p: LeaderboardProps): HTMLElement {
  if (!p.rows.length) return h('div', { class: [CX.forkKey], id: 'botBoard' }, 'No bots yet. Build one from rules, or bring your own — each gets its own paper wallet and runs against the live market.');
  return h('div', { class: [CX.btList], id: 'botBoard' },
    TableRow({ cols: '2.2rem 1fr 5rem 6rem 6rem 5rem 8rem', cells: [
      { content: '#' }, { content: 'Bot' }, { content: 'Wallet', num: true }, { content: 'Return', num: true },
      { content: 'vs holding', num: true }, { content: 'Max DD', num: true }, { content: 'Verdict', end: true }] }),
    ...p.rows.map(r => TableRow({
      cols: '2.2rem 1fr 5rem 6rem 6rem 5rem 8rem',
      label: r.name + ' · ' + r.call,
      onSelect: () => p.onPick(r.id),
      cells: [
        { content: String(r.rank) },
        { content: r.name + ' · ' + r.sym + ' ' + r.interval, title: r.kind === 'rules' ? 'built from rules' : r.kind === 'js' ? 'your JavaScript, sandboxed' : 'your own bot at a URL' },
        { content: p.fmt(r.score.equity), num: true },
        { content: h('span', { class: [CX.pnl, CX[SIGN(r.score.returnPct)]] }, pct(r.score.returnPct)), num: true },
        { content: h('span', { class: [CX.pnl, CX[SIGN(r.score.edgePct)]] }, pct(r.score.edgePct)), num: true, title: 'buy-and-hold returned ' + pct(r.score.buyHoldPct) + ' over the same bars' },
        { content: r.score.maxDDPct.toFixed(1) + '%', num: true },
        { content: Pill({ status: CALL[r.call] || 'neutral', text: r.call }), end: true },
      ],
    })),
    h('div', { class: [CX.forkKey] }, p.note));
}

/** The sentences under a bot's figures — buy-and-hold first, sample size named. */
export function BotVerdict(lines: readonly VerdictLine[], title = 'What this says'): HTMLElement {
  return Section(title, null, h('div', { class: [CX.verdict] }, ...lines.map(l =>
    h('div', { class: [CX.verdictRow, CX[l.status]] }, l.text))));
}
