import { installWorldRegistry } from '../../src/client/engine/world/registry';
import { installKitSpecies } from '../../src/client/game/systems/species/install';
import { installAssetFixture, installCatalogueFixture } from './bootSetup';

/** Exact shared creature owner and its real app tables, without unrelated world content. */
export async function installKitWorldFixture(): Promise<void> {
  await installAssetFixture();
  await installCatalogueFixture();
  await import('./shardList');
  installWorldRegistry();
  installKitSpecies();
}
