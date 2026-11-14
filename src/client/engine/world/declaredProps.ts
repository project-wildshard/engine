import { Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, type BufferGeometry, type Color, type Material, type Object3D, Texture } from 'three';
import { prepareRigLoader } from '../anim/rig';
import { restoreDrawnChannels } from '../models/nativeGeometry';
import { Scope } from '../../../shared/engine/app/scope';
import { bindGraphMeshMap } from '../render/graphBackend';
import { familyVariant } from '../render/families/registry';

function isMesh(object: Object3D): object is Mesh { return object instanceof Mesh; }
/** Without narrowing its argument (InstancedMesh's type parameters default to any). */
function isInstanced(object: Object3D): boolean { return object instanceof InstancedMesh; }

/** the colour and map slots a family material and a GLB material share (PBR and toon are standard, painterly Lambert) */
function surfaceOf(m: Material): MeshStandardMaterial | MeshLambertMaterial | null {
  return m instanceof MeshStandardMaterial || m instanceof MeshLambertMaterial ? m : null;
}

/**
 * A named prop surface (SHARD-PLATFORM SF55): what one GLB material name resolves to, the base material it draws with (a
 * family material, or a graph's classic program material, which is shared as it is) and the admitted texture slots it
 * binds, each already carrying its sampler. A null slot keeps the base material's own map.
 */
export interface PropSurfaceBinding {
  readonly material: Material;
  readonly maps: {
    readonly colour: Texture | null; readonly normal: Texture | null; readonly normalScale: number; readonly metallicRoughness: Texture | null;
    readonly occlusion: Texture | null; readonly occlusionStrength: number; readonly emissive: Texture | null;
  };
  /**
   * Draw `material` as compiled (shared by every mesh that names it, never a family variant): a material whose own program
   * reads its own uniforms and vertex channels (SHARD-PLATFORM G227: a splat terrain tile). `maps` are then unused.
   */
  readonly compiled?: boolean;
  /**
   * Vertex channels the material reads, as GLB application channel (GLTFLoader's lowercased `_NAME`, e.g. `_splat`) →
   * the attribute name its program declares (`splat`) and its components. Every listed channel must be on the mesh: a
   * missing or malformed channel refuses the install (no guessed default weights).
   */
  readonly channels?: Readonly<Record<string, { readonly attribute: string; readonly itemSize: number }>>;
}

/** Rename a mesh's GLB application channels to the attributes its surface reads; throws for a missing or malformed one. */
export function adoptChannels(geometry: BufferGeometry, channels: NonNullable<PropSurfaceBinding['channels']>, name: string): void {
  const label = name === '' ? '(unnamed)' : name;
  for (const [source, { attribute, itemSize }] of Object.entries(channels)) {
    const at = geometry.hasAttribute(source) ? geometry.getAttribute(source) : geometry.hasAttribute(attribute) ? geometry.getAttribute(attribute) : undefined;
    if (at === undefined) throw new Error(`props GLB material "${label}" needs vertex channel ${source}`);
    if (at.itemSize !== itemSize || at.count !== geometry.getAttribute('position').count) throw new Error(`props GLB material "${label}": channel ${source} must carry ${itemSize} components per vertex`);
    if (geometry.hasAttribute(source)) { geometry.deleteAttribute(source); geometry.setAttribute(attribute, at); }
  }
}
type SurfaceMaps = PropSurfaceBinding['maps'];
/** What a prop mesh takes from its GLB material onto the family's: one shared family variant per distinct set. */
interface Surface { colour: Color | null; roughness: number | null; metalness: number | null; map: Texture | undefined; vertexColours: boolean; flat: boolean; side: Material['side']; transparent: boolean; opacity: number; named?: { maps: SurfaceMaps; emissive: Color | null } }
const mapsKey = (n: NonNullable<Surface['named']>): string =>
  `|${[n.maps.colour, n.maps.normal, n.maps.metallicRoughness, n.maps.occlusion, n.maps.emissive].map((t) => t?.uuid ?? '-').join(',')}|${n.maps.normalScale}|${n.maps.occlusionStrength}|${n.emissive?.getHexString() ?? '-'}`;
const surfaceKey = (s: Surface): string =>
  `${s.colour?.getHexString() ?? '-'}|${s.roughness ?? '-'}|${s.metalness ?? '-'}|${s.map?.uuid ?? '-'}|${s.vertexColours ? 'v' : ''}${s.flat ? 'f' : ''}|${s.side}|${s.transparent ? 't' : ''}|${s.opacity}${s.named === undefined ? '' : mapsKey(s.named)}`;
