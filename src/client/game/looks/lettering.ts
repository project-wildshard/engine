import * as THREE from 'three';
import type { BinarySourceRows } from '@wildshard/format/binarySource';
import { binarySourceBytes } from '../models/binarySource';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';

/** A prepared raw RGBA8 file or legacy inline atlas on the same mipmapped sRGB material. */
export function letteringMaterial(sky: SkyRig | null, row: BinarySourceRows & { readonly width: number; readonly height: number; readonly rim: number }, files:ReadonlyMap<string,Uint8Array>=new Map()): THREE.Material {
  const bytes = binarySourceBytes('data'in row?{data:row.data}:{file:row.file},files); if (bytes.length !== row.width * row.height * 4) throw new Error('Label atlas byte count differs');
  const atlas = new THREE.DataTexture(bytes, row.width, row.height);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; atlas.flipY = true; atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.needsUpdate = true;
  const material = painterlyMaterial(sky, { rim: row.rim }); material.map = atlas; return material;
}
