import { speciesWithLook } from '../../src/client/engine/entities/species/look';
import { registerSpecies } from '../../src/shared/engine/entities/species/registry';
import { installKitCreatureSounds } from '../../src/client/game/systems/species/install';
import { BOAR } from '../../src/test/game/species/boar';
import { BEAR } from '../../src/test/game/species/bear';
import { BOAR_LOOK } from '../../src/client/game/systems/species/view/boar';
import { BEAR_LOOK } from '../../src/test/game/species/view/bear';

/** Tests only (ONE-FORMAT OF5b2b): the kit boar and bear in the legacy registry, as the page did at boot before OF5b2b. */
export function installKitSpecies(register: typeof registerSpecies = registerSpecies): void {
  installKitCreatureSounds();
  register(speciesWithLook(BOAR, BOAR_LOOK));
  register(speciesWithLook(BEAR, BEAR_LOOK));
}
