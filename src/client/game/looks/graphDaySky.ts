import { loadLUT, preloadBakedTextures } from '@wildshard/engine/boot/bakedApi';
import { resourceScope } from '@wildshard/engine/app/resources';
import { heldFrameTurn } from '@wildshard/engine/core/framePacing';
import type { OffscreenPass, SkyBackdrop, SkyBackdropContext, SkyBackdropFactory, SkyBackdropPost, SkyBackdropTargets } from '@wildshard/engine/render/look';
import { prepareOffscreenBuild, warmOffscreenBuild } from '@wildshard/engine/render/offscreenBuild';
import { SkyEnvironment, type SkyEnvironmentRefresh, type SkyEnvironmentSource } from '@wildshard/engine/render/skyEnvironment';
import type { DayCycle } from '@wildshard/engine/world/dayCycle';
import { admittedChannelTable, installChannelPrograms } from '@wildshard/engine/game/plugin/channelPrograms';
import { lookGraphMaterials } from '@wildshard/engine/game/plugin/shaderFamily';
import * as THREE from 'three';
import { tierPmremCube, tierPmremGenerator } from '@wildshard/engine/render/pmremSize';

/**
 * A day sky drawn on material graphs, as a backdrop (SHARD-PLATFORM W2 C2; Pine Hollow's keyed sky and Driftwood's
 * faceted day): the lifecycle every graph day sky shares, so a shard writes only its sky and its clock's frame.
 *
 * THE HOST compiles the sky's graphs from the shard's look catalogue on the page renderer (they leave with the backdrop's
 * owner), preloads the baked textures and the level's LUT beside them, adds the dome to the scene (the background off),
 * owns the image-based light (`SkyEnvironment`: the source PMREM'd in place, refreshed on its timer; a scene source may
 * build its first environment offscreen), runs the clock (`onSet`: wait for what the phase needs, snap every knob, redraw
 * the environment), keeps the dome on the camera when asked, and frees the dome, the environment pass and the environment
 * when the backdrop leaves (a grid region's layered sky, G223), reporting their GPU bytes.
 *
 * THE DOME is a row (`dome`: its graph, radius and segments, draw order): one back-faced sphere, no depth test, untouched by
 * the material's tone map (the post chain grades it), built by the host and handed to `build`.
 *
 * THE CHANNELS (`channels`, H4): the shard's declared numeric channel group (`clientChannels` rows,
 * `@wildshard/engine/game/plugin/channelPrograms`) is the sky's frame as data. From `bind` on, after the shard's `drive`, the host
 * fills the `clock` owner (`phase`, `day` 1 / 0, `night`, `sunX…Z`, `moonX…Z`), evaluates the group over it, the shard's
 * own numeric owners (`owners`: its blended preset, its uniforms) and the backdrop's targets (`sky.fog` `{ color }`,
 * `sky.fogSun`, `sky.disc` (its transform), `sky.discColour` `{ color }`, `sky.planetSun`, `sky.planetHaze`), then pushes
 * every graph param an output names (target = a sky graph id, path `[param]` or `[param, x|y|z|w]`) through `setParam`.
 *
 * THE SHARD builds its sky from the compiled graphs and the dome (`build`): its environment source, its running clock
 * (`runDayClock`), its frame (`drive`: what the channels don't turn, from `bind` on, `snap` at a jump) and whatever it holds
 * beyond them (decoded keys: `prepare`, `bytes`, `ceiling`, `rebuild`, `dispose`). Nothing here knows a shard or its sky.
 *
 *   backdrop: graphDaySkyBackdrop({ name, source, ids: [dome, env], dome: { graph, radius, segments, order }, channels, build })
 */

/** A day sky's compiled graphs: a material by look.materials id, and the checked param / texture setters. */
export interface DaySkyGraphs {
  readonly material: (id: string) => THREE.Material;
  readonly setParam: (id: string, name: string, value: number | number[]) => void;
  readonly setTexture: (id: string, name: string, texture: THREE.Texture) => void;
}

/** The image-based light a day sky refreshes: its source and timer; `offscreenFirst` builds a scene source's first PMREM
 *  offscreen (WebKit) when the backdrop builds, instead of on its first bind. */
