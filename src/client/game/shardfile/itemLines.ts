import type { Shardfile } from '@wildshard/format/shardSchema';

/** What a held item's fuel and light are read off and written to (`ItemRuntime`'s save state). */
export interface LineMirroredItem<S extends { readonly fuel: number; readonly lit: boolean }> { snapshot: () => S; restore: (state: S) => void }

/**
 * A held tool's fuel and light follow the owner's owned lines (`targets.itemFields`: SS-GF1a1b's lantern pickups): each call
 * writes them onto the held item, the way the server has them. One mirror for a one-shard page (`client.ts`) and a grid data
 * cell's kit (`dataCellKit.ts`), so neither misses it again. Null when the source projects no fuel or light onto a held item.
 * A line at zero is dropped from `owned`: its absence is the server's zero.
 */
export function itemLineMirror<S extends { readonly fuel: number; readonly lit: boolean }>(source: Pick<Shardfile, 'targets' | 'state'>,
  runtimes: ReadonlyMap<string, LineMirroredItem<S>>, line: (name: string) => number): (() => void) | null {
  const mirrored = (source.targets.itemFields ?? []).flatMap(row => {
    const field = source.state.player.find(entry => entry.id === row.fieldId), item = runtimes.get(row.item);
    return field === undefined || item === undefined || field.privacy === 'host' || row.property === 'taken' ? [] : [{ item, name: field.name, property: row.property }];
  });
  if (mirrored.length === 0) return null;
  return () => {
    for (const { item, name, property } of mirrored) {
      const value = line(name), now = item.snapshot();
      const fuel = property === 'fuel' ? Math.min(1, Math.max(0, value)) : now.fuel, lit = property === 'lit' ? value > 0 : now.lit;
      if (fuel !== now.fuel || lit !== now.lit) item.restore({ ...now, fuel, lit: lit && fuel > 0 });
    }
  };
}
