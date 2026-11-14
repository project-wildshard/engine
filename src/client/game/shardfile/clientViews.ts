/**
 * The shardfile loader's render side (SHARD-PLATFORM SF15a): the `ClientWorldViews` the loader's data side
 * (`tileContent`) injects. The loader admits bytes, owns residency and hands each tile its scope; these views turn the
 * admitted bytes into scene objects under one root and obey that scope. Terrain tiles share the terrain family's one
 * material; props take the family material catalogue (`clientMaterials`). Where a view binds a catalogue material it calls
 * the optional `outline` hook (`clientMaterials().outline`): a graph that declares `stages.outline` draws its hull as each
 * mesh's second draw (terrain tiles, fine prop tiles, library panels and models; the coarse L1 proxy keeps one draw).
 */
import { AdditiveBlending, Box3, BufferAttribute, BufferGeometry, Material, Mesh, ShaderMaterial, StaticDrawUsage, type Object3D, type Texture } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { installTerrainTile, isCoarse, maskTerrainTile } from '@wildshard/engine/world/terrainTileView';
import { decodeTerrainTile, type TerrainTileData } from '@wildshard/format/terrainTileBytes';
import { coarseTileMask } from '@wildshard/engine/world/coarseTileMask';
import { installDeclaredProps, type PropSurfaceBinding } from '@wildshard/engine/world/declaredProps';
import type { ClientWorldViews, ResidentTile } from './tileContent';
import type { GraphOutlineHook } from './clientGraphs';
import { groundMerge, mergeView } from './groundMerge';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { geometryBoundsSteps } from '@wildshard/engine/world/geometryBounds';
import { workSlice } from '@wildshard/engine/core/workSlice';

const isMaterial = (value: unknown): value is Material => value instanceof Material;
const isGeometry = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;
/** A tile mesh no taller than this (m) is flat; within FLOOR of the tile's lowest mesh it lies on the floor and casts no
 *  shadow. */
const FLAT = 0.01, FLOOR = 0.1;
/** An unlit graph (raw colour out) that samples no texture: light, not a surface (graph/glslMaterial.ts's userData marks). */
const isGlow = (material: Material): boolean => material.userData['graphRawOutput'] === true && material.userData['graphMeshMap'] !== true;

function isMesh(object: Object3D): object is Mesh { return object instanceof Mesh; }
/**
 * SHARD-SOURCE AP8: a fine tile mesh that may draw in its material's cross-tile merge: a plain drawn mesh (not instanced or
 * skinned, no morphs, no groups, no hull under it) on one opaque built-in family material. Left out: see-through surfaces
 * and cards (they sort or face the camera one by one), swaying ones (a phase per prop), graph shaders (they may read
 * the mesh's own space) and mirrored meshes.
 */
function mergeable(mesh: Mesh): mesh is Mesh<BufferGeometry, Material> {
  const material: unknown = mesh.material, geometry: unknown = mesh.geometry;
  if (Object.getPrototypeOf(mesh) !== Mesh.prototype || !mesh.visible || mesh.children.length > 0 || !isMaterial(material) || !isGeometry(geometry)) return false;
  if (material instanceof ShaderMaterial || material.transparent || material.userData['sceneAlpha'] === true || material.userData['sceneCard'] === true) return false;
  if (geometry.groups.length > 0 || Object.keys(geometry.morphAttributes).length > 0 || !geometry.hasAttribute('position')) return false;
  // a mirrored mesh (negative scale) would keep its triangles' order in the merge and turn inside out: three flips winding per object
  mesh.updateWorldMatrix(true, false); if (mesh.matrixWorld.determinant() < 0) return false;
  return Object.keys(geometry.attributes).every((name) => !name.startsWith('_') && !name.startsWith('ws'));
}
/** a fine tile has nothing under it to hide */
function noMask(excluded: ReadonlySet<number>): void { if (excluded.size > 0) throw new Error('shardfile views: only a coarse tile masks quadrants'); }

/**
 * The ring-tile views (SHARD-PLATFORM SF18b): the same installers, but into a caller's (detached) `root`, so the render
 * rings' fetch can prepare a tile completely (worker-decoded terrain, parsed prop GLBs) before the synchronous upload
 * only attaches it. Terrain takes wire bytes or `TerrainTileData` already decoded off the main thread.
 */