/** a graph look (an SF59 graph's classic GLSL program): it reads its own channels and colours, so it binds its mesh map
 *  and nothing else (as a family variant it took the GLB's vertex colours on top) */
const isGraphMaterial = (m: Material): boolean => Reflect.get(m, 'isGraphShaderMaterial') === true;
/** bind a named surface's slots (glTF's unflipped UV convention: the normal map's green runs the other way, as GLTFLoader sets it) */
function applyMaps(m: Material, named: NonNullable<Surface['named']>): void {
  const { maps } = named;
  if (m instanceof MeshBasicMaterial) { if (maps.colour !== null) m.map = maps.colour; return; }
  const own = surfaceOf(m); if (own === null) return;
  if (maps.colour !== null) own.map = maps.colour;
  if (maps.normal !== null) { own.normalMap = maps.normal; own.normalScale.set(maps.normalScale, -maps.normalScale); }
  if (maps.occlusion !== null) { own.aoMap = maps.occlusion; own.aoMapIntensity = maps.occlusionStrength; }
  if (maps.emissive !== null) own.emissiveMap = maps.emissive;
  if (named.emissive !== null) own.emissive.copy(named.emissive);
  if (m instanceof MeshStandardMaterial && maps.metallicRoughness !== null) { m.roughnessMap = maps.metallicRoughness; m.metalnessMap = maps.metallicRoughness; }
}

/**
 * The family variants every installed prop shares, per family material: a toon or painterly prop draws with its family's
 * own program (patches and key kept, `familyVariant`), and equal surfaces across tiles are one material. Counted: a
 * variant is disposed when the last tile or level holding it lets go.
 */
const variants = new WeakMap<Material, Map<string, { material: Material; holders: number; scope: Scope }>>();
function acquireVariant(family: Material, surface: Surface): Material {
  let byKey = variants.get(family);
  if (byKey === undefined) { byKey = new Map(); variants.set(family, byKey); }
  const key = surfaceKey(surface), known = byKey.get(key);
  if (known !== undefined) { known.holders++; return known.material; }
  const scope = new Scope('props.family-variant');
  const material = familyVariant(family, scope, (m) => {
    const own = surfaceOf(m);
    if (own !== null) {
      // the family's colour tints the GLB's (white by default: the GLB's colour as authored)
      if (surface.colour !== null) own.color.multiply(surface.colour);
      if (surface.map !== undefined) own.map = surface.map;
    }
    if (m instanceof MeshStandardMaterial) { if (surface.roughness !== null) m.roughness = surface.roughness; if (surface.metalness !== null) m.metalness = surface.metalness; }
    m.vertexColors = surface.vertexColours; m.side = surface.side; m.transparent = surface.transparent; m.opacity = surface.opacity;
    // glTF: a primitive without NORMAL draws flat normals (GLTFLoader flat-shades its own material); a smooth variant read
    // (0, 0, 0) and lit NaN, which the bloom chain spread into big white blocks over the grid's ring props (QA13)
    if (surface.flat && 'flatShading' in m) m.flatShading = true;
    if (surface.named !== undefined) applyMaps(m, surface.named);
  });
  byKey.set(key, { material, holders: 1, scope });
  return material;
}
function releaseVariant(family: Material, material: Material): void {
  const byKey = variants.get(family); if (byKey === undefined) return;
  for (const [key, entry] of byKey) {
    if (entry.material !== material) continue;
    if (--entry.holders === 0) { byKey.delete(key); entry.scope.dispose(); material.dispose(); }
    return;
  }
}

