/**
 * ONE-FORMAT OF3c2: a toon or PBR surface's `strands` (format `fur-strands.ts`), the creature fur grain as numbers. The
 * maps are the creature factory's own fur canvases (entities/furCanvases.ts) from the same seed and parameters, drawn
 * once per distinct set and shared by every material that names it: the albedo multiplies the surface colour (and its
 * vertex colours), the normal map adds the strand relief. Repeat-wrapped along the mesh's UVs, as the factory's are.
 */
import * as THREE from 'three';
import type { FurStrands } from '@wildshard/format/fur-strands';
import { makeFurCanvases } from '../../entities/furCanvases';

/** The strand albedo (sRGB) and normal maps for one `strands` entry. */
export interface StrandMaps { readonly map: THREE.Texture; readonly normalMap: THREE.Texture }

const drawn = new Map<string, StrandMaps>();
const ANISOTROPY = 8;

/** The shared maps for `strands`, drawn on first use. */
export function strandMaps(strands: FurStrands): StrandMaps {
  const { seed, ...tex } = strands, key = JSON.stringify([seed, tex.contrast, tex.grizzle, tex.normalStrength, tex.bristle, tex.strandLen, tex.root]);
  const known = drawn.get(key);
  if (known !== undefined) return known;
  const { ca, cn } = makeFurCanvases(seed, tex);
  const map = new THREE.CanvasTexture(ca), normalMap = new THREE.CanvasTexture(cn);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap]) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = ANISOTROPY; }
  const maps = { map, normalMap };
  drawn.set(key, maps);
  return maps;
}
