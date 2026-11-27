/**
 * Splat terrain tiles on the client (SHARD-PLATFORM G227): the render half of `props.splat`. The twelve admitted,
 * transcoded layer files become the three compressed array textures the engine's splat ground material reads (the same
 * mip concatenation the live terrain's KTX2 arrays use, `layerArrayMips`), and that one material (the live terrain's own
 * function and program key, `splatTerrainMaterial`) draws every props tile primitive named `props.splat.material`, shared
 * as compiled, its `_splat` / `_canopy` channels renamed onto the attributes the program declares. A tile then looks as
 * the live chunk does wherever its vertices, weights and canopy are the chunk's: no second terrain path.
 *
 * The source layer textures are never uploaded: their mips are copied into the arrays, then released.
 */
import { CompressedArrayTexture, CompressedTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Material, type Texture } from 'three';
import { layerArrayMips, releaseAfterUpload } from '@wildshard/engine/core/ktx2';
import { splatDrawTier } from '@wildshard/engine/boot/gpuFiles';
import { splatTerrainMaterial, type SplatLayers } from '@wildshard/engine/world/Terrain';
import type { PropSurfaceBinding } from '@wildshard/engine/world/declaredProps';
import type { Scope } from '@wildshard/engine/app/scope';
import { SPLAT_CHANNELS, SPLAT_ROLES, splatLayers, type SplatRole, type SplatTerrain } from '@wildshard/format/splatTerrain';
import { readCookedTexture } from './blobTextures';

/** The largest array edge the client builds (the live terrain's `loadPBRArray(…, 1024)`). */
export const SPLAT_LAYER_SIZE = 1024;

const NO_MAPS: PropSurfaceBinding['maps'] = { colour: null, normal: null, normalScale: 1, metallicRoughness: null, occlusion: null, occlusionStrength: 1, emissive: null };

/** One role's array from its four transcoded layers: one format, a shared mip level at the array edge, unflipped. */
export function splatArray(role: SplatRole, layers: readonly Texture[], anisotropy = 8): CompressedArrayTexture {
  const compressed = layers.map((t) => (t instanceof CompressedTexture ? t : null));
  const mips = layerArrayMips(compressed, SPLAT_LAYER_SIZE);
  if (mips === null) throw new Error(`props.splat ${role}: its four layers must be compressed KTX2 of one format and a shared mip edge`);
  const t = new CompressedArrayTexture(mips.mipmaps, mips.n, mips.n, layers.length, mips.format);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = false; t.anisotropy = anisotropy; t.flipY = false;
  t.colorSpace = SPLAT_ROLES[role] === 'colour' ? SRGBColorSpace : NoColorSpace;
  t.name = `shardfile:splat/${role}`;
  t.needsUpdate = true;
  // the concatenated mips are on the GPU after its first draw: retire the CPU chain as every loaded KTX2 texture does
  return releaseAfterUpload(t);
}

/**
 * The splat surface: the arrays and the material, owned by `scope`, and the binding the declared-props installer draws the
 * splat material name with. `texture` resolves an admitted transcoded layer file (`clientMaterials`' transcode set).
 */
export function splatSurface(splat: SplatTerrain, ports: { scope: Scope; texture: (ref: string) => Texture; anisotropy?: number }): { material: Material; binding: PropSurfaceBinding } {
  const sources = new Set<Texture>();
  const array = (role: SplatRole): CompressedArrayTexture => {
    const textures = splatLayers(splat, splatDrawTier())[role].map((ref) => ports.texture(ref));
    for (const t of textures) sources.add(t);
    return ports.scope.own(splatArray(role, textures, ports.anisotropy));
  };
  const layers: SplatLayers = { map: array('colour'), normalMap: array('normal'), armMap: array('arm') };
  // the layers live on in the arrays (a file may serve two data roles): the sources never reach the GPU
  for (const source of sources) { source.mipmaps = []; source.dispose(); }
  const material = ports.scope.own(splatTerrainMaterial(layers, { tints: splat.tints, boreal: splat.boreal }));
  const channels = Object.fromEntries(Object.entries(SPLAT_CHANNELS).map(([semantic, row]) => [semantic.toLowerCase(), row]));
  return { material, binding: { material, maps: NO_MAPS, compiled: true, channels } };
}

/** Put the splat material name in front of a named-material resolver (or the one-family path's absence of one). */
export function withSplatSurface(splat: { readonly name: string; readonly binding: PropSurfaceBinding }, surfaces: ((name: string) => PropSurfaceBinding) | null): (name: string) => PropSurfaceBinding | null {
  return (name) => {
    if (name === splat.name) return splat.binding;
    // without named materials every other prop draws with the family, as it did before the ground joined the tiles
    return surfaces === null ? null : surfaces(name);
  };
}

/** S12f2b2: a splat layer's cooked file (`/assets/<folder>/splat/<hash>.t<max>-<hash8>.ktx2`, or SF16's
 *  `/assets/<folder>/blobs/<hash>-<hash8>.ktx2`), read and checked against its name (`readCookedTexture`). */
export const readSplatLayer: typeof readCookedTexture = readCookedTexture;

/** S12f2b2: the cooked file of each splat layer this device draws that has one (`layer`), read by URL (`read`), by the
 *  layer's hash. A KTX2 layer's is read only by a phone drawing the phone set (its blob was never admitted there); an image
 *  layer's (`image`, SF16) on either tier, since the arrays take compressed layers only. */
export async function cookedSplatBytes(splat: SplatTerrain | undefined, drawn: ReadonlySet<string>, tier: 'phone' | 'desktop', layer: (hash: string) => string | undefined,
  read: (url: string) => Promise<Uint8Array> = readSplatLayer, image: (hash: string) => boolean = () => false): Promise<ReadonlyMap<string, Uint8Array>> {
  const cooked = new Map<string, Uint8Array>();
  if (splat === undefined) return cooked;
  // a KTX2 layer's row is the phone set's 6x6; an image layer's (SF16) is read on either tier, as its blob can't be drawn
  const phoneSet = splat.phone !== undefined && tier === 'phone';
  await Promise.all([...drawn].map(async ref => { const url = phoneSet || image(ref) ? layer(ref) : undefined; if (url !== undefined) cooked.set(ref, await read(url)); }));
  return cooked;
}