/** Admitted prop bindings; the game validates hashes and tile relationships before handing bytes to this renderer. */
export interface DeclaredProps {
  family: string; tiles: readonly { lod: number; x: number; z: number; file: string; additionalFiles?: readonly string[] }[];
  panels: readonly { id: string; file: string; visible?: boolean }[]; models: readonly { id: string; file: string }[];
  far: string | null; textures: readonly { model: string; colour: string }[];
}
/** Level-owned roots and stable panel/model ports. Visibility/pose commands act on the returned roots. */
export interface InstalledProps { tiles: ReadonlyMap<string, Object3D>; panels: ReadonlyMap<string, Object3D>; models: ReadonlyMap<string, Object3D>; far: Object3D | null; disposeTile: (key: string) => void }
/**
 * Parse only admitted memory, apply a resolved family and texture catalogue, and dispose everything with the level. Every
 * prop mesh draws with a shared variant of the family material that keeps the family's program (toon and painterly
 * shading survive), so props add no programs beyond the family's own variants.
 *
 * `surfaces` (SF55, named prop materials) replaces the one family: each GLB material's exact name resolves to its own base
 * material and texture slots (the port throws for a name it does not carry, so an unmapped material refuses the install,
 * never draws a guess). A family base draws as a shared variant carrying the GLB's factors and the slots; a graph's node
 * material, and a `compiled` surface (a splat terrain tile's, its `channels` renamed onto the mesh first), are shared as
 * compiled. A name the port answers null for draws with the family as before (a splat terrain beside family props, G227).
 * An emissive base (unlit: lamps, flames, crystals) keeps its declared colour, intensity and program under any props look,
 * the dev-map measure layer included, and reads the mesh's vertex colours only if it declares `vertexColours` (LF1-2).
 * Each extra material in a tile is one more draw there (two if it casts a shadow), charged by the tile's GLB cost.
 * Without `surfaces` nothing changes.
 */
