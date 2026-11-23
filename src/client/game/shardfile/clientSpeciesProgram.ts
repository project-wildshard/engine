import { object, parse, pick } from 'valibot';
import { SpeciesPresentationSchema } from '@wildshard/format/speciesBookRows';
import { folderSpeciesCatalogueSliced } from '../looks/speciesBook';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { entryOwner, presentEntryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { ClientSpeciesProgramSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { clientNativeBook } from './clientNativeBook';
import { residentWorldScope } from './runtimePagePresentation';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';

/** Prepare the approved speciesBook catalogue once for world and kit consumers. */
export async function prepareClientSpeciesCatalogue(ctx: ShardContext, input: unknown): Promise<void> {
  const row = parse(ClientSpeciesProgramSchema, input), source = row.catalogue;
  if (source === undefined) throw new Error('Species catalogue source is missing');
  const scope = ctx.scope, product = ctx.product, runtime = ctx.game.runtime, world = runtime?.world;
  const live = (): void => {
    if (scope.disposed || scope.disposing || ctx.scope !== scope || ctx.product !== product || ctx.game.runtime !== runtime
      || world === undefined || world === null || runtime?.world !== world) throw new Error('Species catalogue owner changed');
  };
  live();
  if (presentEntryOwner(scope, 'species', source.owner) !== null) throw new Error('Species catalogue is already prepared');
  const actors = parse(object({species: pick(SpeciesPresentationSchema, ['lookBook', 'packedBodies'])}), await product.json<unknown>(source.actors)); live();
  const looks = await product.json<unknown>(source.looks); live();
  const catalogue = await folderSpeciesCatalogueSliced(product, actors.species, looks, () => buildYield(scope)); live();
  publishEntryOwner(scope, 'species', source.owner, catalogue);
}

/** The authored body and coat can move before their native roster. Keep the
 * catalogue's poses, gait and view channels on the exact same kind and look. */
function withDeclaredSkin(original: SpeciesLook, replacement: SpeciesLook): SpeciesLook {
  if (original.kind !== replacement.kind || replacement.skin === undefined || replacement.material === undefined) {
    throw new Error(`Invalid declared catalogue skin: ${replacement.id}`);
  }
  const { preload: _preload, loadSkin: _loadSkin, hasSkin: _hasSkin, ...look } = original;
  return { ...look, build: replacement.build, skin: replacement.skin, material: original.material ?? replacement.material,
    ...(replacement.partMaterials === undefined ? {} : { partMaterials: replacement.partMaterials }) };
}

/** Compiled species.program feature: the rows a page draws and their rigs. A body's decisions are the server's. */
export async function installClientSpeciesProgram(ctx: ShardContext, input: unknown): Promise<void> {
  // OF30: the catalogue is prepared ahead (its world phase); a failure still rejects as the feature's install
  await Promise.resolve();
  installSpeciesCatalogue(ctx, input);
}
function installSpeciesCatalogue(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientSpeciesProgramSchema, input);
  if (row.catalogue !== undefined) {
    const catalogue = entryOwner(ctx.scope, 'species', row.catalogue.owner);
    const replacements = clientNativeBook(ctx, residentWorldScope(ctx)).catalogueSkins;
    if (replacements === undefined) { catalogue.install(ctx.rows); return; }
    const byId = new Map(replacements.map(look => [look.id, look]));
    const looks = catalogue.looks.map(original => {
      const replacement = byId.get(original.id);
      if (replacement === undefined) return original;
      byId.delete(original.id);
      return withDeclaredSkin(original, replacement);
    });
    if (byId.size > 0) throw new Error(`Unmatched declared catalogue skin: ${[...byId.keys()].join(', ')}`);
    ctx.rows.species(catalogue.rows);
    ctx.rows.speciesLook(looks);
    return;
  }
  // ONE-FORMAT OF30: the library path read `actors/species-programs`; a species feature now names its catalogue
  throw new Error('Species feature needs its declared catalogue');
}
