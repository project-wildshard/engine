import type { Scope } from '@wildshard/engine/app/scope';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';
import type { ShardRows } from '@wildshard/format/rows';
import { RIG_LOOK_RECIPE, rigLookParameters } from '@wildshard/format/rigLooks';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type { ClientRigLooks } from './clientRecipes';
import { prepareSceneSources, sceneModelSource } from './sceneSources';

/**
 * ONE-FORMAT OF19d2: the scene model libraries a page's `platform.rig` looks name, their rigs preloaded, so the declared
 * creature host draws those bodies as the deleted species program did (Sunscar Dunes' ray, strider and Matriarch). A page with no
 * rig look reads nothing. Each library is the one the world's scenes already prepared, never a second copy.
 */
export async function loadClientRigLooks(product: ShardFolder, rows: Pick<ShardRows, 'looks'>, scope: Scope): Promise<ClientRigLooks> {
  const libraries = [...new Set(rows.looks.filter((row) => row.recipe === RIG_LOOK_RECIPE).map((row) => rigLookParameters(row).library))];
  if (libraries.length === 0) return new Map();
  await prepareSceneSources(product);
  const looks = new Map<string, readonly SpeciesLook[]>();
  for (const id of libraries) {
    const library = sceneModelSource(product, id);
    await library.preloadRigs();
    if (scope.disposed || scope.disposing) throw new Error('Rig looks left their entered owner');
    if (library.looks.length === 0) throw new Error(`Rig look library ${id} declares no rigs`);
    looks.set(id, library.looks);
  }
  return looks;
}
