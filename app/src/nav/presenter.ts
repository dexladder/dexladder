/**
 * useNavigation — keeps every piece of navigation chrome in step with the current route:
 * the header links, the mobile bottom bar, and the section strip at the top of each page of a
 * multi-section destination. The legacy router stays the router; this only listens to it.
 */
import { destinationOf, hasSections, DESTINATIONS, type Destination } from './ia';
import { SectionStrip } from '../components/domain/section-strip';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any;
const HOST = 'dlx-sections-host';

function callAction(path: string): void {
  const parts = path.split('.');
  let fn: any = G, self: any = G;
  for (const p of parts) { self = fn; fn = fn ? fn[p] : undefined; }
  if (typeof fn === 'function') { try { fn.call(self); } catch { /* the section's own module reports its errors */ } }
}

export function go(d: Destination, sectionId: string): void {
  const s = d.sections.find(x => x.id === sectionId);
  if (!s) return;
  if (s.route) { if (typeof G.nav === 'function') G.nav(s.route); }
  else if (s.action) callAction(s.action);
}

function syncHeader(route: string): void {
  const home = destinationOf(route).home;
  document.querySelectorAll<HTMLElement>('#navlinks a[data-nav]').forEach(a => {
    const on = a.dataset.nav === home;
    a.classList.toggle('active', on);
    a.setAttribute('aria-current', on ? 'page' : 'false');   // same convention as the payload's a11y pass
  });
  document.querySelectorAll<HTMLElement>('#nxbn [data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === home ? 'page' : 'false'));
}

function syncSections(route: string): void {
  const d = destinationOf(route);
  const page = document.getElementById('page-' + route);
  if (!page || !hasSections(d)) return;
  let host = page.querySelector('.' + HOST) as HTMLElement | null;
  if (!host) {
    host = document.createElement('div');
    host.className = HOST;
    const wrap = page.querySelector(':scope > .wrap') || page;
    wrap.insertBefore(host, wrap.firstChild);
  }
  host.replaceChildren(SectionStrip(d, route, id => go(d, id)));
}

/** Called after every legacy nav(view). */
export function sync(route: string): void {
  try { syncHeader(route); syncSections(route); } catch { /* chrome must never break navigation */ }
}

/** Wrap the legacy nav() once, from the payload, after it is defined. */
export function install(): void {
  if (G.__dlxNav || typeof G.nav !== 'function') return;
  const legacyNav = G.nav;
  const wrapped = function (this: unknown, view: string) {
    const r = legacyNav.apply(this, arguments as any);
    sync(view);
    return r;
  };
  Object.assign(wrapped, legacyNav);
  G.nav = wrapped;
  G.__dlxNav = 1;
  const cur = (document.querySelector('.page.active')?.id || 'page-markets').replace('page-', '');
  sync(cur);
}

export { DESTINATIONS, destinationOf };
