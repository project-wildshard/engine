import * as THREE from 'three';
import * as v from 'valibot';
import { app } from '@wildshard/engine/app/runtime';
import { CHUNK_HALF, SEED } from '@wildshard/engine/core/config';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import { Rng } from '@wildshard/engine/core/rng';
import { TIER } from '@wildshard/engine/core/tier';
import { floorBelow } from '@wildshard/engine/physics/query';
import { pondMask, streamAt } from '@wildshard/engine/world/Heightfield';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { WaterSurface } from '../systems/looks/waterSurface';
import { ForestRoofMask } from '../looks/forestRoofMask';
import { forestPage } from '../shardfile/forestPage';
import type { ShardContext } from '../plugin/context';
import { rainCurtainGeometry } from '../systems/looks/rainCurtain';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { graphParamRoots } from '../looks/graphDaySky';
import { RainPresentationSchema, type RainPresentationRows } from '@wildshard/format/rainPresentation';
import { GeometryPack } from '@wildshard/engine/models/geometryPack';
import { fetchLaneBake } from '../plugin/geometry';
import { lentLook, pushLentParams, setLentParam, setLentTexture } from '../shardfile/lentLooks';

/**
 * A level's rain as rows (G474 weather presentation, `format/rainPresentation`; client-only): the rain round the camera
 * with the canopy's drips in it, the puddles in the ground's low spots, the splashes at the player's feet and the drops on
 * the lens. Everything reads a weather reading (rain, wet); nothing here decides anything.
 *
 *   const rain = await installRainPresentation(ctx, rows); scene.add(rain.group)
 *   rain.update(dt, weather, wind, camera)   // the camera: the extras (splashes round it, drops on its lens)
 *
 * THE RAIN: a camera-local curtain (`rainCurtainGeometry`) of streak quads in a box round the eye, built in the vertex
 * stage of the `programs.rain` graph, the count following the intensity. THE COVER MAP: a `coverN`² texture over the
 * level (R the baked crowns, G the roof mask), lent to that graph: it stops the rain under a roof and turns most of it
 * under the crowns into drips; the hood's frame and box are its `cave` / `caveBox` params. THE PUDDLES: the baked discs,
 * drawn by the row's water surface at a fading alpha. THE EXTRAS: the splashes (one instanced draw, respawned on the CPU
 * round the eye; none under a roof or the hood, fewer under the crowns) and the lens drops (screen-space quads in the
 * `programs.lens` graph). The graphs' params are the client channel group `programs.channels`, over the reading this fills.
 *
 * A practice room has none of it. Draws: 0 while dry; raining 4. Programs: +3.
 */