export async function installDeclaredProps(props: DeclaredProps, ports: {
  scene: Object3D; scope: Scope; assets: ReadonlyMap<string, Uint8Array>; materials: ReadonlyMap<string, Material>;
  textures?: ReadonlyMap<string, Texture>; lod?: 0 | 1 | 'far'; selectedTiles?: ReadonlySet<string>; includeLibrary?: boolean;
  surfaces?: (name: string) => PropSurfaceBinding | null;
}): Promise<InstalledProps> {
  const roots = new Group(), geometries = new Set<BufferGeometry>(), held: Material[] = [], bases = new Map<Material, Material>();
  // SF57 leak5: a GLB's EXT_mesh_gpu_instancing node parses to an InstancedMesh, whose instance buffers are its own upload; it
  // is disposed with its geometry, or each ring tile's instanced props stayed in the renderer's live set undisposed
  const instanced = new Set<Object3D>();
  const disposeInstanced = (mesh: Object3D): void => { if (instanced.delete(mesh) && mesh instanceof InstancedMesh) mesh.dispose(); };
  const family = ports.materials.get(props.family); if (family === undefined) throw new Error(`Unresolved props family ${props.family}`);
  let disposed = false;
  const release = (m: Material): void => { releaseVariant(bases.get(m) ?? family, m); };
  const releaseAll = (): void => {
    for (const g of geometries) g.dispose(); geometries.clear(); for (const m of held.splice(0)) release(m);
    for (const mesh of instanced) disposeInstanced(mesh);
  };
  ports.scope.onDispose(() => { disposed = true; roots.removeFromParent(); releaseAll(); });
  // js-heap H6: the inner closures share one context, and disposeTile and the dispose hook live as long as the props, so
  // they capture these fields rather than `ports`; the transport map is dropped once every GLB is parsed.
  const { scope, textures, surfaces } = ports;
  let assets: ReadonlyMap<string, Uint8Array> | undefined = ports.assets;
  const parse = async (hash: string): Promise<Object3D> => {
    const bytes = assets?.get(hash); if (bytes === undefined) throw new Error('Missing admitted props GLB');
    const gltf = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(bytes, '');
    const textureRef = props.textures.find((t) => t.model === hash)?.colour, texture = textureRef === undefined ? undefined : textures?.get(textureRef);
    if (textureRef !== undefined && texture === undefined) throw new Error('Missing admitted props texture');
    gltf.scene.traverse((o) => {
      if (!isMesh(o)) return;
      // D154: a native node's drawn channels under the names three reads (a vec4 normal is only a typed copy)
      restoreDrawnChannels(o);
      geometries.add(o.geometry);
      if (isInstanced(o)) instanced.add(o);
      const original = Array.isArray(o.material) ? o.material : [o.material];
      const vertexColours = o.geometry.hasAttribute('color'), flat = !o.geometry.hasAttribute('normal');
      const named = surfaces;
      const familyConvert = (source: Material | undefined): Material => {
        const glb = source === undefined ? null : surfaceOf(source), standard = source instanceof MeshStandardMaterial ? source : null;
        const m = acquireVariant(family, { colour: glb?.color ?? null, roughness: standard?.roughness ?? null, metalness: standard?.metalness ?? null, map: texture, vertexColours, flat,
          side: source?.side ?? family.side, transparent: source?.transparent ?? family.transparent, opacity: source?.opacity ?? family.opacity });
        // the GLB's own material is only read: it never reaches the GPU
        source?.dispose(); held.push(m); return m;
      };
      const convert = named === undefined ? familyConvert : (source: Material | undefined): Material => {
        const binding = named(source?.name ?? '');
        if (binding === null) return familyConvert(source);
        if (binding.channels !== undefined) adoptChannels(o.geometry, binding.channels, source?.name ?? '');
        if (binding.compiled === true || isGraphMaterial(binding.material)) {
          const mapped: unknown = source === undefined ? undefined : Reflect.get(source, 'map');
          const map = binding.maps.colour ?? texture ?? (mapped instanceof Texture ? mapped : undefined);
          const material = bindGraphMeshMap(binding.material, map, scope);
          source?.dispose(); return material;
        }
        const glb = source === undefined ? null : surfaceOf(source), standard = source instanceof MeshStandardMaterial ? source : null, base = binding.material;
        // TEMPLATE-E2E LF1-2: an unlit (emissive) surface is its declared colour × intensity, so it takes the mesh's
        // vertex colours only when it declares them: a lamp baked grey beside measure stone still glows its own amber
        const unlit = base instanceof MeshBasicMaterial;
        const seeThrough = base.userData['sceneAlpha'] === true;
        const m = acquireVariant(base, { colour: glb?.color ?? null, roughness: standard?.roughness ?? null, metalness: standard?.metalness ?? null, map: undefined, vertexColours: unlit ? base.vertexColors && vertexColours : vertexColours, flat,
          // SHARD-SOURCE AP10: a see-through family entry (`blend: 'alpha'`, an alpha card) stays see-through whatever the GLB says
          side: source?.side ?? base.side, transparent: seeThrough || (source?.transparent ?? base.transparent), opacity: seeThrough ? base.opacity : source?.opacity ?? base.opacity,
          named: { maps: binding.maps, emissive: glb?.emissive ?? null } });
        source?.dispose(); held.push(m); bases.set(m, base); return m;
      };
      o.material = Array.isArray(o.material) ? original.map(convert) : convert(original[0]);
      o.castShadow = o.userData['castShadow'] !== false; o.receiveShadow = o.userData['receiveShadow'] !== false;
    });
    if (disposed) { releaseAll(); throw new Error('Props level unloaded while parsing'); }
    return gltf.scene;
  };
  const tiles = new Map<string, Object3D>(), panels = new Map<string, Object3D>(), models = new Map<string, Object3D>();
  try {
    for (const tile of props.tiles) {
      const key = `${tile.lod}/${tile.x}/${tile.z}`;
      if (tile.lod !== (ports.lod ?? 0) || (ports.selectedTiles !== undefined && !ports.selectedTiles.has(key))) continue;
      const root = await parse(tile.file);
      for (const hash of tile.additionalFiles ?? []) root.add(await parse(hash));
      tiles.set(key, root); roots.add(root);
    }
    for (const panel of ports.includeLibrary === false || (ports.lod ?? 0) !== 0 ? [] : props.panels) { const root = await parse(panel.file); root.visible = panel.visible ?? true; panels.set(panel.id, root); roots.add(root); }
    for (const model of ports.includeLibrary === false ? [] : props.models) models.set(model.id, await parse(model.file));
    const far = props.far === null || ports.lod !== 'far' ? null : await parse(props.far); if (far !== null) { far.visible = ports.lod === 'far'; roots.add(far); }
    assets = undefined;
    const disposeTile = (key: string): void => {
      const root = tiles.get(key); if (root === undefined) return; root.removeFromParent(); tiles.delete(key);
      root.traverse((o) => {
        if (!isMesh(o)) return; if (geometries.delete(o.geometry)) o.geometry.dispose();
        disposeInstanced(o);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const at = held.indexOf(m); if (at !== -1) { held.splice(at, 1); release(m); } }
      });
    };
    ports.scene.add(roots); return { tiles, panels, models, far, disposeTile };
  } catch (error) { roots.removeFromParent(); releaseAll(); throw error; }
}
