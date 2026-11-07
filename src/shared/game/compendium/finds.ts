/**
 * A compendium as the Bag's FINDS tab (E314, Jake's pick C for Pine Hollow: "JOURNAL becomes FINDS"). The shared FINDS
 * sticker book (src/client/game/bag/bag.ts renderFinds) shows the journal's contents: the counters (beasts / elites taken, places
 * visited, trophies on the wall), one sticker section per journal tab (found = seen or visited, bright; the rest a
 * dashed ???) and the trophy wall's slots. Every sticker opens the full journal on its page; the OPEN row on top opens
 * it where you left it.
 *
 *   menu.setFinds(() => compendiumFinds(state, (id) => journal.open(id)));   // src/client/game/compendium/install.ts
 */
import type { FindsView } from '../../../client/game/bag/bag';
import type { IconId } from '@wildshard/engine/ui/icons';
import type { CompendiumState } from './state';
import type { EntryDef } from './types';

/** a sticker's glyph: the content's (the skin's `icon`), a pin for a place, a dot otherwise */
function iconOf(skin: CompendiumState['def']['skin'], e: EntryDef): IconId {
  return skin.icon?.(e) ?? (e.kind === 'place' ? 'pin' : 'poi');
}

export function compendiumFinds(state: CompendiumState, open: (entryId?: string) => void): FindsView {
  const skin = state.def.skin;
  const found = (e: EntryDef): boolean => state.reached(e.id, 'seen');
  const counters: FindsView['counters'] = [];
  const sections: FindsView['sections'] = [];
  for (const t of skin.tabs) {
    if (t.id === skin.trophyTab) continue;
    const list = state.tab(t.id);
    if (list.length === 0) continue;
    const places = list.every((e) => e.kind === 'place');
    // animals count TAKEN (the journal's stamp), places VISITED
    counters.push({ label: t.label, n: places ? list.filter(found).length : state.count(t.id, 'taken'), of: list.length });
    sections.push({ title: t.label, dense: list.length > 12, items: list.map((e) => ({ id: e.id, label: e.name, icon: iconOf(skin, e), found: found(e) })) });
  }
  const slots = state.def.trophies ?? [];
  if (slots.length > 0) {
    const items = slots.flatMap((s) => {
      const e = state.entry(s.entry);
      return e ? [{ id: e.id, label: e.name, icon: iconOf(skin, e), found: state.state(e.id) === 'taken' }] : [];
    });
    counters.push({ label: skin.tabs.find((t) => t.id === skin.trophyTab)?.label ?? 'Trophies', n: items.filter((i) => i.found).length, of: items.length });
    sections.push({ title: 'Trophy wall', items });
  }
  return {
    counters, next: null, sections, glass: [],
    open: { title: skin.title, sub: 'Every page, its sketch and notes', onPick: () => { open(); } },
    onPick: (id) => { open(id); },
    hint: 'Tap a find to open its journal page',
  };
}