export interface ClientTileViews {
  /** `ground`: where fine tiles merge (AP8; absent: `root`); a ring passes its shared root, as for props */
  terrain: (input: Uint8Array | TerrainTileData, root: Object3D, scope: Scope, shadow: boolean, ground?: Object3D) => ResidentTile;
  /** `ground`: where a drawn splat ground's tiles merge (absent: `root`); a ring passes its shared root, as each tile's
   *  `root` is its own group */
  props: (props: NonNullable<Shardfile['props']>, key: string, bytes: Uint8Array, root: Object3D, scope: Scope, additional?: ReadonlyMap<string, Uint8Array>, ground?: Object3D) => Promise<ResidentTile | null>;
  /**
   * The declared library panels only (a door, a gate: what `targets.panels` shows and hides), under `root`, each starting at
   * its declared `visible`; no tiles, models or far proxy. The grid draws a neighbour's panels with these (G222 playtest #7).
   */
  panels: (props: NonNullable<Shardfile['props']>, assets: ReadonlyMap<string, Uint8Array>, root: Object3D, scope: Scope) => Promise<ReadonlyMap<string, Object3D>>;
}

/**
 * The view ports: the terrain family's material id, the family `materials`, admitted `textures`, the graph outline hook and
 * the named prop surfaces (SF55; null or absent: every prop draws with `props.family`) and the optional shared terrain lattice.
 */
interface ViewPorts { terrain: string | NonNullable<Shardfile['terrain']> | null; materials: ReadonlyMap<string, Material>; textures: ReadonlyMap<string, Texture>; outline?: GraphOutlineHook; surfaces?: ((name: string) => PropSurfaceBinding | null) | null;
  /** a drawn splat ground's material: its tiles' meshes draw merged, one mesh per material (`groundMerge`) */
  ground?: Material | null;
  /** The decoded terrain collider every tile was cut from: each tile's normals come from it, so tile edges light alike (absent: each tile's own grid). */
  lattice?: TerrainTileData;
  /** The terrain's shadow flags (`terrain.shadow`): a tile casts only when `cast` (and the shadow disc says so), receives only when `receive` (absent: both). */
  terrainShadow?: NonNullable<Shardfile['terrain']>['shadow'] | undefined;
  /** The tiles' draw order among the opaque surfaces (`terrain.order`, three's renderOrder; absent: TERRAIN_ORDER). */
  terrainOrder?: number | undefined;
  /** SHARD-SOURCE AP8: a fine tile's static props draw merged per material across tiles (`propMerge`; absent: true) */
  mergeProps?: boolean }

/** G784: absent `terrain.order`, the ground draws before the opaque surfaces laid on it (a road, a yard, a path), so a
 *  surface at the ground's depth always wins its tie. At renderOrder 0 three broke those ties by material id: a world's
 *  road showed on a cold entry, but a warm return rebuilt the tiles with newer materials and the ground won (Nalati's
 *  green road). Sunscar already asked for this (`order: -1`) to stay ahead of the horizon's rings. */
const TERRAIN_ORDER = -1;

/**
 * Outline what a props root draws: with named surfaces each mesh by its own material (a graph that declares
 * `stages.outline` adds its hull), else the whole root by the family material.
 */
function outlineProps(root: Object3D, ports: ViewPorts, family: Material | undefined, scope: Scope): void {
  const outline = ports.outline; if (outline === undefined) return;
  if (ports.surfaces === null || ports.surfaces === undefined) { if (family !== undefined) outline(root, family, scope); return; }
  const meshes: Mesh[] = []; root.traverse((object) => { if (isMesh(object)) meshes.push(object); });
  for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) outline(mesh, material, scope);
}
const surfacePort = (ports: ViewPorts): { surfaces?: (name: string) => PropSurfaceBinding | null } => (ports.surfaces === null || ports.surfaces === undefined ? {} : { surfaces: ports.surfaces });

