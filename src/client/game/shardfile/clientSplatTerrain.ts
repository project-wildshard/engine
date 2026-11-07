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
import { SPLAT_CHANNELS, SPLAT_ROLES, splatLayers, splatTerrainOf, splatTextureRefs, type SplatRole, type SplatTerrain } from '@wildshard/format/splatTerrain';
import type { Shardfile } from '@wildshard/format/shardSchema';

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

/**
 * Whether a shard's splat ground draws from its tiles (G518, tile streaming P1; G669 DR10: always, for a shard that declares
 * one): its props tiles' ground primitives draw and the world hides its whole native ground mesh.
 */
export function splatGroundDrawn(props: object | null): boolean {
  return props !== null && splatTerrainOf(props) !== undefined;
}
/** The files a declared splat ground streams: each props tile's primary (ground) GLB and every layer file (empty without one). */
export function splatGroundFiles(source: Pick<Shardfile, 'props'>): Set<string> {
  const props = source.props, splat = props === null ? undefined : splatTerrainOf(props);
  return props === null || splat === undefined ? new Set() : new Set([...props.tiles.map(tile => tile.file), ...splatTextureRefs(splat)]);
}
/**
 * A trusted runtime's data source (`withoutRuntimeRows`, its bound props emptied) with its splat ground back when the ground
 * tiles draw (`splatGroundDrawn`): the bound props tiles' primary (ground) files only, never their additional files (the
 * runtime draws those), with their tile rows, files and layer library entries, so the data client streams the ground.
 */
export function withSplatGround(data: Shardfile, full: Shardfile): Shardfile {
  const props = full.props, splat = props === null ? undefined : splatTerrainOf(props);
  if (props === null || splat === undefined || data.props === null || !splatGroundDrawn(props)) return data;
  const primary = new Set(props.tiles.map(tile => tile.file)), layers = new Set(splatTextureRefs(splat));
  const known = new Set(data.files.map(file => file.hash)), shared = new Set(data.library);
  const key = (row: { lod: number; x: number; z: number }): string => `${String(row.lod)}/${String(row.x)}/${String(row.z)}`;
  const ground = new Map(full.tiles.flatMap(row => { const files = row.files.filter(ref => primary.has(ref)); return files.length === 0 ? [] : [[key(row), { ...row, files }] as const]; }));
  return { ...data,
    props: { ...data.props, tiles: props.tiles.map(tile => ({ lod: tile.lod, x: tile.x, z: tile.z, file: tile.file })), splat },
    tiles: [...data.tiles.map(row => { const extra = ground.get(key(row)); return extra === undefined ? row : { ...row, files: [...row.files, ...extra.files] }; }),
      ...[...ground].filter(([at]) => !data.tiles.some(row => key(row) === at)).map(([, row]) => row)],
    files: [...data.files, ...full.files.filter(file => (primary.has(file.hash) || layers.has(file.hash)) && !known.has(file.hash))],
    library: [...data.library, ...full.library.filter(ref => layers.has(ref) && !shared.has(ref))] };
}

/** Put the splat material name in front of a named-material resolver (or the one-family path's absence of one). */
export function withSplatSurface(splat: { readonly name: string; readonly binding: PropSurfaceBinding }, surfaces: ((name: string) => PropSurfaceBinding) | null): (name: string) => PropSurfaceBinding | null {
  return (name) => {
    if (name === splat.name) return splat.binding;
    // without named materials every other prop draws with the family, as it did before the ground joined the tiles
    return surfaces === null ? null : surfaces(name);
  };
}
