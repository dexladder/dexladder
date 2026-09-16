import { h } from '../ui/h';
import { CX } from '../../design/classes';
import { Stat } from '../ui/stat';
import { PnlCell } from './pnl';
import type { Metrics } from '../../lib/backtest';

export interface BtMetricsProps { readonly m: Metrics; fmt(n: number): string }

const pct = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) + '%';

/** The run, measured: equity and return against buy-and-hold, risk, and what the trading cost. */
export function BtMetrics(p: BtMetricsProps): HTMLElement {
  const m = p.m;
  return h('div', { class: [CX.perpGrid], id: 'btMetrics', role: 'group', aria: { label: 'Run metrics' } },
    Stat({ label: 'Equity', value: p.fmt(m.equity), hint: m.bars + ' bars replayed' }),
    Stat({ label: 'Return', value: PnlCell(m.equity - m.start, m.returnPct, p.fmt) }),
    Stat({ label: 'Buy & hold', value: pct(m.buyHoldPct), hint: (m.edgePct >= 0 ? 'you are ahead by ' : 'you are behind by ') + pct(Math.abs(m.edgePct)) }),
    Stat({ label: 'Max drawdown', value: pct(m.maxDDPct), hint: m.ddBars + ' bars under water' }),
    Stat({ label: 'Trades', value: String(m.trades), hint: m.trades ? pct(m.winRatePct) + ' won' : 'none closed yet' }),
    Stat({ label: 'Profit factor', value: m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2), hint: 'expectancy ' + p.fmt(m.expectancy) + ' / trade' }),
    Stat({ label: 'Sharpe', value: m.sharpe.toFixed(2), hint: 'annualised, risk-free 0' }),
    Stat({ label: 'Exposure', value: pct(m.exposurePct), hint: 'of the bars in the market' }),
    Stat({ label: 'Fees', value: p.fmt(m.feesUSD), hint: m.fills + ' fills · ' + pct(m.feeDragPct) + ' of the stack' }));
}
