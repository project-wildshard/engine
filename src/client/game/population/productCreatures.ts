import * as v from 'valibot';
import type * as THREE from 'three';
import { CreatureInstallSchema, type CreatureInstallRows } from '@wildshard/format/speciesLooks';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import type { AnimalMaterial } from '@wildshard/engine/entities/AnimalFactory';
import { declaredSpawnTables } from '@wildshard/engine/ai/encounters';
import type { ShardContext } from '../plugin/context';
import { registerLootTable } from '../loot/tables';
import { perchLook, rowSpecies } from './rowSpecies';
import { readLootTables } from '../../../shared/game/loot/tableRows';
import { installPopulationProjection } from '../shardfile/clientPopulationProjection';
import { productHullBook } from '../looks/speciesBook';
import { lentLook, setLentParam } from '../shardfile/lentLooks';

/** the page's scope retired (or is retiring) during an awaited admission */
const left = (ctx: ShardContext): boolean => ctx.scope.disposed || ctx.scope.disposing;

/**
 * A product's creatures from its install rows (`actors/creature-install.json`, G571 host): the perch body (its poses
 * file animates the look of its own kind), the admitted species programs and the page species, the packed and hull-book
 * looks in their declared order, each on its lent graph body, the spawn and loot tables and the population projection.
 * Kit rows precede AnimalManager construction. Client-only presentation and page install; the native sim reads the
 * same admitted sections on its own. A page left during any awaited admission installs nothing more: each await is
 * followed by a retiring-scope fence before the next allocation or row.
 */
export async function installProductCreatures(ctx: ShardContext): Promise<void> {
  const rows = v.parse(CreatureInstallSchema, await ctx.product.json('actors/creature-install.json'));
  if (left(ctx)) return;
  const perchRows = await ctx.product.json(rows.perch);
  if (left(ctx)) return;
  const lookRows = await ctx.product.json(rows.packed.file);
  if (left(ctx)) return;
  const perch = perchLook(perchRows);
  const section = ctx.product.section('actors/species-programs'), program = section.program;
  if (program === undefined || section.spawns?.find(row => row.id === rows.practice)?.respawn === undefined) throw new Error('Creature install requires its admitted species programs');
  ctx.rows.species([...rowSpecies(program.species), ...section.page]);
  const book = productHullBook(ctx.product), packed = book.packed.looks(lookRows);
  const looks = [...rows.packed.kinds.map(kind => packed.get(kind)), ...rows.hulls.map(kind => book.look(kind))];
  ctx.rows.speciesLook(looks.map(look => lentGraphLook(look.kind === perch.kind ? { ...look, animate: perch.animate } : look, rows.lent)));
  ctx.rows.spawnTable(declaredSpawnTables(section.spawns));
  const loot = readLootTables(ctx.product.section('economy/loot').rows.loot[0]?.economy?.tables);
  ctx.rows.lootTable(loot);
  for (const row of loot) registerLootTable(row, ctx.scope);
  await book.packed.preload();
  if (left(ctx)) return;
  const projection = await ctx.product.json(rows.projection);
  if (left(ctx)) return;
  installPopulationProjection(ctx, projection);
}


/** a lit graph material: a lit classic graph program (NF18 retired the node back-end) */
const isLitGraph = (m: THREE.Material): m is AnimalMaterial => Reflect.get(m, 'isGraphShaderMaterial') === true && Reflect.get(m, 'lights') === true;
/** a lent creature body (a lit graph); refuses before the lend or on another kind of look */
function body(id: string): AnimalMaterial {
  const m = lentLook(id);
  if (!isLitGraph(m)) throw new Error(`Creature looks: ${id} is not a lit creature graph`);
  return m;
}

/** `look` drawn on its lent graph body, faceted, one copy of the body per animal (its `sharedBody` port: the rigs draw
 *  one body per lent body, so the entry builds one graph per skeleton, not one per animal). A species with an eye glow
 *  wears the glowing body, its glow the species' colour × intensity; a kind with its own body always wears it. A
 *  creature made before the bodies were lent refuses. */
export function lentGraphLook(look: SpeciesLook, lent: CreatureInstallRows['lent']): SpeciesLook {
  const name = (glow: unknown): string => lent.kinds[look.kind] ?? (glow === undefined ? lent.body : lent.glowing);
  return { ...look, faceted: true, sharedBody: glow => body(name(glow)), material: (_sky, glow, intensity = 1) => {
    if (glow !== undefined) setLentParam(name(glow), 'glow', [glow[0] * intensity, glow[1] * intensity, glow[2] * intensity]);
    return body(name(glow)).clone();
  } };
}
