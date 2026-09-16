import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Button, Select, TextField } from '../ui/fields';
import { Segmented } from '../ui/segmented';
import { Section } from './fork-facts';
import { RuleRow } from './bot-rule';
import { PRESETS } from '../../lib/bots/presets';
import { describe } from '../../lib/bots/rules';
import { INTERVALS } from '../../lib/bots/validate';
import type { Condition, Strategy } from '../../lib/bots/types';

export interface BuilderProps {
  readonly name: string;
  readonly sym: string;
  readonly coins: readonly string[];
  readonly interval: string;
  readonly stake: string;
  readonly strategy: Strategy;
  readonly errors: readonly string[];
  readonly busy: string;
  onField(k: 'name' | 'sym' | 'interval' | 'stake', v: string): void;
  onPreset(id: string): void;
  onStrategy(s: Strategy): void;
  onBacktest(): void;
  onLaunch(): void;
}

const FRESH: Condition = { left: { kind: 'ind', id: 'rsi', p1: 14 }, op: '<', right: { kind: 'const', value: 30 } };

const list = (p: BuilderProps, which: 'entry' | 'exit'): HTMLElement => {
  const cs = p.strategy[which];
  const set = (next: Condition[]): void => p.onStrategy({ ...p.strategy, [which]: next });
  return Section(which === 'entry' ? 'Buy when' : 'Sell when',
    Segmented({ id: 'blLogic' + which, label: 'match', value: p.strategy[which === 'entry' ? 'entryLogic' : 'exitLogic'],
      options: [{ value: 'all', label: 'all of these' }, { value: 'any', label: 'any of these' }],
      onChange: v => p.onStrategy({ ...p.strategy, [which === 'entry' ? 'entryLogic' : 'exitLogic']: v as 'all' | 'any' }) }),
    ...cs.map((c, i) => RuleRow({ id: 'bl' + which + i, c, index: i, onChange: n => set(cs.map((x, j) => (j === i ? n : x))), onRemove: () => set(cs.filter((_, j) => j !== i)) })),
    h('div', { class: [CX.forkBar] }, Button({ label: '+ Add a condition', onClick: () => set([...cs, FRESH]) })));
};

const risk = (p: BuilderProps): HTMLElement => {
  const r = p.strategy.risk;
  const num = (id: string, label: string, value: number | undefined, k: keyof typeof r, unit: string): HTMLElement =>
    TextField({ id, label: label + ' (' + unit + ')', value: value == null ? '' : String(value), placeholder: 'off',
      onInput: v => p.onStrategy({ ...p.strategy, risk: { ...r, [k]: v.trim() === '' ? undefined : Number(v) || 0 } }) });
  return Section('Risk — what the bot does without being told', null,
    h('div', { class: [CX.perpGrid] },
      TextField({ id: 'blStake', label: 'Spend per entry (% of cash)', value: String(Math.round(r.stakePct * 100)), onInput: v => p.onStrategy({ ...p.strategy, risk: { ...r, stakePct: Math.min(100, Math.max(1, Number(v) || 0)) / 100 } }) }),
      num('blSl', 'Stop-loss', r.stopLossPct, 'stopLossPct', '%'),
      num('blTp', 'Take-profit', r.takeProfitPct, 'takeProfitPct', '%'),
      num('blTr', 'Trailing stop', r.trailingPct, 'trailingPct', '%'),
      TextField({ id: 'blCd', label: 'Cooldown after an exit (bars)', value: String(r.cooldownBars), onInput: v => p.onStrategy({ ...p.strategy, risk: { ...r, cooldownBars: Math.max(0, Number(v) || 0) } }) })),
    h('div', { class: [CX.forkKey] }, 'Stops and targets are checked against every price the bot sees — not once a bar — so a wick through your stop takes you out where it happened.'));
};

/** Build Your Own Bot: rules as blocks, the plain-English reading of them, and the two exits from the page. */
export function BotBuilder(p: BuilderProps): HTMLElement {
  return h('div', { class: [CX.perp], id: 'botBuilder' },
    Section('The bot', null,
      h('div', { class: [CX.perpGrid] },
        TextField({ id: 'blName', label: 'Name', value: p.name, placeholder: 'My first bot', onInput: v => p.onField('name', v) }),
        Select({ id: 'blSym', label: 'Market', value: p.sym, options: p.coins.map(s => ({ value: s, label: s + '/USDT' })), onChange: v => p.onField('sym', v) }),
        Select({ id: 'blIv', label: 'Bar size', value: p.interval, options: INTERVALS.map(i => ({ value: i, label: i })), onChange: v => p.onField('interval', v) }),
        TextField({ id: 'blCash', label: 'Paper stake (USDT)', value: p.stake, placeholder: '10000', onInput: v => p.onField('stake', v) })),
      Select({ id: 'blPreset', label: 'Start from a classic', value: '', options: [{ value: '', label: 'a blank strategy' }, ...PRESETS.map(x => ({ value: x.id, label: x.label }))], onChange: p.onPreset }),
      h('div', { class: [CX.forkKey] }, 'The stake is this bot’s own paper wallet. Your trading account is never touched — a bot cannot reach it.')),
    list(p, 'entry'),
    list(p, 'exit'),
    risk(p),
    Section('In words', null, ...describe(p.strategy).map(l => h('div', { class: [CX.forkVal] }, l))),
    p.errors.length ? Section('Before it can run', null, ...p.errors.map(e => h('div', { class: [CX.forkFind, CX.bad] }, e))) : null,
    h('div', { class: [CX.forkBar] },
      Button({ label: p.busy === 'bt' ? 'testing…' : 'Test on history', disabled: !!p.busy || !!p.errors.length, onClick: p.onBacktest }),
      Button({ label: 'Run it live', primary: true, disabled: !!p.busy || !!p.errors.length, onClick: p.onLaunch })));
}
