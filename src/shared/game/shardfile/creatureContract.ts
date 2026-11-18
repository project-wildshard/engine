import type { CreatureBody } from '@wildshard/format/creatureLayers';
import { creatureContract, type SkeletonContract } from '@wildshard/format/creatureSkeletons';

/** A body's skeleton contract: a fixed skeleton's, a serpent's built from its trail row (ONE-FORMAT CC23), or none for a
 * GLB with its own rig. The one lookup, so no reader indexes the fixed table by a serpent. */
export function bodyContract(body: Pick<CreatureBody, 'skeleton' | 'trail'>): SkeletonContract | undefined {
  return body.skeleton === undefined ? undefined : creatureContract({ skeleton: body.skeleton, ...(body.trail === undefined ? {} : { trail: body.trail }) });
}