export interface DaySkyEnvironment {
  readonly source: SkyEnvironmentSource;
  readonly refresh: SkyEnvironmentRefresh;
  readonly offscreenFirst?: boolean;
}

/** What a shard's day sky is, once built from its graphs. */
export interface DaySkyBody<K> {
  /** its running clock (`runDayClock`): the host sets its `onSet` */
  readonly clock: DayCycle<K>;
  /** the numeric owners the channel group reads and writes beyond the clock, the graphs and the targets */
  readonly owners?: ReadonlyMap<string, unknown>;
  /** true: the host keeps the dome on the camera; false: Game does (it is handed over as the backdrop's `clouds`) */
  readonly follow: boolean;
  readonly environment: DaySkyEnvironment;
  /** the colour of the horizon the sky's dressing fades into */
  readonly horizon: THREE.Color;
  /** every knob the clock turns, at its phase, each frame and at a jump (`snap`); `targets` null until `bind`, `post` until
   *  `attachPost` */
  readonly drive: (targets: SkyBackdropTargets | null, post: SkyBackdropPost | null, snap: boolean) => void;
  /** each frame, before the clock moves (the sky's own timers) */
  readonly tick?: (dt: number) => void;
  /** before a jump snaps: load what the clock's new phase needs (decoded keys) */
  readonly prepare?: () => Promise<void>;
  /** once at bind, before the first frame (a target the sky sets only once) */
  readonly bound?: (targets: SkyBackdropTargets) => void;
  /** GPU bytes the sky holds now / at most beyond the dome and the environment */
  readonly bytes?: () => number;
  readonly ceiling?: () => number;
  /** after a context loss, before the host re-snaps the clock: drop what the GPU lost */
  readonly rebuild?: () => void;
  /** free what the sky holds beyond the dome and the environment */
  readonly dispose?: () => void;
  /** the backdrop's other fields (update order, the planet, the palette a horizon matte blends with) */
  readonly backdrop?: Pick<SkyBackdrop, 'updateAt' | 'fadesPlanet' | 'palette'>;
}

/** What a graph day sky backdrop is built from. */
export interface GraphDaySkySpec<K> {
  /** the shard's name, for errors */
  readonly name: string;
  /** the shard's declaration, and the look.materials ids of the sky's graphs */
  readonly source: Parameters<typeof lookGraphMaterials>[2];
  readonly ids: readonly string[];
  /** the dome: one of `ids`, a back-faced sphere of this radius and [width, height] segments, drawn at `order` */
  readonly dome: { readonly graph: string; readonly radius: number; readonly segments: readonly [number, number]; readonly order: number; readonly name?: string };
  /** the declared numeric channel group the sky's frame runs on (see the module comment) */
  readonly channels?: string;
  readonly build: (context: SkyBackdropContext, graphs: DaySkyGraphs, dome: THREE.Mesh) => Promise<DaySkyBody<K>>;
}

/** the clock as numeric owner fields (filled each frame) */
interface ClockOwner { phase: number; day: number; night: number; sunX: number; sunY: number; sunZ: number; moonX: number; moonY: number; moonZ: number }
const AXES = ['x', 'y', 'z', 'w'];

/** A plain numeric root per graph param a numeric channel group's outputs name (target = a graph id in `ids`, path
 *  `[param]` or `[param, x|y|z|w]`), to hand `installChannelPrograms` as owners, and the push that moves them into the
 *  graphs (`setParam` of the compiled looks they live in) after each evaluation (the graph day sky's frame; Pine Hollow's
 *  rain, over its lent looks). */
