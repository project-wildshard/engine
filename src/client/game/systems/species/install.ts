import { speciesWithLook } from '@wildshard/engine/entities/species/look';
import { registerSpecies, setCreatureSoundDefaults } from '@wildshard/engine/entities/species/registry';
import { BOAR } from './boar';
import { BEAR } from './bear';
import { BOAR_LOOK } from './view/boar';
import { BEAR_LOOK } from './view/bear';

function installSoundDefaults(): void {
  // A charger grunts like a boar, a grazer calls like a deer.
  setCreatureSoundDefaults({ charger: { call: 'boar_grunt', hurt: 'boar_squeal' }, grazer: { call: 'deer_call', hurt: 'deer_call' } });
}

/** Modern composition roots and model tools register only shared species. */
export function installKitSpecies(register: typeof registerSpecies = registerSpecies): void {
  installSoundDefaults();
  register(speciesWithLook(BOAR, BOAR_LOOK));
  register(speciesWithLook(BEAR, BEAR_LOOK));
}
