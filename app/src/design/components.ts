/**
 * Rules for every class in design/classes.ts — written once, from tokens only. No hex values,
 * no pixel magic outside the spacing/radius scale: a palette or density change is a token edit.
 */
import { CX } from './classes';
import { ROLE, STATUS, v, type Status } from './tokens';

const r = (sel: string, decls: Record<string, string>): string =>
  sel + '{' + Object.entries(decls).map(([k, val]) => k + ':' + val).join(';') + '}';
const c = (k: keyof typeof CX): string => '.' + CX[k];

const statusRules = (base: string): string =>
  (Object.keys(STATUS) as Status[]).map(s => r(base + '.' + CX[s], { color: STATUS[s].fg, background: STATUS[s].bg, 'border-color': STATUS[s].bd })).join('');

/**
 * The fork sandbox's own surface: a dense, terminal-flavoured stack of sections inside one card.
 * Same tokens, same status colours — a console that still belongs to the product.
 */
function forkRules(): string[] {
  const mono = v('--mono'), body = v('--body');
  return [
    r(c('forkSec'), { display: 'grid', gap: v('--sp-2'), padding: v('--sp-3') + ' 0 0', 'border-top': '1px solid ' + ROLE.line, 'margin-top': v('--sp-3') }),
    r(c('forkSec') + ':first-child', { 'border-top': '0', 'margin-top': '0', 'padding-top': '0' }),
    r(c('forkHead'), { display: 'flex', 'align-items': 'center', gap: v('--sp-2'), font: '700 10px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.faint }),
    r(c('forkGrid'), { display: 'grid', 'grid-template-columns': 'auto 1fr', gap: '2px ' + v('--sp-3'), 'align-items': 'baseline' }),
    r(c('forkKey'), { font: '500 11.5px/1.6 ' + body, color: ROLE.muted, 'white-space': 'nowrap' }),
    r(c('forkVal'), { font: '600 11.5px/1.6 ' + mono, color: ROLE.ink, 'font-variant-numeric': 'tabular-nums', 'overflow-wrap': 'anywhere' }),
    r(c('forkFind'), { display: 'grid', gap: '2px', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line, background: ROLE.surface2 }),
    ...(Object.keys(STATUS) as Status[]).map(s => r(c('forkFind') + '.' + CX[s], { 'border-color': STATUS[s].bd, background: STATUS[s].bg })),
    r(c('forkFindHead'), { font: '700 11.5px/1.5 ' + body, color: ROLE.ink }),
    ...(Object.keys(STATUS) as Status[]).map(s => r(c('forkFind') + '.' + CX[s] + ' ' + c('forkFindHead'), { color: STATUS[s].fg })),
    r(c('forkFix'), { font: '600 11px/1.7 ' + mono, color: ROLE.ink2, background: v('--bg-solid'), border: '1px solid ' + ROLE.line, 'border-radius': v('--r-xs'), padding: '2px ' + v('--sp-2'), 'overflow-x': 'auto', 'white-space': 'pre', 'user-select': 'all' }),
    r(c('forkBar'), { display: 'flex', 'flex-wrap': 'wrap', gap: v('--sp-2'), 'align-items': 'center' }),
    r(c('forkBtn'), { flex: '0 0 auto', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line2, background: ROLE.surface2, color: ROLE.ink2, font: '700 11.5px/1 ' + body, cursor: 'pointer' }),
    r(c('forkBtn') + ':hover', { 'border-color': ROLE.info, color: ROLE.ink }),
    r(c('forkBtn') + ':focus-visible', { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px' }),
    r(c('forkBtn') + '[disabled]', { opacity: '.45', cursor: 'not-allowed' }),
    r(c('forkBtnGo'), { color: STATUS.info.fg, 'border-color': STATUS.info.bd, background: STATUS.info.bg }),
    r(c('forkLog'), { display: 'grid', gap: '1px', 'max-height': '190px', 'overflow-y': 'auto', 'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line, background: v('--bg-solid'), padding: v('--sp-2') }),
    r(c('forkLogRow'), { display: 'grid', 'grid-template-columns': 'auto 1fr', gap: v('--sp-2'), font: '500 11px/1.7 ' + mono, color: ROLE.ink2, 'overflow-wrap': 'anywhere' }),
    ...(Object.keys(STATUS) as Status[]).map(s => r(c('forkLogRow') + '.' + CX[s], { color: STATUS[s].fg })),
    r(c('forkLogWhen'), { color: ROLE.faint }),
    r(c('forkArea'), { width: '100%', 'box-sizing': 'border-box', 'min-height': '76px', resize: 'vertical', background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-in'), color: ROLE.ink, font: '500 11px/1.6 ' + mono, padding: v('--sp-2') }),
    r(c('forkSelect'), { width: '100%', 'box-sizing': 'border-box', background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-in'), color: ROLE.ink, font: '600 12px/2.2 ' + body, padding: '0 ' + v('--sp-2') }),
    r(c('forkOut'), { font: '500 11px/1.7 ' + mono, color: ROLE.ink2, background: v('--bg-solid'), border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-in'), padding: v('--sp-2'), 'overflow-x': 'auto', 'overflow-wrap': 'anywhere' }),
    r(c('forkWide'), { 'grid-column': '1 / -1' }),
    r(c('forkCard'), { 'margin-top': v('--sp-4') }),
  ];
}

export function componentCSS(): string {
  const mono = v('--mono'), body = v('--body');
  return [
    r(c('pill'), { display: 'inline-flex', 'align-items': 'center', gap: v('--sp-1'), padding: '2px ' + v('--sp-2'), 'border-radius': '999px', border: '1px solid transparent', font: '600 12px/1.5 ' + body, 'white-space': 'nowrap' }),
    statusRules(c('pill')),
    r(c('badge'), { display: 'inline-block', padding: '1px 6px', 'border-radius': v('--r-xs'), font: '700 10px/1.6 ' + body, 'letter-spacing': '.08em', 'text-transform': 'uppercase', border: '1px solid transparent' }),
    statusRules(c('badge')),
    r(c('card'), { background: ROLE.surface, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-panel'), 'box-shadow': v('--gr-shadow'), padding: v('--sp-4'), 'min-width': '0' }),
    r(c('cardHead'), { display: 'flex', 'align-items': 'baseline', gap: v('--sp-2'), 'margin-bottom': v('--sp-3') }),
    r(c('cardTitle'), { font: '700 15px/1.3 ' + v('--disp'), color: ROLE.ink, margin: '0' }),
    r(c('cardEyebrow'), { font: '700 10px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.muted }),
    r(c('cardBody'), { color: ROLE.ink2, font: '400 14px/1.55 ' + body }),
    r(c('stat'), { display: 'grid', gap: '2px', 'min-width': '0' }),
    r(c('statLabel'), { font: '600 11px/1.4 ' + body, color: ROLE.muted, 'letter-spacing': '.04em' }),
    r(c('statValue'), { font: '700 18px/1.25 ' + mono, color: ROLE.ink, 'font-variant-numeric': 'tabular-nums' }),
    r(c('statHint'), { font: '400 12px/1.4 ' + body, color: ROLE.faint }),
    r(c('row'), { display: 'grid', 'grid-template-columns': 'var(--cols,1fr auto)', gap: v('--sp-3'), 'align-items': 'center', padding: v('--sp-2') + ' 0', 'border-bottom': '1px solid ' + ROLE.line }),
    r(c('row') + ':last-child', { 'border-bottom': '0' }),
    r(c('cell'), { 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', color: ROLE.ink2 }),
    r(c('cellNum'), { 'font-family': mono, 'font-variant-numeric': 'tabular-nums', 'text-align': 'right', color: ROLE.ink }),
    r(c('cellEnd'), { 'text-align': 'right' }),
    r(c('modal'), { position: 'fixed', inset: '0', display: 'none', 'place-items': 'center', background: 'color-mix(in srgb,' + v('--bg-solid') + ' 72%,transparent)', 'z-index': '90', padding: v('--sp-4') }),
    r(c('modal') + '.' + CX.on, { display: 'grid' }),
    r(c('modalPanel'), { width: 'min(560px,100%)', 'max-height': 'min(86vh,720px)', overflow: 'auto', background: ROLE.surface, border: '1px solid ' + ROLE.line2, 'border-radius': v('--r'), 'box-shadow': v('--shadow-lg') }),
    r(c('modalHead'), { display: 'flex', 'align-items': 'center', gap: v('--sp-3'), padding: v('--sp-4') + ' ' + v('--sp-5'), 'border-bottom': '1px solid ' + ROLE.line, font: '700 16px/1.3 ' + v('--disp'), color: ROLE.ink }),
    r(c('modalBody'), { padding: v('--sp-5'), color: ROLE.ink2 }),
    r(c('modalClose'), { 'margin-left': 'auto', background: 'none', border: '0', color: ROLE.muted, font: '400 18px/1 ' + body, cursor: 'pointer', padding: v('--sp-1') }),
    r(c('tabs'), { display: 'flex', gap: v('--sp-1'), 'overflow-x': 'auto', 'scrollbar-width': 'thin', padding: '2px 2px ' + v('--sp-1') }),
    r(c('tab'), { flex: '0 0 auto', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-ctl'), border: '1px solid transparent', background: 'none', color: ROLE.muted, font: '600 13px/1.2 ' + body, cursor: 'pointer', 'text-decoration': 'none' }),
    r(c('tab') + ':hover', { color: ROLE.ink, background: v('--gr-srf') }),
    r(c('tab') + '.' + CX.on, { color: ROLE.ink, background: ROLE.surface2, 'border-color': ROLE.line }),
    r(c('tab') + ':focus-visible', { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px' }),
    r(c('field'), { display: 'grid', gap: v('--sp-1') }),
    r(c('fieldLabel'), { font: '700 10px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.faint }),
    r(c('fieldBox'), { display: 'flex', 'align-items': 'center', gap: v('--sp-2'), background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-in'), padding: '0 ' + v('--sp-3') }),
    r(c('fieldInput'), { flex: '1', 'min-width': '0', background: 'none', border: '0', color: ROLE.ink, font: '600 15px/2.4 ' + mono, outline: 'none' }),
    r(c('fieldUnit'), { color: ROLE.muted, font: '600 12px/1 ' + body }),
    r(c('change'), { 'font-family': mono, 'font-variant-numeric': 'tabular-nums' }),
    r(c('change') + '.' + CX.good + ',' + c('pnl') + '.' + CX.good, { color: ROLE.gain }),
    r(c('change') + '.' + CX.bad + ',' + c('pnl') + '.' + CX.bad, { color: ROLE.loss }),
    r(c('change') + '.' + CX.neutral + ',' + c('pnl') + '.' + CX.neutral, { color: ROLE.muted }),
    r(c('change') + '.' + CX.unavailable + ',' + c('pnl') + '.' + CX.unavailable, { color: ROLE.faint, 'font-family': body, 'font-style': 'italic' }),
    r(c('pnl'), { display: 'inline-grid', 'justify-items': 'end', 'font-family': mono, 'font-variant-numeric': 'tabular-nums' }),
    r(c('preview'), { display: 'grid', gap: '2px', padding: v('--sp-3'), 'border-radius': v('--gr-r-ctl'), background: ROLE.surface2, border: '1px solid ' + ROLE.line }),
    r(c('previewRow'), { display: 'flex', 'justify-content': 'space-between', gap: v('--sp-3'), font: '500 12px/1.7 ' + body, color: ROLE.muted }),
    r(c('previewRow') + '>b', { color: ROLE.ink, 'font-family': mono, 'font-weight': '600' }),
    r(c('previewHead'), { display: 'flex', 'align-items': 'center', gap: v('--sp-2'), 'justify-content': 'space-between', font: '700 10px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.faint, 'margin-bottom': v('--sp-1') }),
    r(c('previewNote'), { 'margin-top': v('--sp-2'), 'padding-top': v('--sp-2'), 'border-top': '1px dashed ' + ROLE.line, font: '400 12px/1.55 ' + body, color: ROLE.ink2 }),
    r(c('previewNote') + ' a', { color: ROLE.info }),
    r(c('previewNote') + '.' + CX.bad, { color: ROLE.loss, 'font-weight': '600' }),
    r(c('previewNote') + '.' + CX.warn, { color: ROLE.warn, 'font-weight': '600' }),
    r(c('previewPills'), { display: 'flex', 'flex-wrap': 'wrap', gap: v('--sp-1'), 'margin-top': v('--sp-2') }),
    r(c('realism'), { display: 'grid', gap: v('--sp-1'), margin: v('--sp-3') + ' 0 ' + v('--sp-2') }),
    r(c('segLabel'), { font: '700 10px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.faint }),
    r(c('seg'), { display: 'flex', gap: v('--sp-1') }),
    r(c('segBtn'), { flex: '1', padding: v('--sp-2') + ' 0', 'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line, background: ROLE.surface2, color: ROLE.muted, font: '700 11.5px/1 ' + body, cursor: 'pointer' }),
    r(c('segBtn') + '.' + CX.on, { color: ROLE.info, 'border-color': ROLE.info, background: STATUS.info.bg }),
    r(c('segBtn') + ':focus-visible', { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px' }),
    r(c('dim'), { color: ROLE.muted }),
    r(c('sections'), { margin: '0 0 ' + v('--sp-4'), 'border-bottom': '1px solid ' + ROLE.line, 'padding-bottom': v('--sp-2') }),
    ...perpCSS(mono, body),
    ...backtestCSS(mono, body),
    ...forkRules(),
  ].join('');
}

/** The perpetual-futures desk (and, from the backtester on, any desk that needs its buttons and meter). */
function perpCSS(mono: string, body: string): string[] {
  const btn = { padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-in'), font: '700 12px/1.2 ' + body, cursor: 'pointer', border: '1px solid ' + ROLE.line, background: ROLE.surface2, color: ROLE.ink2 };
  return [
    r(c('perp'), { display: 'grid', gap: v('--sp-3') }),
    r(c('perpLine'), { font: '500 12px/1.5 ' + body, color: ROLE.muted }),
    r(c('perpLine') + '>b', { color: ROLE.ink, 'font-family': mono }),
    r(c('perpGrid'), { display: 'grid', 'grid-template-columns': 'repeat(auto-fit,minmax(96px,1fr))', gap: v('--sp-2') + ' ' + v('--sp-3') }),
    r(c('perpGrid') + ' ' + c('statValue'), { 'font-size': '14px' }),
    r(c('perpGrid') + ' ' + c('fieldInput'), { width: '100%' }),
    r(c('perpGrid') + ' ' + c('fieldBox'), { 'min-width': '0' }),
    r(c('perpBtns'), { display: 'flex', gap: v('--sp-2'), 'flex-wrap': 'wrap' }),
    r(c('long') + ',' + c('short'), { flex: '1 1 0', 'min-height': '44px', 'border-radius': v('--gr-r-ctl'), font: '800 14px/1 ' + body, cursor: 'pointer', 'letter-spacing': '.02em' }),
    r(c('long'), { color: STATUS.good.fg, background: STATUS.good.bg, border: '1px solid ' + STATUS.good.bd }),
    r(c('short'), { color: STATUS.bad.fg, background: STATUS.bad.bg, border: '1px solid ' + STATUS.bad.bd }),
    r(c('long') + ':focus-visible,' + c('short') + ':focus-visible,' + c('btn') + ':focus-visible', { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px' }),
    r(c('btn'), btn),
    r(c('btn') + ':hover', { color: ROLE.ink, 'border-color': ROLE.line2 }),
    r(c('btn') + '.' + CX.on, { color: ROLE.info, 'border-color': ROLE.info, background: STATUS.info.bg }),
    r(c('btn') + ':disabled', { opacity: '.5', cursor: 'not-allowed' }),
    r(c('range'), { width: '100%', 'accent-color': ROLE.info }),
    r(c('meter'), { height: '6px', 'border-radius': '999px', background: ROLE.surface2, border: '1px solid ' + ROLE.line, overflow: 'hidden' }),
    r(c('meterFill'), { height: '100%', width: 'var(--pct,0%)', background: ROLE.gain }),
    r(c('meterFill') + '.' + CX.warn, { background: ROLE.warn }),
    r(c('meterFill') + '.' + CX.bad, { background: ROLE.loss }),
    r(c('perpPos'), { display: 'grid', gap: v('--sp-2'), padding: v('--sp-3'), 'border-radius': v('--gr-r-ctl'), background: ROLE.surface2, border: '1px solid ' + ROLE.line }),
    r(c('perpHead'), { display: 'flex', 'align-items': 'center', gap: v('--sp-2'), 'flex-wrap': 'wrap', color: ROLE.ink, font: '700 13px/1.3 ' + body }),
    r(c('perpHead') + '>' + c('perpBtns'), { 'margin-left': 'auto' }),
    r(c('pm'), { display: 'grid', gap: v('--sp-2'), padding: v('--sp-3'), 'border-radius': v('--gr-r-ctl'), border: '1px solid ' + STATUS.bad.bd, background: STATUS.bad.bg, color: ROLE.ink }),
    r(c('pmList'), { margin: '0', 'padding-left': '1.1em', display: 'grid', gap: v('--sp-1'), font: '400 13px/1.55 ' + body, color: ROLE.ink }),
  ];
}

/** The Rewind desk: a chart beside a ticket, a transport bar, and the verdict. */
function backtestCSS(mono: string, body: string): string[] {
  return [
    r(c('select'), { width: '100%', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line, background: ROLE.surface2, color: ROLE.ink, font: '600 13px/1.3 ' + body, cursor: 'pointer' }),
    r(c('select') + ':focus-visible', { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px' }),
    r(c('bt'), { display: 'grid', gap: v('--sp-3') }),
    r(c('btBar'), { display: 'flex', 'align-items': 'center', gap: v('--sp-2'), 'flex-wrap': 'wrap', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-ctl'), background: ROLE.surface2, border: '1px solid ' + ROLE.line, font: '600 12px/1.4 ' + mono, color: ROLE.ink2 }),
    r(c('btChart'), { display: 'block', width: '100%', 'border-radius': v('--gr-r-ctl'), border: '1px solid ' + ROLE.line, background: ROLE.surface2 }),
    r(c('btSide'), { display: 'grid', 'grid-template-columns': 'minmax(0,2.2fr) minmax(240px,1fr)', gap: v('--sp-3'), 'align-items': 'start' }),
    '@media (max-width:860px){' + c('btSide') + '{grid-template-columns:minmax(0,1fr)}}',
    r(c('btList'), { display: 'grid', gap: '2px', 'max-height': '160px', 'overflow-y': 'auto', font: '500 12px/1.6 ' + mono, color: ROLE.muted }),
    r(c('btLine'), { display: 'flex', 'justify-content': 'space-between', gap: v('--sp-2'), 'border-bottom': '1px dashed ' + ROLE.line, padding: '2px 0' }),
    r(c('verdict'), { display: 'grid', gap: v('--sp-2') }),
    r(c('verdictRow'), { display: 'grid', gap: '2px', padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-ctl'), background: ROLE.surface2, border: '1px solid ' + ROLE.line, font: '400 13px/1.55 ' + body, color: ROLE.ink2 }),
    r(c('verdictRow') + '>b', { color: ROLE.ink, font: '700 12px/1.4 ' + body, 'letter-spacing': '.02em' }),
    r(c('verdictRow') + '.' + CX.good, { 'border-color': STATUS.good.bd }),
    r(c('verdictRow') + '.' + CX.bad, { 'border-color': STATUS.bad.bd }),
    r(c('verdictRow') + '.' + CX.warn, { 'border-color': STATUS.warn.bd }),
  ];
}
