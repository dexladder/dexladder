import { Tabs } from '../ui/tabs';
import { h } from '../ui/h';
import { CX } from '../../design/classes';
import type { Destination } from '../../nav/ia';

/**
 * The second level of navigation: the sections inside one destination (Markets → Screener ·
 * News; Academy → Learn · Discover · Community · Journey · Daily · Monument). Route sections are
 * links; action sections open their hub/sheet in place.
 */
export function SectionStrip(d: Destination, activeRoute: string, go: (sectionId: string) => void): HTMLElement {
  const active = d.sections.find(s => s.route === activeRoute)?.id ?? null;
  return h('div', { class: [CX.sections], data: { dest: d.id } },
    Tabs({
      label: d.label + ' sections',
      active,
      items: d.sections.map(s => ({ id: s.id, label: s.label, ...(s.route ? { href: '#/' + s.route } : {}), ...(s.hint ? { title: s.hint } : {}) })),
      onSelect: go,
    }));
}