export function graphParamRoots(rows: unknown, group: string, ids: readonly string[]): {
  roots: Map<string, Record<string, number | Record<string, number>>>; push: (looks: Pick<DaySkyGraphs, 'setParam'>) => void;
} {
  const roots = new Map<string, Record<string, number | Record<string, number>>>(), sizes = new Map<string, Map<string, number>>();
  for (const row of admittedChannelTable(rows)) for (const out of row.numeric?.group === group ? row.numeric.outputs : []) {
    const [param, axis] = out.path;
    if (!ids.includes(out.target) || param === undefined) continue;
    const root = roots.get(out.target) ?? {}, size = sizes.get(out.target) ?? new Map<string, number>();
    roots.set(out.target, root); sizes.set(out.target, size);
    if (axis === undefined) { root[param] = 0; size.set(param, 0); continue; }
    const at = AXES.indexOf(axis);
    if (at === -1) throw new Error(`graph day sky: ${out.target}.${param} has no axis ${axis}`);
    const vec = root[param], parts = typeof vec === 'object' ? vec : {};
    parts[axis] = 0; root[param] = parts;
    size.set(param, Math.max(size.get(param) ?? 0, at + 1));
  }
  const pushes: ((looks: Pick<DaySkyGraphs, 'setParam'>) => void)[] = [];
  for (const [id, root] of roots) for (const [param, size] of sizes.get(id) ?? []) {
    const out = Array.from({ length: size }, () => 0);
    pushes.push((looks) => {
      const v = root[param];
      if (typeof v === 'number') { looks.setParam(id, param, v); return; }
      for (let i = 0; i < size; i++) out[i] = v?.[AXES[i] ?? 'x'] ?? 0;
      looks.setParam(id, param, out);
    });
  }
  return { roots, push: (looks) => { for (const push of pushes) push(looks); } };
}

/** free a mesh's geometry and material(s) */
function freeMesh(o: THREE.Object3D): void {
  if (!(o instanceof THREE.Mesh)) return;
  const geometry: unknown = o.geometry, material: unknown = o.material, list: unknown[] = Array.isArray(material) ? material : [material];
  if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
  for (const m of list) if (m instanceof THREE.Material) m.dispose();
}

