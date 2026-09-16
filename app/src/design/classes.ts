/**
 * The class registry. Every class a typed component may put on an element is named here once;
 * components import these constants instead of writing class strings, and design/components.ts
 * is the only place their rules are written. gate-arch.js fails a component that spells a class.
 */
export const CX = {
  // primitives
  pill: 'dlx-pill', badge: 'dlx-badge', card: 'dlx-card', cardHead: 'dlx-card-h', cardTitle: 'dlx-card-t', cardEyebrow: 'dlx-card-e', cardBody: 'dlx-card-b',
  stat: 'dlx-stat', statLabel: 'dlx-stat-l', statValue: 'dlx-stat-v', statHint: 'dlx-stat-h',
  row: 'dlx-row', cell: 'dlx-cell', cellNum: 'dlx-cell-n', cellEnd: 'dlx-cell-e',
  modal: 'dlx-modal', modalPanel: 'dlx-modal-p', modalHead: 'dlx-modal-h', modalBody: 'dlx-modal-b', modalClose: 'dlx-modal-x',
  tabs: 'dlx-tabs', tab: 'dlx-tab',
  field: 'dlx-field', fieldLabel: 'dlx-field-l', fieldBox: 'dlx-field-box', fieldInput: 'dlx-field-i', fieldUnit: 'dlx-field-u',
  // domain
  change: 'dlx-chg', pnl: 'dlx-pnl', preview: 'dlx-prev', previewRow: 'dlx-prev-r', previewHead: 'dlx-prev-h', previewNote: 'dlx-prev-n', previewPills: 'dlx-prev-p',
  seg: 'dlx-seg', segBtn: 'dlx-seg-b', segLabel: 'dlx-seg-l', realism: 'dlx-realism',
  sections: 'dlx-sections',
  // perpetual-futures desk
  perp: 'dlx-perp', perpLine: 'dlx-perp-l', perpGrid: 'dlx-perp-g', perpBtns: 'dlx-perp-btns', long: 'dlx-long', short: 'dlx-short',
  select: 'dlx-select', bt: 'dlx-bt', btBar: 'dlx-bt-bar', btChart: 'dlx-bt-chart', btSide: 'dlx-bt-side', btList: 'dlx-bt-list', btLine: 'dlx-bt-line', verdict: 'dlx-verdict', verdictRow: 'dlx-verdict-r',
  btn: 'dlx-btn', range: 'dlx-range', meter: 'dlx-meter', meterFill: 'dlx-meter-f', perpPos: 'dlx-perp-pos', perpHead: 'dlx-perp-h', pm: 'dlx-pm', pmList: 'dlx-pm-l',
  // blog (design/blog.ts)
  blog: 'dlx-blog', blogHead: 'dlx-blog-h', blogKicker: 'dlx-blog-k', blogTitle: 'dlx-blog-t', blogLede: 'dlx-blog-l', blogNote: 'dlx-blog-n',
  blogGrid: 'dlx-blog-g', blogCard: 'dlx-blog-c', blogFeature: 'dlx-blog-f', blogCardTitle: 'dlx-blog-ct', blogCardText: 'dlx-blog-cx', blogMeta: 'dlx-blog-m',
  article: 'dlx-art', artCrumb: 'dlx-art-cr', artHead: 'dlx-art-h', artTitle: 'dlx-art-t', artLede: 'dlx-art-l', artLayout: 'dlx-art-lay',
  toc: 'dlx-toc', tocTitle: 'dlx-toc-t', tocList: 'dlx-toc-l', artNav: 'dlx-art-nav', artNavLink: 'dlx-art-nl', artNavDir: 'dlx-art-nd',
  prose: 'dlx-prose', proseTable: 'dlx-prose-tw', callout: 'dlx-callout',
  // figures — every illustration is drawn by components/domain/figures and painted here
  fig: 'dlx-fig', figCanvas: 'dlx-fig-v', figCap: 'dlx-fig-c', cover: 'dlx-cover', coverCard: 'dlx-cover-s', coverArt: 'dlx-cover-a', figArt: 'dlx-fig-a',
  fInk: 'dlx-f-ink', fMuted: 'dlx-f-mu', fLine: 'dlx-f-li', fGrid: 'dlx-f-gr', fSurface: 'dlx-f-sf',
  fAcc: 'dlx-f-a', fAcc2: 'dlx-f-b', fWarm: 'dlx-f-w', fGain: 'dlx-f-up', fLoss: 'dlx-f-dn',
  fStroke: 'dlx-f-st', fThin: 'dlx-f-th', fDash: 'dlx-f-da', fLabel: 'dlx-f-lb',
  fFlow: 'dlx-f-flow', fPulse: 'dlx-f-pulse', fDrift: 'dlx-f-drift', fRise: 'dlx-f-rise',
  dim: 'dlx-dim',
  // fork sandbox (a pool on the trader's own node)
  forkSec: 'dlx-fk-sec', forkHead: 'dlx-fk-h', forkGrid: 'dlx-fk-g', forkKey: 'dlx-fk-k', forkVal: 'dlx-fk-v',
  forkFind: 'dlx-fk-f', forkFindHead: 'dlx-fk-fh', forkFix: 'dlx-fk-fx',
  forkBar: 'dlx-fk-bar', forkBtn: 'dlx-fk-b', forkBtnGo: 'dlx-fk-bg',
  forkLog: 'dlx-fk-log', forkLogRow: 'dlx-fk-lr', forkLogWhen: 'dlx-fk-lw',
  forkArea: 'dlx-fk-ta', forkSelect: 'dlx-fk-sel', forkOut: 'dlx-fk-out', forkWide: 'dlx-fk-wide', forkCard: 'dlx-fk-card',
  // bots desk — the kill switch, the virtualised execution log, endpoint telemetry, the curve
  botKill: 'dlx-bot-kill', botScroll: 'dlx-bot-sc', botSpacer: 'dlx-bot-sp', botRow: 'dlx-bot-row',
  botPre: 'dlx-bot-pre', botSw: 'dlx-bot-sw', botCanvas: 'dlx-bot-cv', botWrap: 'dlx-bot-wrap',
  // state modifiers (paired with a primitive)
  on: 'is-on', good: 'is-good', bad: 'is-bad', warn: 'is-warn', info: 'is-info', neutral: 'is-neutral', unavailable: 'is-na',
} as const;

export type ClassName = (typeof CX)[keyof typeof CX];
