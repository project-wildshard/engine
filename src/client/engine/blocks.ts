import { melee, aimRay, fovForAspect } from '../../shared/engine/combat/blocks/melee';
import { ads } from '../../shared/engine/combat/blocks/ads';
import { viewmodel } from './render/viewmodelFeel';

/** Existing engine blocks grouped for authored weapon composition. */
export const blocks: Readonly<{ melee: typeof melee; aimRay: typeof aimRay; fovForAspect: typeof fovForAspect; ads: typeof ads; viewmodel: typeof viewmodel }> = Object.freeze({ melee, aimRay, fovForAspect, ads, viewmodel });
