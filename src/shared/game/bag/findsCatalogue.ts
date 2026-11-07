import type { FindsView } from '../../../client/game/bag/bag';
import type { IconId } from '@wildshard/engine/ui/icons';

type FindFlags = readonly string[] | { readonly prefix: string; readonly count: number };
/** Flag/ownership-backed sticker metadata; renderFinds remains the presentation owner. */
export interface FindsCatalogueRows<Id extends string> {
  readonly counters: readonly { readonly label: string; readonly flags: FindFlags }[];
  readonly sections: readonly { readonly title: string; readonly dense?: boolean; readonly wide?: boolean;
    readonly items: readonly ({ readonly label: string; readonly icon: IconId; readonly prize?: readonly string[] }
      & ({ readonly flag: string } | { readonly owned: Id }))[] }[];
  readonly glass?: { readonly flags: FindFlags; readonly colors: readonly string[]; readonly fallback: string };
  readonly next?: { readonly counter: number; readonly every: number; readonly max: number; readonly text: string };
}

/** Prepare bounded static metadata once; every menu read observes the current flags and ownership. */
export function createFindsCatalogue<Id extends string>(rows: FindsCatalogueRows<Id>):
  (ports: { flags: { has: (flag: string) => boolean }; owned?: { has: (id: Id) => boolean } }) => FindsView {
  const flagsOf = (value: FindFlags): readonly string[] => {
    const flags = 'prefix' in value ? (() => {
      if (!Number.isInteger(value.count) || value.count < 0 || value.count > 256 || value.prefix.length === 0) throw new Error('Invalid finds flag range');
      return Array.from({ length: value.count }, (_, i) => `${value.prefix}${String(i + 1)}`);
    })() : [...value];
    if (flags.length > 256 || flags.some(flag => flag.length === 0 || flag.length > 256)) throw new Error('Invalid finds flags');
    return flags;
  };
  if (rows.counters.length > 32 || rows.sections.length > 32 || rows.sections.some(section => section.items.length > 256)) throw new Error('Finds catalogue exceeds capacity');
  const counters = rows.counters.map(row => ({ label: row.label, flags: flagsOf(row.flags) }));
  const glass = rows.glass === undefined ? undefined : { ...rows.glass, flags: flagsOf(rows.glass.flags), colors: [...rows.glass.colors] };
  if (glass !== undefined && (glass.colors.length === 0 || glass.colors.length > 256)) throw new Error('Invalid finds colors');
  const next = rows.next === undefined ? undefined : { ...rows.next };
  if (next !== undefined && (!Number.isInteger(next.counter) || counters[next.counter] === undefined
    || !Number.isSafeInteger(next.every) || next.every <= 0 || !Number.isSafeInteger(next.max) || next.max < 0)) throw new Error('Invalid finds milestone');
  const sections = rows.sections.map(section => ({ ...section, items: section.items.map(item => {
    if ('flag' in item ? item.flag.length === 0 || 'owned' in item : item.owned.length === 0) throw new Error('Invalid finds item source');
    return { ...item, ...(item.prize === undefined ? {} : { prize: [...item.prize] }) };
  }) }));
  const needsOwned = sections.some(section => section.items.some(item => 'owned' in item));
  return ports => {
    const owned = ports.owned;
    if (needsOwned && owned === undefined) throw new Error('Finds catalogue needs ownership');
    const counts = counters.map(row => ({ label: row.label, n: row.flags.filter(flag => ports.flags.has(flag)).length, of: row.flags.length }));
    const threshold = next === undefined ? null : (Math.floor((counts[next.counter]?.n ?? 0) / next.every) + 1) * next.every;
    return { counters: counts, next: next === undefined || threshold === null || threshold > next.max ? null : `${next.text} ${String(threshold)}`,
      sections: sections.map(({ title, dense, wide, items }) => {
        const section: FindsView['sections'][number] = { title, items: items.map(item => {
          const sticker: FindsView['sections'][number]['items'][number] = {
            label: item.label, icon: item.icon,
            found: 'flag' in item ? ports.flags.has(item.flag) : owned?.has(item.owned) === true };
          if (item.prize !== undefined) sticker.prize = [...item.prize];
          return sticker;
        }) };
        if (dense !== undefined) section.dense = dense;
        if (wide !== undefined) section.wide = wide;
        return section;
      }),
      glass: glass?.flags.map((flag, i) => ({ found: ports.flags.has(flag), color: glass.colors[i % glass.colors.length] ?? glass.fallback })) ?? [] };
  };
}