/** A shard's graph day sky as a sky backdrop (see the module comment). */
export function graphDaySkyBackdrop<K>(spec: GraphDaySkySpec<K>): SkyBackdropFactory {
  return async (context) => {
    const { scene, renderer, level } = context, owner = resourceScope();
    const [compiled, , lut] = await Promise.all([lookGraphMaterials(owner, context, spec.source, spec.ids), preloadBakedTextures(), loadLUT(level.id)]);
    const graphs: DaySkyGraphs = { setParam: compiled.setParam, setTexture: compiled.setTexture, material: (id) => {
      const m = compiled.materials.get(id);
      if (m === undefined) throw new Error(`${spec.name}: look.materials lacks the sky graph ${id}`);
      return m;
    } };
    const domeRow = spec.dome, domeMaterial = graphs.material(domeRow.graph);
    domeMaterial.side = THREE.BackSide; domeMaterial.depthTest = false; domeMaterial.toneMapped = false;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(domeRow.radius, domeRow.segments[0], domeRow.segments[1]), domeMaterial);
    dome.frustumCulled = false; dome.renderOrder = domeRow.order;
    if (domeRow.name !== undefined) dome.name = domeRow.name;
    const body = await spec.build(context, graphs, dome), { clock, environment } = body, source = environment.source;
    scene.background = null;
    scene.add(dome);
    const env = new SkyEnvironment(renderer, scene, source, environment.refresh);
    if (environment.offscreenFirst === true && source.kind === 'scene') {
      const prepared: { generator: THREE.PMREMGenerator | null } = { generator: null };
      try {
        const first = await prepareOffscreenBuild(renderer, (commands) => {
          prepared.generator = tierPmremGenerator(commands);
          return prepared.generator.fromScene(source.scene, 0, source.near, source.far, { size: tierPmremCube(source.size) });
        }, () => !owner.disposed, { webKitOnly: true });
        env.adopt(prepared.generator, first);
      } catch (error) { prepared.generator?.dispose(); throw error; }
    } else if (source.kind === 'equirect') {
      // DL23 (Pine's Sky frame, 298-412 ms on the Simulator): the bind's first refresh linked the environment pass's and
      // PMREM's equirect and GGX programs inside one frame. They link in parallel here, before the bind, whose refresh
      // then draws with this generator (WebKit; elsewhere nothing changes)
      const warmed: { generator: THREE.PMREMGenerator | null } = { generator: null };
      try {
        await warmOffscreenBuild(renderer, (commands) => {
          const generator = tierPmremGenerator(commands);
          warmed.generator = generator;
          commands.setRenderTarget(source.target);
          commands.render(source.scene, source.camera);
          return generator.fromEquirectangular(source.target.texture, null);
        }, () => !owner.disposed, { webKitOnly: true });
      } catch (error) { warmed.generator?.dispose(); throw error; }
      if (warmed.generator !== null) env.prime(warmed.generator);
    }
    let targets: SkyBackdropTargets | null = null, post: SkyBackdropPost | null = null;
    const group = spec.channels, params = group === undefined ? null : graphParamRoots(spec.source.clientChannels, group, spec.ids);
    const clockOwner: ClockOwner = { phase: 0, day: 0, night: 0, sunX: 0, sunY: 0, sunZ: 0, moonX: 0, moonY: 0, moonZ: 0 };
    const sun = new THREE.Vector3(), moon = new THREE.Vector3();
    let channels: ReturnType<typeof installChannelPrograms> | null = null;
    const bindChannels = (T: SkyBackdropTargets): void => {
      if (group === undefined || params === null) return;
      const disc: unknown = T.disc.material, discColour = disc instanceof THREE.MeshBasicMaterial ? { color: disc.color } : null;
      channels = installChannelPrograms(spec.source.clientChannels, group, new Map<string, unknown>([
        ['clock', clockOwner], ...params.roots, ...(body.owners ?? []),
        ['sky.fog', { color: T.fog.color }], ['sky.fogSun', T.fogU.fogSunColor], ['sky.disc', T.disc], ['sky.discColour', discColour],
        ['sky.planetSun', T.planet.uSunDir], ['sky.planetHaze', T.planet.uHaze],
      ]));
    };
    const drive = (snap: boolean): void => {
      body.drive(targets, post, snap);
      if (channels === null || params === null) return;
      const c = clockOwner;
      clock.sunAt(sun); clock.moonAt(moon);
      c.phase = clock.phase; c.day = clock.body === 'sun' ? 1 : 0; c.night = clock.night;
      c.sunX = sun.x; c.sunY = sun.y; c.sunZ = sun.z; c.moonX = moon.x; c.moonY = moon.y; c.moonZ = moon.z;
      channels.evaluate({ time: 0, delta: 0, values: {} });
      params.push(graphs);
    };
    clock.onSet = async () => { await body.prepare?.(); drive(true); env.refresh(); };
    const pass: OffscreenPass | undefined = source.kind === 'equirect' ? { scene: source.scene, camera: source.camera, target: source.target } : undefined;
    return {
      clock, horizon: body.horizon, lut, ...body.backdrop,
      ...(body.follow ? {} : { clouds: dome }),
      ...(pass === undefined ? {} : { environmentPass: pass }),
      bind: (T) => {
        targets = T; body.bound?.(T); bindChannels(T); drive(true);
        if (environment.offscreenFirst !== true) env.refresh(); // an offscreen first build is already the sky of the hour
      },
      update: (dt, camera) => {
        body.tick?.(dt);
        clock.update(dt);
        if (body.follow) dome.position.copy(camera.position);
        // G782: held at a cell's wall, the day curves re-evaluate every 4th drawn frame (their targets keep the last values)
        if (heldFrameTurn(4, 2)) drive(false);
        env.update(dt);
      },
      rebuild: () => { body.rebuild?.(); env.rebuild(); void clock.set(clock.phase); }, // a fresh generator: the old one's targets belong to the lost context
      attachPost: (p) => { post = p; drive(true); },
      dispose: () => {
        body.dispose?.();
        dome.removeFromParent(); freeMesh(dome);
        source.scene.traverse(freeMesh);
        if (source.kind === 'equirect') source.target.dispose();
        env.dispose(); // its target, its generator's ping-pong target, blur and GGX passes
      },
      gpuBytes: () => env.bytes() + (body.bytes?.() ?? 0),
      gpuCeiling: () => env.ceiling() + (body.ceiling?.() ?? 0),
    };
  };
}
