import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Badge } from '../ui/badge';
import { SPEEDS } from '../../hooks/useBacktest';

export interface TransportProps {
  readonly bar: number;
  readonly bars: number;
  readonly when: string;
  readonly price: string;
  readonly playing: boolean;
  readonly speed: number;
  readonly done: boolean;
  onPlay(): void;
  onStep(n: number): void;
  onRestart(): void;
  onFinish(): void;
  onSpeed(x: number): void;
}

const b = (label: string, fn: () => void, title: string, on = false, disabled = false) => {
  const el = h('button', { class: [CX.btn, on && CX.on], type: 'button', title, on: { click: fn } }, label);
  if (disabled) el.setAttribute('disabled', 'disabled');
  return el;
};

/** Play / step / speed, and where in the range the replay is. */
export function BtTransport(p: TransportProps): HTMLElement {
  const pos = p.bars ? Math.round(((p.bar + 1) / p.bars) * 100) : 0;
  return h('div', { class: [CX.btBar], id: 'btBar', role: 'group', aria: { label: 'Replay controls' } },
    b(p.playing ? '⏸ Pause' : '▶ Play', () => p.onPlay(), p.playing ? 'Pause the replay' : 'Play the replay bar by bar', p.playing, p.done),
    b('▶| Step', () => p.onStep(1), 'One bar forward', false, p.done || p.playing),
    b('⏩ +10', () => p.onStep(10), 'Ten bars forward', false, p.done || p.playing),
    ...SPEEDS.map(x => b(x + '×', () => p.onSpeed(x), 'Replay at ' + x + ' bars per beat', x === p.speed)),
    b('⏮ Restart', () => p.onRestart(), 'Back to the first bar — the run starts again'),
    b('⏭ To the end', () => p.onFinish(), 'Finish the run and close any open position at the last close', false, p.done),
    h('span', {}, p.bar < 0 ? 'not started' : 'bar ' + (p.bar + 1) + ' / ' + p.bars + ' · ' + pos + '%'),
    h('span', {}, p.when), h('span', {}, p.price),
    p.done ? Badge('Finished', 'info') : null);
}
