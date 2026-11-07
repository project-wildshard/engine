import type { FindsCatalogueRows } from '../bag/findsCatalogue';
import { parseLootEconomy, parseBarterEconomy, type BarterEconomy, type LootEconomy } from '@wildshard/format/lootEconomy';
import { isOwnedId, isCosmetic, type OwnedId, type CosmeticId } from '../loot/Owned';
import { Weather, type WeatherProfile } from '@wildshard/engine/world/weather';
import { DayCycle } from '@wildshard/engine/world/dayCycle';
import type { Rng } from '@wildshard/engine/core/rng';
import type { ShardCompendium, EntryDef, EntryStats } from '../compendium/types';
import type { JournalRow } from '@wildshard/format/compendiumRows';
import type { ShardProduct } from '../shardfile/shardProduct';
import { outputDescriptor } from '../shardfile/outputDescriptor';
import type { LootPresentation } from '../../../client/game/loot/runtime';
import type { ShardRows } from '@wildshard/format/rows';
import { sketchReference, type CompendiumSketch } from '@wildshard/format/sketch';

/** Expand a table of authored outputs into the existing seeded weather mechanism. */
export function declaredWeather(row: ShardRows['weather'][number], rng: Rng): Weather {
  const states = new Map(row.states.map((state) => [state.id, state]));
  const profile: WeatherProfile = { states: row.states.map((state) => state.id), next: Object.fromEntries(row.states.map((state) => [state.id, state.next])),
    length: Object.fromEntries(row.states.map((state) => [state.id, state.length])), soak: row.soak, dry: row.dry,
    initial: () => ({ ...row.initial }), numbers: ({ state }) => {
      const selected = states.get(state); if (selected === undefined) throw new Error('Unknown declared weather state'); return { ...selected.numbers };
    }, modes: Object.fromEntries(row.modes.map((mode) => [mode.id, mode.hold === null ? 'none' : { hold: mode.hold, at: mode.at, dry: mode.dry }])) };
  return new Weather(profile, rng);
}
/** A complete authored hour schedule runs the existing engine day clock. */
export function declaredDay(row: ShardRows['days'][number]): DayCycle { return new DayCycle(row); }
/** Constant stamp/stat data supplies the existing compendium without authored closures. */
export function declaredCompendium(row: ShardRows['compendiums'][number], rows: ShardRows, chunkId: string, sketchData?: (ref: string) => string): ShardCompendium {
  if ('kind' in row) return declaredJournal(row, sketchData);
  const kinds = new Map(rows.species.map((species) => [species.id, species.kind]));
  return { chunkId, skin: { className: row.className, title: row.title, tabs: row.tabs, stamp: () => row.stamp, stats: () => row.stats.map((stat) => ({ ...stat })) },
    entries: row.entries.map(({ sketch, species, ...entry }) => {
      const kind = kinds.get(species); if (kind === undefined) throw new Error('Unknown compendium species');
      if (sketchData === undefined && (!sketch.startsWith('data:image/svg+xml,') || !sketchReference(sketch))) throw new Error('Compendium hash or unsafe SVG requires admitted sketch data');
      return { ...entry, plate: { sketch: sketchData?.(sketch) ?? sketch }, match: { kind } };
    }) };
}
/** Evaluate bounded display selectors against existing journal state, without authored functions. */
function journalStats(rules: JournalRow['stats']['default'], entry: EntryDef, state: EntryStats): { label: string; value: string }[] {
  return rules.map(rule => {
    let value: string;
    switch (rule.value) {
      case 'seen': value = String(state.seen); break;
      case 'taken': value = String(state.taken); break;
      case 'best': value = state.best > 0 ? `${state.best}${rule.suffix ?? ''}` : rule.fallback ?? ''; break;
      case 'rarity': value = state.state !== 'unknown' && entry.rarity !== undefined ? rule.words?.[entry.rarity] ?? entry.rarity : rule.fallback ?? ''; break;
      case 'status': value = rule.words?.[state.state] ?? rule.fallback ?? ''; break;
      default: throw new Error('Unknown journal stat selector');
    }
    return { label: rule.label, value };
  });
}
function declaredJournal(row: JournalRow, image?: (ref: string) => string): ShardCompendium {
  if (image === undefined) throw new Error('Rich journal requires admitted image URLs');
  const entries = row.entries.map(entry => ({ ...entry, plate: { ...entry.plate, sketch: image(entry.plate.sketch),
    ...(entry.plate.silhouette === undefined ? {} : { silhouette: image(entry.plate.silhouette) }) } }));
  return { chunkId: row.chunkId, skin: { className: row.className, title: row.title, tabs: row.tabs,
    ...(row.trophyTab === undefined ? {} : { trophyTab: row.trophyTab }),
    stamp: entry => entry.kind === 'place' ? row.stamp.place : row.stamp.default,
    icon: entry => row.icons.find(rule => (rule.entryKind === undefined || rule.entryKind === entry.kind)
      && (rule.matchKind === undefined || rule.matchKind === entry.match?.kind))?.icon,
    stats: (entry, state) => journalStats(entry.kind === 'place' ? row.stats.place : row.stats.default, entry, state),
    ...(row.chalk === undefined ? {} : { chalk: { ...row.chalk, atlas: image(row.chalk.atlas) } }) }, entries,
    ...(row.trophies === undefined ? {} : { trophies: row.trophies }), ...(row.wall === undefined ? {} : { wall: row.wall }) };
}
/** Resolve images through the product's logical blob inventory, never adjacent URL guesses.
 * Vector rows use an already-admitted sketch map or their bounded inline data. */
