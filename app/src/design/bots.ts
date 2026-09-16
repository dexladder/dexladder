/**
 * The Bots desk's own surfaces — the kill switch, the virtualised execution log, the payload
 * inspector and the curve's legend. Written from tokens only, like every other rule in the system.
 *
 * Two of these rules are load-bearing rather than decorative:
 *   · `botScroll` has a FIXED height and `botRow` a fixed row height, because that is what makes
 *     the log viewer virtualisable at all — a window of rows plus two spacers only lands on the
 *     right scroll offset if every row is the same height.
 *   · `botRow` clips rather than wraps for the same reason. The full sentence is on the row's
 *     title, one hover away, which is the house rule for a figure that cannot show everything.
 */
import { CX } from './classes';
import { ROLE, STATUS, v, type Status } from './tokens';

const r = (sel: string, decls: Record<string, string>): string =>
  sel + '{' + Object.entries(decls).map(([k, val]) => k + ':' + val).join(';') + '}';
const c = (k: keyof typeof CX): string => '.' + CX[k];

export function botsCSS(): string {
  const mono = v('--mono'), body = v('--body');
  return [
    r(c('botKill'), {
      display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: v('--sp-2'),
      padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-radius': v('--gr-r-ctl'),
      border: '1px solid ' + STATUS.bad.bd, background: STATUS.bad.bg,
      color: STATUS.bad.fg, font: '700 11.5px/1.5 ' + body,
    }),
    r(c('botKill') + '>' + c('forkKey'), { color: STATUS.bad.fg, 'white-space': 'normal', flex: '1 1 220px', font: '500 11.5px/1.55 ' + body }),
    // the log viewport: a fixed box, so `slice(from, count)` has a window to fill
    r(c('botScroll'), {
      height: '320px', 'overflow-y': 'auto', 'overflow-x': 'hidden',
      'border-radius': v('--gr-r-in'), border: '1px solid ' + ROLE.line, background: v('--bg-solid'),
      padding: '0 ' + v('--sp-2'), 'overscroll-behavior': 'contain',
    }),
    '@media (max-width:560px){' + c('botScroll') + '{height:260px}}',
    r(c('botSpacer'), { display: 'block', height: 'var(--h,0px)' }),
    r(c('botRow'), {
      display: 'grid', 'grid-template-columns': 'auto auto minmax(0,1fr)', gap: v('--sp-2'),
      'align-items': 'center', height: '26px', font: '500 11px/26px ' + mono, color: ROLE.ink2,
    }),
    r(c('botRow') + '>span', { overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }),
    r(c('botRow') + '>span:first-child', { color: ROLE.faint }),
    ...(Object.keys(STATUS) as Status[]).map(s => r(c('botRow') + '.' + CX[s] + '>span:nth-child(2)', { color: STATUS[s].fg })),
    r(c('botPre'), {
      display: 'block', 'max-height': '190px', 'overflow': 'auto', 'white-space': 'pre-wrap',
      'overflow-wrap': 'anywhere', font: '500 11px/1.6 ' + mono, color: ROLE.ink2,
      background: v('--bg-solid'), border: '1px solid ' + ROLE.line, 'border-radius': v('--r-xs'),
      padding: v('--sp-2'), 'user-select': 'all',
    }),
    /**
     * The curve's own canvas, and the box it sits in.
     *
     * A canvas carries an INTRINSIC width from its width attribute, and a grid item's default
     * `min-width:auto` lets that intrinsic size push the whole track wider than the viewport —
     * which is exactly what happened: the canvas sized itself from its box, the box grew to the
     * canvas, and on a 393 px phone the pair settled at 743 px. `min-width:0` on the box and
     * `max-width:100%` on the canvas break that loop from both ends.
     */
    r(c('botWrap'), { display: 'grid', 'grid-template-columns': 'minmax(0,1fr)', gap: v('--sp-3'), 'min-width': '0', 'max-width': '100%' }),
    // Deliberately NO `width:100%`: the drawing is sized in script to the narrowest box that
    // actually clips it, and a percentage width would stretch that backing store back out to a
    // track the Build tab has already over-sized — a blurry chart with its right half cut off.
    r(c('botCanvas'), {
      display: 'block', 'max-width': '100%', 'min-width': '0', 'box-sizing': 'border-box',
      'border-radius': v('--gr-r-ctl'), border: '1px solid ' + ROLE.line, background: ROLE.surface2,
    }),
    r(c('botSw'), {
      display: 'inline-block', width: '10px', height: '10px', 'border-radius': '3px',
      background: 'var(--c,currentColor)', 'vertical-align': '-1px', 'margin-right': '6px',
    }),
  ].join('');
}
