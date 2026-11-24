import type { ShardRows, SpeciesRow } from '@wildshard/format/rows';
import type { CreatureStrikes, ShardCreatures } from '@wildshard/format/creatures';
import type { NativePopulationRows } from '@wildshard/format/populationRoster';
import { readSpeciesPrograms, type SpeciesData, type SpeciesPrograms, type SpeciesProgramData, type SpeciesVariantData } from '@wildshard/format/speciesPrograms';
import type { NativeBossBinding } from '@wildshard/format/bossEncounter';
import { resolveCreatureLayers } from '../shardfile/creatureLayers';

/**
 * ONE-FORMAT OF30: a native host on a product with no `actors/species-programs` reads its species from the declared
 * `actors/species` rows (the reverse of the SDK's `speciesProgramToRows`): a hunt temperament's numbers are the native
 * tuning, its motion the species' motion numbers, its presentation the calls, and each variant keeps the full hp and mods
 * the engine's `variantMods` would fill. Nothing here draws, allocates or reads a callback.
 */
function variantOf(row: SpeciesRow['variants'][number]): SpeciesVariantData {
  return { id: row.id, label: row.label, weight: row.weight, rarity: row.rarity, scale: [row.scale[0], row.scale[1]], hp: row.hp, mods: { ...row.mods } };
}

type Drop = NonNullable<SpeciesRow['harvest']>[number];
/** The kind's harvest with its spawn-only rows' drops folded in, as one native row held them: a lent row's drop of an item
 *  the kind already drops for some variants adds the lent variants to that drop; one it does not drop at all is added. */
function lentHarvest(row: SpeciesRow, lent: readonly SpeciesRow[]): Drop[] {
  const drops: Drop[] = [];
  for (const drop of row.harvest ?? []) drops.push(drop.variants === undefined ? { ...drop } : { ...drop, variants: [...drop.variants] });
  for (const other of lent) {
    const ids = other.variants.map(variant => variant.id);
    for (const drop of other.harvest ?? []) {
      const own = drops.find(entry => entry.item === drop.item);
      const variants = drop.variants === undefined ? ids : drop.variants.filter(id => ids.includes(id));
      if (own === undefined) drops.push({ ...drop, variants });
      else if (own.variants !== undefined) own.variants.push(...variants.filter(id => own.variants?.includes(id) !== true));
    }
  }
  return drops;
}

/** One declared row as the native species row its roster or hunt registers; `spawnOnly` rows lend their variants. */
export function nativeSpeciesOf(rows: ShardRows, creatures: Pick<ShardCreatures, 'brains'>, id: string, spawnOnly: readonly string[] = []): SpeciesData {
  const layers = resolveCreatureLayers(rows, creatures.brains);
  const find = (name: string): SpeciesRow => {
    const row = rows.species.find(entry => entry.id === name);
    if (row === undefined) throw new Error(`Native roster names unknown declared species \`${name}\``);
    return row;
  };
  const row = find(id), layer = layers.get(id);
  if (layer?.brain.kind !== 'hunt') throw new Error(`Native roster species \`${id}\` needs a hunt temperament`);
  const lent = spawnOnly.map(find);
  if (lent.some(entry => entry.kind !== row.kind)) throw new Error(`Native roster species \`${id}\` lends spawn-only variants of another kind`);
  const sounds = layer.presentation?.sounds;
  return { id: row.id, kind: row.kind, label: row.label, variants: row.variants.map(variantOf),
    ...(lent.length === 0 ? {} : { spawnOnly: lent.flatMap(entry => entry.variants.map(variantOf)) }),
    aggressive: layer.temperament.reaction === 'aggressive', lockable: row.lockable, tuning: { ...layer.brain.tuning }, ...layer.brain.motion,
    ...(row.harvest === undefined ? {} : { harvest: lentHarvest(row, lent) }),
    ...(row.capExempt === undefined ? {} : { capExempt: row.capExempt }),
    ...(row.flight === undefined ? {} : { flight: { ...row.flight } }),
    ...(layer.presentation === undefined ? {} : { blood: layer.presentation.blood }),
    ...(sounds?.call === undefined || sounds.hurt === undefined ? {} : { sounds: { call: sounds.call, hurt: sounds.hurt,
      ...(sounds.callVariants === undefined ? {} : { callVariants: [...sounds.callVariants] }),
      ...(sounds.callEvery === undefined ? {} : { callEvery: [sounds.callEvery[0], sounds.callEvery[1]] as [number, number] }) } }) };
}

/** A roster's population from its own rows: its named declared species, in order, and its hunt (OF30). */
export function declaredRosterPopulation(rows: ShardRows, creatures: Pick<ShardCreatures, 'brains'>, roster: Pick<NativePopulationRows, 'species' | 'hunt'>): SpeciesPrograms {
  if (roster.species === undefined || roster.hunt === undefined) throw new Error('A native roster with no species programme names its declared species and its hunt');
  return { page: [], native: roster.species.map(entry => nativeSpeciesOf(rows, creatures, entry.id, entry.spawnOnly)), hunt: roster.hunt };
}

/** A ground boss's programme from its binding and the creature strike table (OF30): the declared species of its kind
 *  with the binding's decision brain and body recipe, and every exact creature strike. */
export function declaredBossProgram(rows: ShardRows, kind: string, binding: Pick<NativeBossBinding, 'decision' | 'body'>, strikes: Readonly<CreatureStrikes>): SpeciesProgramData {
  if (binding.decision === undefined || binding.body === undefined) throw new Error('A native boss with no species programme needs its decision and body in its binding');
  const row = rows.species.find(entry => entry.kind === kind);
  if (row === undefined) throw new Error(`Native boss kind \`${kind}\` has no declared species`);
  return { species: [{ id: row.id, kind: row.kind, label: row.label, variants: row.variants.map(variantOf),
    brain: { archetype: 'decision', data: binding.decision }, body: binding.body }], strikes: [...strikes] };
}

/** The harvest a native world restores an older pending carcass by (OF30): one declared row per kind, the first, as the
 *  native species list held one row per kind. */
export function declaredHarvest(rows: ShardRows): Pick<SpeciesData, 'kind' | 'harvest'>[] {
  const seen = new Set<string>();
  return rows.species.flatMap(row => {
    if (seen.has(row.kind)) return [];
    seen.add(row.kind);
    return [{ kind: row.kind, ...(row.harvest === undefined ? {} : { harvest: row.harvest }) }];
  });
}

/** The untyped presence check and read of a section this engine's pinned format no longer names. */
interface AnySectionProduct { readonly has: (name: string) => boolean; readonly section: (name: string) => unknown }
const SPECIES_PROGRAMS = 'actors/species-programs';
/** SHARD-COMPAT CP16: a kept original's species programme. OF30 cut B dropped the programme reads, but kept originals still
 *  carry `actors/species-programs` (Pine r5, prod's head, and r6; Driftwood r4 to r8), so they read it; a product with none
 *  reads its declared rows (the kept-originals play test went with ZONE-SNAPSHOTS ZS8). */
export function keptSpeciesPrograms(product: object): SpeciesPrograms | undefined {
  const any = product as AnySectionProduct;
  return any.has(SPECIES_PROGRAMS) ? readSpeciesPrograms(any.section(SPECIES_PROGRAMS)) : undefined;
}
