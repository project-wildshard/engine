import { installKitWorldFixture } from './kit-world';
import { registerSpecies } from '../../src/shared/engine/entities/species/registry';
import { speciesWithLook } from '../../src/client/engine/entities/species/look';
import { HullLookBook } from '../../src/client/game/looks/speciesBook';
import { numericCreaturePose } from '../../src/shared/game/plugin/channelPrograms';
import { PINE_BOAR } from '../../src/shards/pine-hollow/generators/speciesRows';
import { SPECIES_LOOKS } from '../../src/shards/pine-hollow/generators/nativeView';
import { THRALL_CLIPS } from '../../src/shards/pine-hollow/generators/thrallClips';

/** Boar manager fixtures retain the full world's exact final Pine boar row,
 * body and pose over the shared baseline, plus its real selected level and
 * assets. Other species, scalar banks, places and quests are unused here. */
export async function installBoarWorldFixture(): Promise<void> {
  await installKitWorldFixture();
  const pineBook = new HullLookBook(SPECIES_LOOKS);
  registerSpecies(speciesWithLook(PINE_BOAR, { ...pineBook.look('boar'), postPose: numericCreaturePose(THRALL_CLIPS) }));
}
