import { PaintedGroundSchema, PaintedPanoramaSchema, PainterKeyLightSchema } from '@wildshard/format/paintedResources';
/** The painterly look host's world pieces (G478 point 3, with game/looks/paintedLook): a level that paints its own world
 * (Nalati's panorama painterly) declares them as rows; renderer construction and lifetime hooks stay here. */
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, Material, Vector3, Mesh, MeshLambertMaterial, SphereGeometry, type IUniform, type Scene, type Texture } from 'three';
import * as v from 'valibot';
import type { TerrainPainter } from '@wildshard/engine/render/look';
import type { Scope } from '@wildshard/engine/app/scope';
import { loadTextureRow } from '@wildshard/engine/core/assets';
import { gpuOnlyTrees } from '@wildshard/engine/core/gpuOnly';
import { smoothstep } from '@wildshard/engine/core/noise';
import { TIER } from '@wildshard/engine/core/tier';
import { headingTexture } from '@wildshard/engine/render/dataLook';
import { applyPaintedTerrain, bindPaintedTerrainBake } from '@wildshard/engine/render/families/paintedTerrain';
import { painterlyMaterial, painterlyUniforms, syncPainterlySun } from '@wildshard/engine/world/painterly';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { materialColourGraph } from '@wildshard/engine/render/graph/colourFunction';
import { createOwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { parsePaintedTerrain } from '@wildshard/format/materialFamilies';
import { parseWorldScene } from '@wildshard/format/clientChannels';
import { SpecimenTextureSchema } from '@wildshard/format/specimenCatalogue';
import { loadSpecimenTexture } from '../models/specimenCatalogue';
import { createClientScene } from '../plugin/scene';
import { lentLook, setLentParam, setLentTexture } from '../shardfile/lentLooks';
import { loadFirstPartyFolder, runtimeFolder } from '../shardfile/runtimeFolder';
import type { StaticCaptureUniforms } from './staticCapture';
import { GroundMerge } from '../shardfile/groundMerge';
import { paintedGroundMerge } from './paintedGroundMerge';
import { tileRing } from '../shardfile/tileDriver';
import { followTile, ring, ringRadius, tileKey } from '../shardfile/tileContent';
import type { CellTile } from '../../../shared/game/shardfile/tileOrder';

/**
 * The painted ground (the painterly look host, G478): the level's `surface` (the painted-terrain family's maps, metres,
 * snow and ice) over `layers` of tiled specimen textures (the specimen materials of those names), in a painterly material (`bands`, `rim`, `shade`), recoloured
 * by the product's `colour` function (look/colour-functions) and shaded by the static bake. Its meshes are the product's
 * `shapes` (world/terrain/<id>.glb), stood by the `recipe` (a world scene in a product JSON file's key); `mesh` is the
 * one the terrain answers for. With `tiles` the level's runtime-bound L0 props tiles are that mesh cut at the tile seams
 * (every painted channel kept): they draw in its place, in its material (G669 DR10).
 */

function isGroundMesh(value: unknown): value is Mesh<BufferGeometry, MeshLambertMaterial> {
  return value instanceof Mesh && value.geometry instanceof BufferGeometry && value.material instanceof MeshLambertMaterial;
}
const SpecimenTilesSchema = v.record(v.string(), v.looseObject({ texture: v.optional(SpecimenTextureSchema) }));
/** The level's painted ground from its rows over its specimen materials' `tiles`, shaded by the static capture's `bake`. */
export function paintedGroundPainter(slug: string, input: unknown, tiles: unknown, bake: StaticCaptureUniforms): TerrainPainter {
  const rows = v.parse(PaintedGroundSchema, input), surface = parsePaintedTerrain(rows.surface), materials = v.parse(SpecimenTilesSchema, tiles);
  return { build: async (terrain, field, scope) => {
    const [, textures, product] = await Promise.all([field.ready(), Promise.all(rows.layers.map(name => {
      const texture = materials[name]?.texture; if (texture === undefined) throw new Error(`Missing painted tile ${name}`); return loadSpecimenTexture(texture);
    })), loadFirstPartyFolder(slug)]);
    const material = painterlyMaterial(null, rows.material);
    const colour = product.section('look/colour-functions')[rows.colour];
    if (colour === undefined) throw new Error(`Missing ground colour graph ${rows.colour}`);
    applyPaintedTerrain(material, surface, Object.fromEntries(rows.layers.map((name, index) => [name, textures[index] ?? null]).filter((row): row is [string, Texture] => row[1] !== null)));
    materialColourGraph(material, `${rows.colour}.colour`, colour, true);
    bindPaintedTerrainBake(material, { famTBakeShadow: bake.tBakeShadow, famTBakeMatrix: bake.uBakeMatrix, famTBakeInfo: bake.uBakeInfo,
      famTBakeContact: bake.tBakeContact, famTContactXf: bake.uContactXf });
    const shapes = new Map<string, BufferGeometry>();
    for (const id of rows.shapes) {
      // N1: a tiled ground never decodes its one whole mesh (the tiles draw in its place); the recipe gets an empty stand-in
      if (rows.tiles === true && id === rows.mesh) { shapes.set(id, new BufferGeometry()); continue; }
      const file = `world/terrain/${id}.glb`, owned = createOwnedGeometry(file);
      await owned.load(await product.file(file));
      const geometry = owned.take(); geometry.computeBoundingSphere(); shapes.set(id, geometry);
    }
    const recipe = (await product.json<Readonly<Record<string, unknown>>>(rows.recipe.file))[rows.recipe.key];
    const scene = createClientScene(parseWorldScene(recipe).scene, { geometry: shapes, materials: new Map([['terrain', material]]) });
    const ground = scene.parts.get(rows.mesh);
    if (!isGroundMesh(ground) || !rows.shapes.every(id => isGroundMesh(scene.parts.get(id)))) throw new Error('Missing named ground mesh');
    terrain.material = material; terrain.mesh = ground;
    const groundTiles = rows.tiles === true ? (product.shardfile.props?.tiles ?? []).filter(row => row.lod === 0) : [];
    if (rows.tiles === true && groundTiles.length === 0) throw new Error('A tiled painted ground needs its L0 tiles (its whole mesh is never loaded)');
    if (groundTiles.length > 0) {
      // tile streaming N1a: the tiles draw as one merged mesh (the terrain's mesh, its flags kept) and only the player's
      // 5 x 5 of them stays loaded, followed from the merged mesh's own draws; N1b: the 16 L1 squares (named pair GLBs,
      // world/terrain/ground-l1-<x>-<z>.glb) stay loaded beyond it, each leaving out the quadrants its drawn L0 tiles cover
      const assets = runtimeFolder(product.shardfile).assets, parent = ground.parent === scene.root ? terrain.group : ground.parent;
      if (parent === null) throw new Error('Painted ground mesh has no parent');
      // DL17: a product whose level is complete at control (`ring: 'cell'`) loads its whole cell of ground tiles before play
      const radius = ringRadius(product.shardfile, tileRing), loaded = new Map<number, Scope>();
      // the merged mesh's draws report where the player looks from; the ring follower takes over once it exists
      const follower = { at: (_x: number, _z: number): void => undefined };
      const merge = new GroundMerge(parent, material, ground.name, paintedGroundMerge(terrain, parent, ground, follower));
      // N1b: an L0 tile covers its coarse quadrant once it is merged (drawn), never while it is only wanted
      const drawn = new Set<number>(), coarse: { readonly x: number; readonly z: number; readonly hide: (hidden: ReadonlySet<number>) => void }[] = [];
      const cover = (): void => {
        for (const tile of coarse) {
          const hidden = new Set<number>();
          for (let q = 0; q < 4; q++) if (drawn.has(tileKey({ i: 2 * tile.x + (q & 1), j: 2 * tile.z + (q >> 1) }))) hidden.add(q);
          tile.hide(hidden);
        }
      };
      const read = async (row: (typeof groundTiles)[number], owner: Scope): Promise<Mesh | null> => {
        const owned = createOwnedGeometry(`${slug} ground ${String(row.x)}.${String(row.z)}`);
        await owned.load(await assets.read(row.file));
        const geometry = owned.take(); geometry.computeBoundingSphere();
        if (owner.disposed) { geometry.dispose(); return null; }
        owner.onDispose(() => { geometry.dispose(); });
        return new Mesh(geometry, material);
      };
      const load = async (row: (typeof groundTiles)[number]): Promise<void> => {
        const key = tileKey({ i: row.x, j: row.z }); if (loaded.has(key) || scope.disposed) return;
        const tileScope = scope.child(`painted.ground.t${String(key)}`); loaded.set(key, tileScope);
        const mesh = await read(row, tileScope); if (mesh === null) return;
        merge.add(mesh, tileScope);
        drawn.add(key); cover(); tileScope.onDispose(() => { drawn.delete(key); cover(); });
      };
      const loadLater = async (row: (typeof groundTiles)[number]): Promise<void> => {
        try { await load(row); } catch (error: unknown) { console.warn('[painted ground] tile failed to load', error); }
      };
      let centre: CellTile | null = null;
      follower.at = (x, z) => {
        const next = followTile(centre, x, z);
        if (centre !== null && next.i === centre.i && next.j === centre.j) return;
        centre = next; const keys = ring(next, radius);
        for (const [key, tileScope] of loaded) if (!keys.has(key)) { loaded.delete(key); tileScope.dispose(); }
        for (const row of groundTiles) if (keys.has(tileKey({ i: row.x, j: row.z }))) void loadLater(row);
      };
      // N1: only the spawn's ring loads before play (never all 64 tiles at once); the follower takes over from that centre
      const spawn = product.shardfile.spawn, first = followTile(null, spawn.x, spawn.z), start = ring(first, radius);
      centre = first;
      for (const row of groundTiles) if (start.has(tileKey({ i: row.x, j: row.z }))) await load(row);
      for (let z = 0; z < 4; z++) for (let x = 0; x < 2; x++) {
        const name = `world/terrain/ground-l1-${String(x)}-${String(z)}.glb`; if (!product.hasFile(name) || scope.disposed) continue;
        const owned = createOwnedGeometry(`${slug} ${name}`);
        await owned.load(await product.file(name));
        const pair = owned.take();
        try {
          // the pair's two squares, split back by triangle centroid (each square was clipped at its seams)
          for (const [square, geometry] of splitSquares(pair, 2 * x)) {
            const owner = scope.child(`painted.ground.l1.${String(square)}.${String(z)}`);
            owner.onDispose(() => { geometry.dispose(); });
            coarse.push({ x: square, z, hide: merge.add(new Mesh(geometry, material), owner, { x: square, z }) });
          }
        } finally { pair.dispose(); }
      }
      cover();
      ground.removeFromParent(); ground.geometry.dispose();
    }
    // These owned ground draws never clone or rewrite vertex channels again.
    // Terrain openings and picking use only the retained positions and index.
    gpuOnlyTrees([scene.root], 'painted.ground');
    terrain.group.add(...scene.root.children);
  } };
}

/** N1b: a pair GLB's ground split back into its two L1 squares (`first`, `first + 1` along x) by triangle centroid, each
 *  compacted to the vertices it uses (the bake clipped every square at its seams, so a triangle lies in one square). */
function splitSquares(pair: BufferGeometry, first: number): [number, BufferGeometry][] {
  const position = pair.getAttribute('position'), index = pair.getIndex(), count = index === null ? position.count : index.count;
  const at = (k: number): number => index === null ? k : index.getX(k), boundary = -250 + 125 * (first + 1);
  const squares: [number[], number[]] = [[], []];
  for (let t = 0; t + 2 < count; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    squares[(position.getX(a) + position.getX(b) + position.getX(c)) / 3 >= boundary ? 1 : 0].push(a, b, c);
  }
  return squares.map((triangles, i): [number, BufferGeometry] => [first + i, compactTriangles(pair, triangles)]);
}
function compactTriangles(source: BufferGeometry, triangles: readonly number[]): BufferGeometry {
  const remap = new Map<number, number>(), used: number[] = [];
  const index = triangles.map(vertex => { let at = remap.get(vertex); if (at === undefined) { at = used.length; remap.set(vertex, at); used.push(vertex); } return at; });
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    if (attribute.normalized) throw new Error(`Painted ground pair has a normalized ${name}`);
    const size = attribute.itemSize, values = new Float32Array(used.length * size);
    used.forEach((vertex, i) => { for (let c = 0; c < size; c++) values[i * size + c] = attribute.getComponent(vertex, c); });
    geometry.setAttribute(name, new BufferAttribute(values, size));
  }
  geometry.setIndex(new BufferAttribute(used.length > 65535 ? Uint32Array.from(index) : Uint16Array.from(index), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The painted panorama (the painterly look host, G478): a level whose sky is one painting. The `dome` (a sphere of
 * `radius` and `segments`, drawn first at `order`, centred on the camera) wears its lent `look`, given the painting
 * (`image` per tier, its edge `pad` pixels over the image width, `fallbackWidth` until it reports one), the ridge line's
 * heading texture (the level's `ridge`: v per azimuth sample), the level's fog LUT, the `zenith` colour per tier, the sun each frame
 * and a night fade over the sun's elevation (`night` [from, to] degrees). The level's `sea` mesh (by name) takes its own
 * lent look, sunk to `y`, with the same LUT and sun. Each frame both looks hear the level's lent uniforms, and the `lit`
 * looks hear the painterly world's shade, rim and wet.
 */

type LentValue = number | { toArray: () => number[] };
const shade: number[] = [0, 0, 0], rim: number[] = [0, 0, 0];
/** The painted panorama built from its rows over the level's ridge, fog LUT and lent uniforms. */
export class PaintedPanorama {
  readonly dome: Mesh;
  private readonly rows: v.InferOutput<typeof PaintedPanoramaSchema>;
  private constructor(rows: v.InferOutput<typeof PaintedPanoramaSchema>, dome: Mesh, private readonly uniforms: Readonly<Record<string, IUniform<LentValue>>>) { this.rows = rows; this.dome = dome; }
  static async build(scene: Scene, anisotropy: number, scope: Scope, input: unknown, level: { readonly ridge: readonly number[]; readonly lut: Texture; readonly uniforms: Readonly<Record<string, IUniform<LentValue>>> }): Promise<PaintedPanorama | null> {
    const rows = v.parse(PaintedPanoramaSchema, input), d = rows.dome, p = d.params;
    const image = scope.own(await loadTextureRow({ url: d.image[TIER], srgb: true, wrapT: ClampToEdgeWrapping, anisotropy }));
    if (scope.disposed) return null;
    setLentTexture(d.look, p.image, image); setLentTexture(d.look, p.ridge, scope.own(headingTexture({ samples: level.ridge, stride: 1, half: true })));
    setLentTexture(d.look, p.lut, level.lut);
    const size: unknown = image.image;
    const width = typeof size === 'object' && size !== null && 'width' in size && typeof size.width === 'number' ? size.width : d.fallbackWidth;
    setLentParam(d.look, p.pad, d.pad / Math.max(1, width)); setLentParam(d.look, p.zenith, d.zenith[TIER]);
    const dome = new Mesh(scope.own(new SphereGeometry(d.radius, d.segments[0], d.segments[1])), lentLook(d.look));
    dome.name = d.name; dome.frustumCulled = false; dome.renderOrder = d.order;
    dome.onBeforeRender = (_renderer, _scene, camera) => { camera.getWorldPosition(dome.position); scene.worldToLocal(dome.position); dome.updateMatrixWorld(); };
    scene.add(dome);
    const sea = scene.getObjectByName(rows.sea.name);
    if (sea instanceof Mesh) {
      const old: unknown = sea.material;
      sea.material = lentLook(rows.sea.look); sea.position.y = rows.sea.y;
      setLentTexture(rows.sea.look, rows.sea.lut, level.lut);
      if (old instanceof Material) old.dispose();
    }
    return new PaintedPanorama(rows, dome, level.uniforms);
  }
  /** Push this frame's sun and lent uniforms; the night (0 … 1) the dome fades to. */
  update(sunDir: Vector3, sunElevation: number): number {
    const { dome: d, sea, lit } = this.rows, sun = sunDir.toArray(), night = smoothstep(d.night[0], d.night[1], sunElevation);
    setLentParam(d.look, d.params.sun, sun); setLentParam(sea.look, sea.sun, sun); setLentParam(d.look, d.params.night, night);
    for (const look of [d.look, sea.look]) for (const [key, uniform] of Object.entries(this.uniforms)) {
      const value = uniform.value; setLentParam(look, key, typeof value === 'number' ? value : value.toArray());
    }
    painterlyUniforms.uPShade.value.toArray(shade); painterlyUniforms.uPRimColor.value.toArray(rim);
    for (const look of lit.looks) { setLentParam(look, lit.shade, shade); setLentParam(look, lit.rim, rim); setLentParam(look, lit.wet, painterlyUniforms.uPWet.value); }
    return night;
  }
}

/**
 * The painter's key light (the painterly look host, G478): the sky keeps its painted sun, but the light that shades the
 * world swings `turn` degrees further round (compass, clockwise) and `lift` degrees higher, easing back onto the real sun
 * as it sets (fully cheated above `ease[1]` degrees, not at all below `ease[0]`); only while the key is the sun. The fill
 * goes `mix` of the way to `sky` and `ground` (linear RGB) at `fill` × the hour's intensity, and the grade's saturation
 * follows the hour's own saturation relative to the day's.
 */

/** What the key light reads of the hour's look. */
export interface PainterSkyLook { readonly sunDir: Vector3; readonly keyColor: Color; readonly keyIntensity: number; readonly moon: number;
  readonly hemiSky: Color; readonly hemiGround: Color; readonly hemiIntensity: number; readonly saturation: number }
const D2R = Math.PI / 180, keyDir = new Vector3(), mixed = new Color();
/** The painter's key on a sky rig; `apply` after the rig set the hour's look. */
export class PainterKeyLight {
  private readonly rows: v.InferOutput<typeof PainterKeyLightSchema>;
  private readonly sky: Color; private readonly ground: Color;
  constructor(input: unknown, private readonly rig: SkyRig, private readonly daySaturation: number, private readonly saturation: IUniform<number>) {
    this.rows = v.parse(PainterKeyLightSchema, input); this.sky = new Color(...this.rows.sky); this.ground = new Color(...this.rows.ground);
  }
  apply(look: PainterSkyLook): void {
    const r = this.rows, rig = this.rig;
    if (look.moon <= 0) {
      const d = look.sunDir, el = Math.asin(Math.min(1, Math.max(-1, d.y))), az = Math.atan2(-d.x, d.z);   // compass: 0 = north (+z), +π/2 = east (−x)
      const k = smoothstep(r.ease[0] * D2R, r.ease[1] * D2R, el), az2 = az + r.turn * D2R * k, el2 = Math.max(el, el + r.lift * D2R * k);
      rig.setKeyLight(keyDir.set(-Math.sin(az2) * Math.cos(el2), Math.sin(el2), Math.cos(az2) * Math.cos(el2)), look.keyColor, look.keyIntensity);
      syncPainterlySun(rig);
    }
    rig.hemi.color.copy(look.hemiSky).lerp(mixed.copy(this.sky), r.mix);
    rig.hemi.groundColor.copy(look.hemiGround).lerp(mixed.copy(this.ground), r.mix);
    rig.hemi.intensity = look.hemiIntensity * r.fill;
    this.saturation.value = Math.max(0, 1 + (look.saturation - this.daySaturation));
  }
}