export function declaredProductCompendium(product: ShardProduct, id: string, sketches: ReadonlyMap<string, CompendiumSketch> = new Map()): ShardCompendium {
  const rows = product.shardfile.rows, row = product.section('ui/compendium').rows.compendiums.find(value => value.id === id);
  if (row === undefined) throw new Error('Missing admitted compendium row');
  return declaredCompendium(row, rows, product.slug, ref => {
    if (!('kind' in row)) {
      const sketch = sketches.get(ref); if (sketch !== undefined) return sketch.data;
      if (ref.startsWith('data:image/svg+xml,') && sketchReference(ref)) return ref;
      throw new Error('Missing admitted compendium sketch');
    }
    const file = outputDescriptor(product.shardfile)?.index.files.find(value => value.hash === ref);
    if (file?.kind !== 'image' || file.name === undefined) throw new Error('Journal image has no admitted logical name');
    return product.url(file.name);
  });
}
/** Presentation uses the existing purse and a registered cue; data cannot install callbacks. */
export function declaredLootPresentation(row: Extract<ShardRows['loot'][number], { gear: string }>, cue: (id: string) => void): LootPresentation {
  return { gear: (purse) => ({ coins: purse.coins }), finds: null, marks: null, charted: () => row.charted, chime: () => { cue(row.chime); } };
}

type EconomyGrant<K extends OwnedId> = Omit<LootEconomy['grants']['player'][number], 'key' | 'unless'> & { key: K; unless?: K[] };
/** Economy metadata with identifiers admitted by the existing ownership service. */
export interface DeclaredLootEconomy extends Omit<LootEconomy, 'goods' | 'grants' | 'finds'> {
  progression: { flags: string[]; states: { earned: { id: OwnedId; text: string }[]; displayCount: number; next: number | null }[]; glow: { owned: OwnedId; curve: NonNullable<LootEconomy['progression']>['glow']['curve'] } };
  goods: (Omit<LootEconomy['goods'][number], 'id' | 'needs'> & { id: OwnedId; needs?: OwnedId })[];
  grants: { player: EconomyGrant<OwnedId>[]; worn: EconomyGrant<CosmeticId>[]; weapons: EconomyGrant<OwnedId>[] };
  finds: FindsCatalogueRows<OwnedId>;
}
/** Resolve portable economy rows before any live state is touched. The current Owned service remains authoritative. */
export function declaredLootEconomy(rows: ShardRows['loot'], kind: 'barter'): BarterEconomy;
export function declaredLootEconomy(rows: ShardRows['loot']): DeclaredLootEconomy;
export function declaredLootEconomy(rows: ShardRows['loot'], kind?: 'barter'): DeclaredLootEconomy | BarterEconomy {
  const sources = rows.filter(row => row.economy !== undefined);
  if (sources.length !== 1) throw new Error('Exactly one admitted economy payload is required');
  if (kind === 'barter') return parseBarterEconomy(sources[0]?.economy);
  const economy = parseLootEconomy(sources[0]?.economy);
  const owned = (id: string): OwnedId => { if (!isOwnedId(id)) throw new Error('Unknown economy ownership'); return id; };
  const worn = (id: string): CosmeticId => { const key = owned(id); if (!isCosmetic(key)) throw new Error('Economy worn grant requires a cosmetic'); return key; };
  const grants = <K extends OwnedId>(entries: LootEconomy['grants']['player'], key: (id: string) => K) => entries.map(({ key: id, unless, ...row }) => ({ ...row, key: key(id), ...(unless === undefined ? {} : { unless: unless.map(key) }) }));
  const progression = economy.progression;
  if (progression === undefined) throw new Error('Missing economy progression');
  return { ...economy, goods: economy.goods.map(({ id, needs, ...good }) => ({ ...good, id: owned(id), ...(needs === undefined ? {} : { needs: owned(needs) }) })),
    progression: { ...progression, states: progression.states.map(state => ({ ...state, earned: state.earned.map(reward => ({ ...reward, id: owned(reward.id) })) })), glow: { ...progression.glow, owned: owned(progression.glow.owned) } },
    grants: { player: grants(economy.grants.player, owned), worn: grants(economy.grants.worn, worn), weapons: grants(economy.grants.weapons, owned) },
    finds: { ...economy.finds, sections: economy.finds.sections.map(section => {
      const items = section.items.map(item => {
        const sticker: FindsCatalogueRows<OwnedId>['sections'][number]['items'][number] = 'owned' in item
          ? { label: item.label, icon: item.icon, owned: owned(item.owned) } : { label: item.label, icon: item.icon, flag: item.flag };
        if (item.prize !== undefined) return Object.assign(sticker, { prize: item.prize });
        return sticker;
      });
      const result: FindsCatalogueRows<OwnedId>['sections'][number] = { title: section.title, items };
      return Object.assign(result, section.dense === undefined ? {} : { dense: section.dense }, section.wide === undefined ? {} : { wide: section.wide });
    }) } };
}
