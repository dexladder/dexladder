/**
 * The blog's reading experience — written once, from tokens only (same rules as components.ts).
 * A measured column (--measure), a comfortable line height, a sticky table of contents on wide
 * screens that folds into the top of the article on narrow ones. Day and Night come from tokens.
 */
import { CX } from './classes';
import { ROLE, STATUS, v } from './tokens';

const r = (sel: string, decls: Record<string, string>): string =>
  sel + '{' + Object.entries(decls).map(([k, val]) => k + ':' + val).join(';') + '}';
const c = (k: keyof typeof CX): string => '.' + CX[k];
const focus = { outline: '2px solid ' + ROLE.info, 'outline-offset': '2px', 'border-radius': v('--r-xs') };

export function blogCSS(): string {
  const body = v('--body'), disp = v('--disp'), mono = v('--mono');
  const link = { color: ROLE.info, 'text-decoration': 'underline', 'text-underline-offset': '3px', 'text-decoration-thickness': '1px' };
  return [
    r(c('blog'), { display: 'grid', gap: v('--sp-6'), 'padding-bottom': v('--sp-12') }),
    r(c('blog') + ' a:focus-visible,' + c('article') + ' a:focus-visible,' + c('article') + ' summary:focus-visible', focus),
    // index
    r(c('blogHead'), { display: 'grid', gap: v('--sp-2'), 'max-width': v('--measure') }),
    r(c('blogKicker'), { font: '700 11px/1.4 ' + body, 'letter-spacing': '.14em', 'text-transform': 'uppercase', color: ROLE.muted }),
    r(c('blogTitle'), { font: '800 clamp(26px,3.2vw,36px)/1.15 ' + disp, color: ROLE.ink, margin: '0', 'letter-spacing': '-.01em' }),
    r(c('blogLede'), { font: '400 16px/1.65 ' + body, color: ROLE.ink2, margin: '0' }),
    r(c('blogNote'), { font: '400 14px/1.6 ' + body, color: ROLE.ink2, padding: v('--sp-3') + ' ' + v('--sp-4'), 'border-radius': v('--gr-r-ctl'), background: STATUS.warn.bg, border: '1px solid ' + STATUS.warn.bd }),
    r(c('blogGrid'), { display: 'grid', gap: v('--sp-4'), 'grid-template-columns': 'repeat(auto-fill,minmax(min(100%,300px),1fr))' }),
    r(c('blogCard'), { display: 'grid', 'align-content': 'start', gap: v('--sp-2'), padding: v('--sp-5'), background: ROLE.surface, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-panel'), 'box-shadow': v('--gr-shadow'), 'text-decoration': 'none', color: 'inherit', transition: 'border-color .15s,transform .15s' }),
    r(c('blogCard') + ':hover', { 'border-color': ROLE.line2, transform: 'translateY(-1px)' }),
    r(c('blogFeature'), { 'grid-column': '1/-1', padding: v('--sp-6') }),
    r(c('blogCardTitle'), { font: '700 18px/1.3 ' + disp, color: ROLE.ink, margin: '0' }),
    r(c('blogFeature') + ' ' + c('blogCardTitle'), { 'font-size': 'clamp(20px,2.4vw,26px)' }),
    r(c('blogCardText'), { font: '400 14.5px/1.6 ' + body, color: ROLE.ink2, margin: '0' }),
    r(c('blogFeature') + ' ' + c('blogCardText'), { 'font-size': '16px', 'max-width': v('--measure') }),
    r(c('blogMeta'), { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: v('--sp-2'), font: '500 12.5px/1.5 ' + body, color: ROLE.muted }),
    // article
    r(c('artCrumb'), { display: 'flex', gap: v('--sp-2'), 'align-items': 'center', font: '600 13px/1.4 ' + body, color: ROLE.muted }),
    r(c('artCrumb') + ' a', link),
    r(c('artHead'), { display: 'grid', gap: v('--sp-3'), 'max-width': v('--measure'), 'padding-bottom': v('--sp-5'), 'border-bottom': '1px solid ' + ROLE.line }),
    r(c('artTitle'), { font: '800 clamp(28px,4vw,42px)/1.12 ' + disp, color: ROLE.ink, margin: '0', 'letter-spacing': '-.015em' }),
    r(c('artLede'), { font: '400 clamp(17px,1.6vw,19px)/1.6 ' + body, color: ROLE.ink2, margin: '0' }),
    r(c('artLayout'), { display: 'grid', gap: v('--sp-8'), 'grid-template-columns': 'minmax(0,1fr)', 'align-items': 'start' }),
    '@media (min-width:1100px){' + r(c('artLayout'), { 'grid-template-columns': 'minmax(0,' + v('--measure') + ') 240px', 'justify-content': 'space-between' }) +
      r(c('toc'), { position: 'sticky', top: '156px', order: '2', 'max-height': 'calc(100vh - 180px)', overflow: 'auto' }) + '}',
    r(c('toc'), { background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-ctl'), padding: v('--sp-3') + ' ' + v('--sp-4') }),
    r(c('tocTitle'), { font: '700 11px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.muted, cursor: 'pointer' }),
    r(c('tocList'), { margin: v('--sp-2') + ' 0 0', padding: '0', 'list-style': 'none', display: 'grid', gap: '2px' }),
    r(c('tocList') + ' a', { display: 'block', padding: v('--sp-1') + ' 0', font: '500 13.5px/1.45 ' + body, color: ROLE.ink2, 'text-decoration': 'none' }),
    r(c('tocList') + ' a:hover', { color: ROLE.info }),
    // prose
    r(c('prose'), { 'min-width': '0', 'max-width': v('--measure'), font: '400 17px/1.75 ' + body, color: ROLE.ink2, 'overflow-wrap': 'anywhere' }),
    r(c('prose') + '>*', { margin: '0 0 ' + v('--sp-5') }),
    r(c('prose') + ' h2', { font: '750 clamp(21px,2.2vw,25px)/1.3 ' + disp, color: ROLE.ink, margin: v('--sp-10') + ' 0 ' + v('--sp-3'), 'scroll-margin-top': '160px' }),
    r(c('prose') + ' h3', { font: '700 18.5px/1.35 ' + disp, color: ROLE.ink, margin: v('--sp-6') + ' 0 ' + v('--sp-2'), 'scroll-margin-top': '160px' }),
    r(c('prose') + ' b', { color: ROLE.ink, 'font-weight': '650' }),
    r(c('prose') + ' a', link),
    r(c('prose') + ' ul,' + c('prose') + ' ol', { 'padding-left': '1.3em', display: 'grid', gap: v('--sp-2') }),
    r(c('prose') + ' li::marker', { color: ROLE.muted }),
    r(c('prose') + ' code', { font: '500 .88em/1.4 ' + mono, background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': '6px', padding: '1px 5px', color: ROLE.ink }),
    r(c('prose') + ' pre', { overflow: 'auto', padding: v('--sp-4'), background: ROLE.surface2, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-ctl'), font: '500 14px/1.6 ' + mono, color: ROLE.ink }),
    r(c('prose') + ' hr', { border: '0', 'border-top': '1px solid ' + ROLE.line, margin: v('--sp-8') + ' 0' }),
    r(c('callout'), { margin: '0 0 ' + v('--sp-5'), padding: v('--sp-4') + ' ' + v('--sp-5'), background: STATUS.info.bg, border: '1px solid ' + STATUS.info.bd, 'border-left-width': '4px', 'border-radius': v('--gr-r-ctl'), color: ROLE.ink, font: '500 16px/1.65 ' + body }),
    r(c('proseTable'), { overflow: 'auto', border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-ctl') }),
    r(c('proseTable') + ' table', { width: '100%', 'min-width': '0', 'border-collapse': 'collapse', font: '400 14.5px/1.5 ' + body }),
    r(c('proseTable') + ' th', { 'text-align': 'left', font: '700 12px/1.4 ' + body, 'letter-spacing': '.06em', 'text-transform': 'uppercase', color: ROLE.muted, background: ROLE.surface2 }),
    r(c('proseTable') + ' th,' + c('proseTable') + ' td', { padding: v('--sp-2') + ' ' + v('--sp-3'), 'border-bottom': '1px solid ' + ROLE.line, 'vertical-align': 'top', 'text-align': 'left', 'white-space': 'normal', 'font-size': 'inherit', 'min-width': '7em' }),
    r(c('proseTable') + ' tr:last-child td', { 'border-bottom': '0' }),
    // prev / next
    r(c('artNav'), { display: 'grid', gap: v('--sp-3'), 'grid-template-columns': 'repeat(auto-fit,minmax(min(100%,240px),1fr))', 'max-width': v('--measure'), 'padding-top': v('--sp-6'), 'border-top': '1px solid ' + ROLE.line }),
    r(c('artNavLink'), { display: 'grid', gap: v('--sp-1'), padding: v('--sp-4'), background: ROLE.surface, border: '1px solid ' + ROLE.line, 'border-radius': v('--gr-r-ctl'), 'text-decoration': 'none', color: ROLE.ink, font: '700 15px/1.35 ' + disp }),
    r(c('artNavLink') + ':hover', { 'border-color': ROLE.info }),
    r(c('artNavDir'), { font: '700 11px/1.4 ' + body, 'letter-spacing': '.12em', 'text-transform': 'uppercase', color: ROLE.muted }),
    // ---- figures: covers and in-article diagrams (components/domain/figures)
    r(c('cover'), { display: 'block', width: '100%', height: 'clamp(132px,17vw,196px)', 'border-radius': v('--gr-r-panel'), overflow: 'hidden', background: ROLE.surface2, border: '1px solid ' + ROLE.line }),
    r(c('coverCard'), { height: '108px', 'margin-bottom': v('--sp-1') }),
    r(c('fig'), { display: 'grid', gap: v('--sp-2'), margin: v('--sp-6') + ' 0' }),
    r(c('figCanvas'), { display: 'block', width: '100%', 'aspect-ratio': '16/9', 'max-height': '330px', 'border-radius': v('--gr-r-ctl'), background: ROLE.surface2, border: '1px solid ' + ROLE.line }),
    r(c('coverArt') + ',' + c('figArt'), { display: 'block', width: '100%', height: '100%' }),
    r(c('figCap'), { font: '500 13px/1.5 ' + body, color: ROLE.muted, margin: '0' }),
    // paint (colour first, geometry modifiers after, so a stroked shape wins its fill:none)
    r(c('fInk'), { fill: ROLE.ink, stroke: ROLE.ink }),
    r(c('fMuted'), { fill: ROLE.muted, stroke: ROLE.muted }),
    r(c('fLine'), { fill: ROLE.line, stroke: ROLE.line }),
    r(c('fGrid'), { fill: 'none', stroke: ROLE.line, 'stroke-width': '1', opacity: '.4' }),
    r(c('fSurface'), { fill: ROLE.surface, stroke: ROLE.line }),
    r(c('fAcc'), { fill: ROLE.info, stroke: ROLE.info }),
    r(c('fAcc2'), { fill: v('--indigo'), stroke: v('--indigo') }),
    r(c('fWarm'), { fill: ROLE.warn, stroke: ROLE.warn }),
    r(c('fGain'), { fill: ROLE.gain, stroke: ROLE.gain }),
    r(c('fLoss'), { fill: ROLE.loss, stroke: ROLE.loss }),
    r(c('fStroke'), { fill: 'none', 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    r(c('fThin'), { fill: 'none', 'stroke-width': '1.4', 'stroke-linecap': 'round' }),
    r(c('fDash'), { fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-dasharray': '6 7', opacity: '.85' }),
    r(c('fLabel'), { font: '700 11px/1 ' + body, 'letter-spacing': '.08em', stroke: 'none', 'text-transform': 'uppercase' }),
    // motion — slow, looping, never more than one idea at a time
    '@keyframes dlx-flow{to{stroke-dashoffset:-160}}',
    '@keyframes dlx-pulse{0%,100%{opacity:.35;r:5}50%{opacity:1;r:8}}',
    '@keyframes dlx-drift{0%,12%{transform:translateX(0)}88%,100%{transform:translateX(26px)}}',
    '@keyframes dlx-rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
    r(c('fFlow'), { 'stroke-dasharray': '10 8', animation: 'dlx-flow 3.2s linear infinite' }),
    r(c('fPulse'), { animation: 'dlx-pulse 2.6s ' + v('--smooth') + ' infinite' }),
    r(c('fDrift'), { animation: 'dlx-drift 5.5s ' + v('--smooth') + ' infinite' }),
    r(c('fRise'), { animation: 'dlx-rise 4.4s ' + v('--smooth') + ' infinite' }),
    '@media (prefers-reduced-motion:reduce){' + r(c('fig') + ' *,' + c('cover') + ' *', { animation: 'none!important' }) + '}',
    '@media (max-width:600px){' + r(c('prose'), { 'font-size': '16.5px' }) + r(c('blogFeature'), { padding: v('--sp-5') }) + r(c('figCanvas'), { 'aspect-ratio': '4/3' }) + '}',
  ].join('');
}
