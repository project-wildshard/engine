import type { Material } from '../physics/surface';
import type { ImpactSurface } from './Weapon';

/** The impact sound / puff family of what was hit (three sample sets): bark and planks are wood, everything else ground.
 *  Renderer-free (P1-E4.5): a server's hit and the page's dust name the same surface. */
export function impactSurfaceOf(m: Material): ImpactSurface {
  return m === 'flesh' ? 'flesh' : m === 'wood' || m === 'planks' ? 'wood' : 'ground';
}
