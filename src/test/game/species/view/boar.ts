import { boarLook } from '../../../../client/game/systems/species/view/boar';
import type { SpeciesLook } from '@wildshard/engine/entities/species/look';

/** Tests only (FORMAT-PRUNE FP51): the kit boar look as the kit row declared it. */
export const BOAR_LOOK: SpeciesLook = boarLook({ id: 'kit.look.boar', species: 'kit.creature.boar', kind: 'boar' });
