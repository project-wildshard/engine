import { setCreatureSoundDefaults } from '@wildshard/engine/entities/species/registry';

/** ONE-FORMAT OF5b2b: the engine registers no creature at boot; every species and look is a shard's declared row. The page
 *  installs only the kit's default calls for a row with no `sounds`: a charger grunts like a boar, a grazer calls like a deer. */
export function installKitCreatureSounds(): void {
  setCreatureSoundDefaults({ charger: { call: 'boar_grunt', hurt: 'boar_squeal' }, grazer: { call: 'deer_call', hurt: 'deer_call' } });
}