export class RainPresentation {
  /** everything it draws (hidden while dry) */
  readonly group: THREE.Group = new THREE.Group();
  /** the curtain */
  rain!: THREE.Mesh;
  /** the merged puddle discs */
  puddles!: THREE.Mesh;
  /** R = crown cover 0..1, G = roof; world x/z → uv = (p + CHUNK_HALF) / (2 CHUNK_HALF) */
  cover!: THREE.DataTexture;
  /** the splashes at the feet */
  splashes!: THREE.Mesh;
  /** the drops on the lens */
  lens!: THREE.Mesh;
  /** the rain's rings (0 … 1) on every `rings` water look: a channel owner */
  readonly rings: { readonly uRainRings: { value: number } };
  private readonly coverN: number;
  private readonly coverData: Uint8Array;
  /** the hood's frame (x, z, cos yaw, sin yaw) and box (half width, lz from, lz to, ceiling y); all 0 with none */
  private readonly cave = new THREE.Vector4();
  private readonly caveBox = new THREE.Vector4();
  private readonly phone = TIER === 'phone';
  private readonly rainCount: number;
  /** the frame's reading the channel group reads, and its evaluation (which pushes the graphs' params) */
  private readonly seen = { on: 0, rain: 0, dry: 0, cover: 0, lookY: 0, room: 0, radius: 0, slots: 0, windX: 0, windZ: 0 };
  private frame!: (dt: number) => void;
  private param!: (id: string, name: string) => number;
  private splashAttr!: THREE.InstancedBufferAttribute;
  private splashNext = 0;
  private splashAcc = 0;
  private readonly eye = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, -1);
  private readonly xrng = new Rng(SEED ^ 0x7e11);

  /** `rows` the validated rain rows, `roofs` the roof mask, `pack` the bake (the puddles, then the crowns' floats). */
  private constructor(private readonly rows: RainPresentationRows, private readonly roofs: ForestRoofMask, private readonly pack: GeometryPack, private readonly channels: unknown) {
    const look = rows.look, hood = rows.hood;
    this.coverN = look.coverN;
    this.coverData = new Uint8Array(this.coverN * this.coverN * 4);
    if (hood) { this.cave.set(hood.x, hood.z, Math.cos(hood.rot), Math.sin(hood.rot)); this.caveBox.set(hood.hw, hood.lz0, hood.lz1, heightAt(hood.x, hood.z) + hood.up); }
    this.rainCount = this.phone ? look.streaks.phone : look.streaks.desktop;
    this.seen.radius = this.phone ? 11 : 16; this.seen.slots = this.phone ? look.lensDrops.phone : look.lensDrops.desktop;
    let rings = 0;
    this.rings = { uRainRings: { get value(): number { return rings; }, set value(value: number) { rings = value; for (const id of rows.rings) setLentParam(id, 'rain', value); } } };
  }

  /** Admit rain rows and their page's roof decks, fetch the tier's bake and build the cover map and the four meshes. */
  static async install(ctx: ShardContext, input: unknown): Promise<RainPresentation> {
    const scope = ctx.scope, product = ctx.product, runtime = ctx.game.runtime, world = runtime?.world;
    const game = world?.game, sky = world?.sky, root = game?.scene, owner = game?.levelScope;
    const live = (): void => {
      if (scope.disposed || scope.disposing || owner?.disposed === true || owner?.disposing === true || ctx.scope !== scope || ctx.product !== product || ctx.game.runtime !== runtime || runtime?.world !== world
        || world?.game !== game || world?.sky !== sky || game?.scene !== root || game?.levelScope !== owner)
        throw new Error('Rain construction owner left or changed');
    };
    live();
    const rows = v.parse(RainPresentationSchema, input), bake = TIER === 'phone' ? rows.bake.phone : rows.bake.desktop;
    const roofs = new ForestRoofMask({ floors: forestPage(ctx.scope, rows.cover.page).rows.buildings.floors, roofs: rows.cover.roofs });
    const bytes = await fetchLaneBake(bake.url); live();
    return new RainPresentation(rows, roofs, new GeometryPack(bytes, bake.rows, rows.name), product.shardfile.clientChannels).build();
  }

  private build(): this {
    this.cover = this.buildCover();
    this.rain = this.buildRain();
    this.puddles = this.buildPuddles();
    this.splashes = this.buildSplashes();
    this.lens = this.buildLens();
    this.group.add(this.rain, this.puddles, this.splashes, this.lens);
    this.group.name = this.rows.name;
    const p = this.rows.programs, params = graphParamRoots(this.channels, p.channels, [p.rain, p.splash, p.lens]);
    const lane = installChannelPrograms(this.channels, p.channels, new Map<string, unknown>([['rain', this.seen], ...params.roots]));
    this.frame = (dt) => { lane.evaluate({ time: 0, delta: dt, values: {} }); pushLentParams(params); };
    this.param = (id, name) => { const value = params.roots.get(id)?.[name]; return typeof value === 'number' ? value : 0; };
    return this;
  }

  /** the cover map's byte `ch` (0 R the crowns, 1 G a roof) at (x, z); 0 off the map */
  private texel(x: number, z: number, ch: number): number {
    const N = this.coverN, i = Math.floor((x + CHUNK_HALF) / (2 * CHUNK_HALF) * N), j = Math.floor((z + CHUNK_HALF) / (2 * CHUNK_HALF) * N);
    return i < 0 || j < 0 || i >= N || j >= N ? 0 : this.coverData[(j * N + i) * 4 + ch] ?? 0;
  }

  /** crown cover (0..1) at (x, z), from the CPU copy of the cover map (the animals' shelter, the ambience) */
  coverAt(x: number, z: number): number { return this.texel(x, z, 0) / 255; }

  /** no rain reaches (x, y, z): under a roof (the cover map's G) or in the hood */
  private dryAt(x: number, y: number, z: number): boolean {
    if (this.texel(x, z, 1) > 127) return true;
    const c = this.cave, b = this.caveBox, dx = x - c.x, dz = z - c.y;
    const lx = dx * c.z - dz * c.w, lz = dx * c.w + dz * c.z;
    return Math.abs(lx) < b.x && lz > b.y && lz < b.z && y < b.w;
  }

  private buildCover(): THREE.DataTexture {
    const d = this.coverData, N = this.coverN, cell = (2 * CHUNK_HALF) / N, crowns = this.pack.floats(1);
    for (let j = 0; j < Math.min(N, 1024); j++) for (let i = 0; i < Math.min(N, 1024); i++) {
      const k = j * N + i;
      d[k * 4] = crowns[k] ?? 0;
      d[k * 4 + 1] = this.roofs.contains(-CHUNK_HALF + (i + 0.5) * cell, -CHUNK_HALF + (j + 0.5) * cell) ? 255 : 0;
      d[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /** the streak quads in the `programs.rain` graph, lent the cover map and given the hood once */
  private buildRain(): THREE.Mesh {
    const id = this.rows.programs.rain;
    setLentTexture(id, 'cover', this.cover);
    setLentParam(id, 'coverK', 1 / (2 * CHUNK_HALF));
    setLentParam(id, 'cave', this.cave.toArray());
    setLentParam(id, 'caveBox', this.caveBox.toArray());
    setLentParam(id, 'radius', this.seen.radius);
    const m = new THREE.Mesh(rainCurtainGeometry(this.rainCount, SEED, 'aSeed'), lentLook(id));
    m.frustumCulled = false; m.renderOrder = 20; m.visible = false; m.name = 'rain';
    return m;
  }

  /** the baked discs (no normals in the bake) in the row's water surface */
  private buildPuddles(): THREE.Mesh {
    const geo = this.pack.geometry(0);
    geo.computeVertexNormals();
    const mesh = new WaterSurface(this.rows.water, { material: lentLook(this.rows.water.look) }).draw(geo).mesh;
    mesh.visible = false;
    return mesh;
  }

  /** one instanced draw in `programs.splash`: per slot a flat ripple ring (verts 0–3) and a crown of droplets (4–7) */
  private buildSplashes(): THREE.Mesh {
    const n = this.phone ? this.rows.look.splashes.phone : this.rows.look.splashes.desktop;
    const geo = new THREE.InstancedBufferGeometry();
    const corner = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1]);
    geo.setAttribute('position', new THREE.BufferAttribute(corner, 3)); // xy the corner, z 0 ring / 1 crown
    geo.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
    this.splashAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(-1e4), 4);
    this.splashAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSplash', this.splashAttr);
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.Mesh(geo, lentLook(this.rows.programs.splash));
    m.frustumCulled = false; m.renderOrder = 21; m.visible = false; m.name = 'rain-splashes';
    return m;
  }

  /** new splashes this frame round the eye (more in front of it), none where no rain lands, fewer under the crowns */
  private spawnSplashes(dt: number, rain: number): void {
    const a = this.splashAttr, arr = a.array, n = a.count, rng = this.xrng, t = this.param(this.rows.programs.splash, 'time');
    this.splashAcc += dt * rain * (this.phone ? 70 : 110);
    const phys = app.physics;
    let wrote = false;
    for (let guard = 0; this.splashAcc >= 1 && guard < 12; guard++) {
      this.splashAcc -= 1;
      // a point within 7 m, weighted to the view (a cone ± 70° round the look, 3 in 4)
      const front = rng.next() < 0.75, yaw = Math.atan2(this.fwd.x, this.fwd.z) + (front ? rng.range(-1.2, 1.2) : rng.range(0, Math.PI * 2));
      const d = 0.8 + 6.2 * Math.sqrt(rng.next()), x = this.eye.x + Math.sin(yaw) * d, z = this.eye.z + Math.cos(yaw) * d;
      if (pondMask(x, z) > 0.01 || streamAt(x, z) !== null) continue; // the water has its own rings
      if (rng.next() < 0.8 * this.coverAt(x, z)) continue;             // the crowns catch most of it
      const fy = phys ? floorBelow(phys, x, z, this.eye.y + 2.5, 8) : undefined;
      if (fy !== undefined && fy > this.eye.y - 0.4) continue; // a trunk / a rock at the eye: not the ground at the feet
      const y = fy ?? heightAt(x, z);
      if (this.dryAt(x, y + 0.2, z)) continue;
      const k = this.splashNext++ % n;
      arr[k * 4] = x; arr[k * 4 + 1] = y; arr[k * 4 + 2] = z; arr[k * 4 + 3] = t + rng.range(0, 0.05);
      wrote = true;
    }
    if (this.splashAcc > 1) this.splashAcc = 1;
    if (wrote) a.needsUpdate = true;
  }

  /** one clip-space quad a slot over everything; the `programs.lens` graph lands, slides and dries each slot's drops */
  private buildLens(): THREE.Mesh {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.instanceCount = this.seen.slots;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = lentLook(this.rows.programs.lens);
    mat.depthTest = false; // over everything
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = 1000; m.visible = false; m.name = 'rain-lens';
    return m;
  }

  /** `w` the reading (rain, wet 0..1), `wind` the world wind (m/s, xz) for the slant, `cam` the view (the extras) */
  update(dt: number, w: { readonly rain: number; readonly wet: number }, wind: { x: number; z: number }, cam?: THREE.Camera): void {
    // the curtain is camera-local, so it would follow the eye into a practice room: none there, like the extras below
    const room = practiceRoom.open, rainOn = w.rain > 0.01 && !room, s = this.seen, programs = this.rows.programs;
    if (cam && !room) { cam.getWorldPosition(this.eye); cam.getWorldDirection(this.fwd); }
    s.on = Number(rainOn); s.rain = w.rain; s.room = Number(room); s.windX = wind.x; s.windZ = wind.z; s.lookY = this.fwd.y;
    s.dry = Number(this.dryAt(this.eye.x, this.eye.y, this.eye.z)); s.cover = this.coverAt(this.eye.x, this.eye.z);
    this.frame(dt);
    this.rain.visible = rainOn;
    if (rainOn) this.rain.geometry.setDrawRange(0, Math.ceil(this.rainCount * Math.min(1, w.rain * 1.1)) * 6); // the streaks follow the intensity
    const puddles = THREE.MathUtils.smoothstep(w.wet, 0.05, 0.6);
    setLentParam(this.rows.water.look, 'fade', puddles);
    this.puddles.visible = puddles > 0.01;
    this.splashes.visible = rainOn;
    this.lens.visible = !room && this.param(programs.lens, 'wet') > 0.002;
    if (room) return;
    if (cam instanceof THREE.PerspectiveCamera) setLentParam(programs.lens, 'aspect', cam.aspect); // the screen's shape
    if (rainOn) this.spawnSplashes(dt, w.rain);
  }
}
