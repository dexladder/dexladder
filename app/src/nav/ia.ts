/**
 * The information architecture, as data. Six destinations — the only primary navigation the
 * app has — each opening onto its sections. Every legacy route still exists (shared links and
 * the gates use them); this file decides where each one LIVES.
 *
 *   Terminal · Markets/Screener · Portfolio · Academy & Hub · Explorer · P2P
 *
 * Academy & Hub absorbs what used to be scattered: Learn, the Blog (long-form), Discover (editorial), the Town Square,
 * the Journey hub (quests, XP, streaks), the daily macro challenge and the Satoshi monument.
 */

export type DestinationId = 'terminal' | 'markets' | 'portfolio' | 'academy' | 'explorer' | 'p2p';

export interface Section {
  readonly id: string;
  readonly label: string;
  /** a legacy route (page-<route>) … */
  readonly route?: string;
  /** … or a legacy global function that opens the section in place */
  readonly action?: string;
  readonly hint?: string;
}

export interface Destination {
  readonly id: DestinationId;
  readonly label: string;
  /** the route the destination opens on */
  readonly home: string;
  /** the hash a link to the destination uses */
  readonly hash: string;
  readonly icon: string;
  readonly sections: readonly Section[];
}

const I = (d: string) => d; // icon paths are 24×24 stroke art, currentColor
const S = 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const DESTINATIONS: readonly Destination[] = [
  { id: 'terminal', label: 'Terminal', home: 'coin', hash: '#/terminal',
    icon: I(`<path d="M7 3.5v17M17 5v14" ${S}/><rect x="4.4" y="7.5" width="5.2" height="8" rx="1.2" ${S}/><rect x="14.4" y="9" width="5.2" height="5.5" rx="1.2" ${S}/>`),
    sections: [{ id: 'trade', label: 'Trade', route: 'coin' }] },
  { id: 'markets', label: 'Markets', home: 'markets', hash: '#/markets',
    icon: I(`<path d="M4 5v15h16" ${S}/><path d="M7 14l3-3 3 2 4-6" ${S}/>`),
    sections: [
      { id: 'screener', label: 'Screener', route: 'markets' },
      { id: 'news', label: 'News & pulse', route: 'news' },
    ] },
  { id: 'portfolio', label: 'Portfolio', home: 'portfolio', hash: '#/portfolio',
    icon: I(`<rect x="3" y="6.2" width="18" height="12.6" rx="2.4" ${S}/><path d="M3 10h13.5a1.9 1.9 0 0 1 0 3.8H3" ${S}/>`),
    sections: [{ id: 'book', label: 'Book', route: 'portfolio' }] },
  { id: 'academy', label: 'Academy', home: 'learn', hash: '#/learn',
    icon: I(`<path d="M12 5L3 9l9 4 9-4-9-4z" ${S}/><path d="M6.6 11.2v4c0 1.2 2.4 2.3 5.4 2.3s5.4-1.1 5.4-2.3v-4" ${S}/>`),
    sections: [
      { id: 'learn', label: 'Lessons', route: 'learn' },
      { id: 'blog', label: 'Blog', route: 'blog', hint: 'Long-form guides to how DexLadder works' },
      { id: 'discover', label: 'Discover', route: 'discover' },
      { id: 'community', label: 'Town Square', route: 'community' },
      { id: 'journey', label: 'Journey & quests', action: 'DLHUB.open', hint: 'Levels, XP, streaks and the first-flight quest' },
      { id: 'daily', label: 'Daily challenge', action: 'openDaily', hint: 'The 60-second macro hedge scenario' },
      { id: 'rewind', label: 'Rewind', action: 'DLREWIND.open', hint: 'Replay real history bar by bar and trade it' },
      { id: 'bots', label: 'Bots', action: 'DLBOTS.open', hint: 'Build a bot from rules, or bring your own, and race it against buy-and-hold' },
      { id: 'monument', label: 'Monument', action: 'openSatoshi3D', hint: 'Satoshi · the monument' },
    ] },
  { id: 'explorer', label: 'Explorer', home: 'explorer', hash: '#/explorer',
    icon: I(`<circle cx="11" cy="11" r="6.4" ${S}/><path d="M19.8 19.8l-4.3-4.3" ${S}/>`),
    sections: [{ id: 'chains', label: 'Chains', route: 'explorer' }] },
  { id: 'p2p', label: 'P2P', home: 'p2p', hash: '#/p2p',
    icon: I(`<path d="M4 9h12.5m0 0l-3-3M16.5 9l-3 3" ${S}/><path d="M20 15H7.5m0 0l3-3M7.5 15l3 3" ${S}/>`),
    sections: [{ id: 'bazaar', label: 'Bazaar', route: 'p2p' }] },
];

/** Where a legacy route lives. Unknown routes live in Markets (the legacy router's own default). */
export function destinationOf(route: string | null | undefined): Destination {
  const r = route || 'markets';
  return DESTINATIONS.find(d => d.home === r || d.sections.some(s => s.route === r)) || DESTINATIONS[1]!;
}

/** The home route of the destination a route belongs to (what the bottom bar highlights). */
export const homeRoute = (route: string | null | undefined): string => destinationOf(route).home;

export const hasSections = (d: Destination): boolean => d.sections.length > 1;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Static header links — generated into the payload at build time, so the header paints complete. */
export function navMarkup(activeHome = 'markets'): string {
  return DESTINATIONS.map(d =>
    `<a data-nav="${d.home}" data-dest="${d.id}"${d.home === activeHome ? ' class="active" aria-current="page"' : ''} href="${d.hash}" onclick="nav('${d.home}')">${esc(d.label)}</a>`).join('\n    ');
}

/** The mobile bottom bar's item list, in the legacy NAVITEMS shape [route, label, svg-inner]. */
export function bottomItems(): [string, string, string][] {
  return DESTINATIONS.map(d => [d.home, d.label, d.icon]);
}