/** Ring-tile views over a terrain declaration or family id (query/null: no drawn terrain), the family `materials` and admitted `textures`. */
export function clientTileViews(ports: ViewPorts): ClientTileViews {
  const terrain = ports.terrain;
  const terrainFamily = typeof terrain === 'string' ? terrain : terrain === null || terrain.form === 'query' ? null : terrain.family;
  const material = terrainFamily === null ? null : ports.materials.get(terrainFamily);
  if (material === undefined) throw new Error('shardfile views: the terrain family has no resolved material');
  const cast = ports.terrainShadow?.cast ?? true, receive = ports.terrainShadow?.receive ?? true;
  return {
    terrain: (input, root, scope, shadow, groundRoot) => {
      if (material === null) throw new Error('shardfile views: a terrain tile in a shard without terrain');
      const data = input instanceof Uint8Array ? decodeTerrainTile(input) : input;
      const mesh = installTerrainTile(data, { root, scope, material, shadow: cast && shadow, ...(ports.lattice === undefined ? {} : { lattice: ports.lattice }) });
      if (!receive) mesh.receiveShadow = false;
      mesh.renderOrder = ports.terrainOrder ?? TERRAIN_ORDER;
      const hulls = ports.outline?.(mesh, material, scope) ?? [];
      // AP8: a fine tile with no hull draws in the terrain's merge, one view draw a 250 m block; it still casts itself
      // (the shadow pass only) while its shadow disc says so. A coarse tile keeps its own mesh for its quadrant mask.
      if ((ports.mergeProps ?? true) && hulls.length === 0 && !isCoarse(data)) mergeView(groundRoot ?? root, mesh, material, scope);
      // a coarse tile's mask moves its draw range; its hull (a shallow geometry copy) follows
      const mask = (excluded: ReadonlySet<number>): void => { maskTerrainTile(mesh, excluded); for (const hull of hulls) hull.geometry.setDrawRange(mesh.geometry.drawRange.start, mesh.geometry.drawRange.count); };
      return { mask, shadow: cast ? (enabled) => { mesh.castShadow = enabled; } : () => undefined };
    },
    props: async (props, key, bytes, scene, scope, additional, groundRoot): Promise<ResidentTile | null> => {
      const row = props.tiles.find((tile) => `${tile.lod}/${tile.x}/${tile.z}` === key);
      if (row === undefined) throw new Error(`shardfile views: no props tile ${key}`);
      const installed = await installDeclaredProps(props, { scene, scope, assets: new Map([[row.file, bytes], ...additional ?? []]), materials: ports.materials, textures: ports.textures,
        lod: row.lod, selectedTiles: new Set([key]), includeLibrary: false, ...surfacePort(ports) });
      const root = installed.tiles.get(key); if (root === undefined) return null;
      // P1 draws: a drawn splat ground's tiles merge, the fine tiles on its material, a coarse tile's meshes by material with
      // the fine tiles over it left out (in place of the coarse tile mask), so the ground keeps one draw per material
      // the ring's shared root (`groundRoot`): each ring tile installs in its own group, and a merge under that group drew
      // one mesh a tile (FC16)
      const ground = ports.ground ?? null, parent = groundRoot ?? scene;
      if (ground !== null) {
        const meshes: Mesh[] = []; root.traverse((object) => { if (isMesh(object)) meshes.push(object); });
        if (row.lod === 1) {
          // a coarse tile baked with the splat channels draws in the fine tiles' one mesh; any other mesh merges by material
          const hide = meshes.flatMap((mesh) => {
            const g = mesh.geometry, splat = g.getAttribute('_splat'), canopy = g.getAttribute('_canopy');
            if (g.hasAttribute('_splat') && g.hasAttribute('_canopy')) {
              g.setAttribute('splat', splat); g.setAttribute('canopy', canopy); g.deleteAttribute('_splat'); g.deleteAttribute('_canopy');
              return [groundMerge(parent, ground, 'ground.fine', props.splat?.merge ?? 'quadrant').add(mesh, scope, { x: row.x, z: row.z })];
            }
            const drawn: unknown = mesh.material; return isMaterial(drawn) ? [groundMerge(parent, drawn, 'ground.coarse').add(mesh, scope, { x: row.x, z: row.z })] : [];
          });
          return { mask: (excluded) => { for (const set of hide) set(excluded); }, shadow: () => undefined };
        }
        for (const mesh of meshes) if (mesh.material === ground) groundMerge(parent, ground, 'ground.fine', props.splat?.merge ?? 'quadrant').add(mesh, scope);
      }
      if (row.lod !== 1) outlineProps(root, ports, ports.materials.get(props.family), scope);
      // what each mesh was baked to do (a GLB node's castShadow flag); the shadow disc only ever turns it off. An additive
      // material is light (a pool, a hologram, a beam), and so is an unlit graph that samples no texture (a lantern's glow,
      // a string light; a textured unlit surface, a poster or a gate, still casts): neither casts (RM12: Night Market's
      // pools and glow were two shadow-map draws a tile; at runtime, so no tile byte changes). A flat mesh at the tile's floor (water, a ground sheet) has nothing in
      // its tile under it to shade, so it casts nothing either; a raised flat one (an awning, a deck) still does (RM12: the
      // canals' water was another depth draw a tile)
      const lit: { mesh: Mesh; box: Box3 }[] = [], candidates: Mesh[] = []; let floor = Infinity;
      root.traverse((object) => {
        if (isMesh(object) && object.castShadow) candidates.push(object);
      });
      const slice = workSlice(undefined, scope);
      const live = (): void => { if (scope.disposed || scope.disposing) throw new Error('Tile caster owner left'); };
      for (const object of candidates) {
        live();
        const drawn: unknown = object.material;
        if (isMaterial(drawn) && (drawn.blending === AdditiveBlending || isGlow(drawn))) { object.castShadow = false; continue; }
        const geometry: unknown = object.geometry;
        if (isGeometry(geometry) && geometry.boundingBox === null && geometry.morphAttributes.position === undefined
          && geometry.getAttribute === BufferGeometry.prototype.getAttribute && geometry.computeBoundingBox === BufferGeometry.prototype.computeBoundingBox) {
          const position: unknown = geometry.getAttribute('position');
          if (position instanceof BufferAttribute && position.array.buffer instanceof ArrayBuffer && position.usage === StaticDrawUsage
            && position.getX === BufferAttribute.prototype.getX && position.getY === BufferAttribute.prototype.getY && position.getZ === BufferAttribute.prototype.getZ) {
            const array = position.array, length = array.length, version = position.version, count = position.count,
              itemSize = position.itemSize, normalized = position.normalized, steps = geometryBoundsSteps(geometry, 'box');
            try {
              for (;;) {
                live();
                if (geometry.boundingBox !== null || geometry.getAttribute('position') !== position || position.array !== array || array.length !== length
                  || position.version !== version || position.count !== count || position.itemSize !== itemSize || position.normalized !== normalized
                  || position.usage !== StaticDrawUsage || geometry.morphAttributes.position !== undefined
                  || position.getX !== BufferAttribute.prototype.getX || position.getY !== BufferAttribute.prototype.getY || position.getZ !== BufferAttribute.prototype.getZ) break;
                if (steps.next().done === true) break;
                await slice.check();
              }
            } finally { steps.return(); }
          }
        }
        const box = new Box3().setFromObject(object); lit.push({ mesh: object, box }); floor = Math.min(floor, box.min.y);
        await slice.check();
      }
      live();
      const casters: Mesh[] = [];
      for (const { mesh, box } of lit) {
        if (box.max.y - box.min.y < FLAT && box.max.y <= floor + FLOOR) mesh.castShadow = false; else casters.push(mesh);
      }
      // AP8: a fine tile's plain static meshes join their material's merge under the shared root, so a view draws each
      // material once a 250 m block, not once a tile; each still casts itself (the shadow pass only) as its disc says
      if (row.lod === 0 && (ports.mergeProps ?? true)) {
        const meshes: Mesh[] = []; root.traverse((object) => { if (isMesh(object)) meshes.push(object); });
        for (const mesh of meshes) if (mergeable(mesh)) mergeView(parent, mesh, mesh.material, scope);
      }
      const shadow = (enabled: boolean): void => { for (const mesh of casters) mesh.castShadow = enabled; };
      if (row.lod === 1) {
        const apply = coarseTileMask(root, row.x, row.z, scope);
        const mask = (excluded: ReadonlySet<number>): void => {
          apply(excluded);
          root.userData['coarseTiles'] = [{ x: row.x, z: row.z, visible: excluded.size < 4 }];
        };
        mask(new Set()); shadow(false); return { mask, shadow: () => undefined };
      }
      return { mask: noMask, shadow };
    },
    panels: async (props, assets, root, scope) => {
      const installed = await installDeclaredProps({ ...props, models: [] }, { scene: root, scope, assets, materials: ports.materials, textures: ports.textures, lod: 0, selectedTiles: new Set(), ...surfacePort(ports) });
      const family = ports.materials.get(props.family);
      for (const panel of installed.panels.values()) outlineProps(panel, ports, family, scope);
      return installed.panels;
    },
  };
}

/**
 * The views for one shardfile scene: terrain tiles in `terrain` (the terrain family's material id, null when the shard has
 * no terrain), props from the resolved family `materials` and admitted `textures`, all under `root`.
 */
export function clientViews(ports: ViewPorts & { root: Object3D }): ClientWorldViews & { readonly tiles: ClientTileViews } {
  const tiles = clientTileViews(ports);
  return {
    tiles,
    terrain: (bytes, scope, shadow) => tiles.terrain(bytes, ports.root, scope, shadow),
    library: async (props, assets, scope) => {
      const installed = await installDeclaredProps(props, { scene: ports.root, scope, assets, materials: ports.materials, textures: ports.textures, lod: 0, selectedTiles: new Set(), ...surfacePort(ports) });
      const family = ports.materials.get(props.family);
      for (const root of [...installed.panels.values(), ...installed.models.values()]) outlineProps(root, ports, family, scope);
      return installed;
    },
    props: (props, key, bytes, scope, additional) => tiles.props(props, key, bytes, ports.root, scope, additional),
  };
}
