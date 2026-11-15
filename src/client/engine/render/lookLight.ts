/**
 * A look's light and post settings (meta TEMPLATE-E2E-PLAN LF1-4): the optional `look.light` and `look.grade.bloom` of a
 * shardfile shard, for any author, each off when absent.
 *
 * - `ao`: the engine's n8ao pass (half resolution) on the desktop tier as contact shadows, at the declared intensity and
 *   world radius (tier knobs `ao`, `ao.intensity`, `ao.radius`; `Game.buildComposer`). The phone tier loads no AO (J8).
 * - `rim`: a view-fresnel rim added after the lit colour (`rimPatch`) on upright faces (a floor at a grazing angle gets
 *   none), its colour, strength and power uniforms, so every rim shares one shader text. Unlit shaders (no normal, no view position) are left alone.
 * - `heightFog`: the engine fog program's existing height term (`fogProgram.ts`), mist pooled under `height`, in place of
 *   the 0 a data look wrote; the day keys' distance fog is unchanged.
 * - `pools`: light pools on the ground under lamps (`lightPools`), one additive instanced decal draw for all of them,
 *   never a dynamic light per lamp.
 * - `grade.bloom`: the engine bloom's intensity and threshold, which a shardfile shard had hard-wired to 0 (LF1-2).
 * - `lamps`, `bounce`, `environment` (meta TEMPLATES-CLEANROOM B2): real point lights at lanterns, tents and fires; a
 *   shadowless warm fill from the anti-sun heading; an environment filtered once from the look's own sky over a ground
 *   colour (`dataLook`).
 *
 * - `shadow`, `motes`, a lamp's `decay`, `halo` and `flicker` (TEMPLATES-CLEANROOM M4): the sun's shadow strength,
 *   radius and normal bias; drifting glow points; lamp halos and an unsteady fire light (`lookRender.ts`).
 *
 * All of it waits behind Settings ▸ Debug ▸ Look ▸ "Look light" (read at load; default on): with the row off, a look that
 * declares every setting draws as one that declares none. TEMPLATES-CLEANROOM M4.9 gates it per field on the phone tier
 * instead of all or nothing: a phone keeps the environment, bounce, pools, rim, height fog and shadow look, at most
 * `PHONE_LAMPS` lamps lit, the nearest (AP28), half the motes, and no bloom or AO.
 */
import * as THREE from 'three';
import type { LookBounce, LookEnvironment, LookLamp, LookLight, LookPools, LookRim } from '@wildshard/format/look-light';
import type { LookMotes, LookShadow } from '@wildshard/format/look-render';
import type { ShaderSource } from './shaderPatches';

/** the rim's shader patch id */
export const LOOK_RIM_PATCH = 'engine.look.rim';

/** What the look's light settings resolve to at load. */
export interface LookLightResolved {
  /** the engine fog program's height term (`LevelSpec.atmosphere`'s fields) */
  readonly atmosphere: { readonly fogHeight: number; readonly fogHeightFalloff: number; readonly fogHeightDensity: number };
  /** the engine bloom (intensity 0: none) and its spread (null: the engine's) */
  readonly bloom: { readonly intensity: number; readonly threshold: number; readonly radius: number | null };
  /** the engine AO on the desktop tier; null: none */
  readonly ao: { readonly intensity: number; readonly radius: number } | null;
  readonly rim: LookRim | null;
  readonly pools: LookPools | null;
  readonly lamps: readonly LookLamp[] | null;
  /** AP28: how many of `lamps` light a frame, the nearest the eye (`PHONE_LAMPS` on a phone, `DESKTOP_LAMPS` else) */
  readonly lampsLit: number;
  readonly bounce: LookBounce | null;
  readonly environment: LookEnvironment | null;
  /** M4.2: the sun's shadow look; null: the engine's */
  readonly shadow: LookShadow | null;
  /** M4.4: glow motes; null: none */
  readonly motes: LookMotes | null;
}

/** the settings a shardfile look carries (structural: `Shardfile['look']` fits) */
export interface LookLightSource {
  readonly light?: LookLight | undefined;
  readonly grade: { readonly bloom?: { readonly intensity: number; readonly threshold: number; readonly radius?: number | undefined } | undefined };
}

/** No height fog: the fields a shardfile manifest had before LF1-4. */
const NO_HEIGHT_FOG = { fogHeight: -20, fogHeightFalloff: 0, fogHeightDensity: 0 } as const;

/** M4.9: at most this many of a look's lamps light on the phone tier (each costs every lit draw a light-loop step) */
export const PHONE_LAMPS = 4;
/** SHARD-SOURCE AP28: at most this many of a look's lamps light a desktop frame (shard-format `LOOK_LIGHT_LIT_MAX`) */
export const DESKTOP_LAMPS = 16;

/**
 * Resolve a look's light settings; `on` is the Debug row ("Look light"), `tier` the page's. Off, or nothing declared: as
 * before. The phone tier keeps the cheap fields (M4.9): no bloom or AO, the nearest `PHONE_LAMPS` lamps lit (AP28), half the motes.
 */
export function lookLightManifest(look: LookLightSource, on: boolean, tier = 'desktop'): LookLightResolved {
  const phone = tier === 'phone';
  const light = on ? look.light : undefined, bloom = on && !phone ? look.grade.bloom : undefined, fog = light?.heightFog;
  const motes = light?.motes === undefined ? null : phone ? { ...light.motes, count: Math.max(1, Math.floor(light.motes.count / 2)) } : light.motes;
  return {
    atmosphere: fog === undefined ? { ...NO_HEIGHT_FOG } : { fogHeight: fog.height, fogHeightFalloff: fog.falloff, fogHeightDensity: fog.density },
    bloom: bloom === undefined ? { intensity: 0, threshold: 1, radius: null } : { intensity: bloom.intensity, threshold: bloom.threshold, radius: bloom.radius ?? null },
    ao: light?.ao === undefined || phone ? null : { intensity: light.ao.intensity, radius: light.ao.radius },
    rim: light?.rim ?? null,
    pools: light?.pools ?? null,
    lamps: light?.lamps ?? null,
    lampsLit: phone ? PHONE_LAMPS : DESKTOP_LAMPS,
    bounce: light?.bounce ?? null,
    environment: light?.environment ?? null,
    shadow: light?.shadow ?? null,
    motes,
  };
}

/**
 * The rim's shader patch: `strength` × (1 − n·v)^`power` in linear `colour`, added to the lit colour right after
 * `opaque_fragment` (before fog, so far rims fade with the air). The values are uniforms shared by every material the
 * patch touches; a shader with no view-space normal (`normal_fragment_begin`, which every lit
 * three shader has with its `vViewPosition`) is left alone.
 */
export function rimPatch(rim: LookRim): (shader: ShaderSource) => void {
  const uniforms = {
    wsRimColour: new THREE.Uniform(new THREE.Color().setRGB(rim.colour[0], rim.colour[1], rim.colour[2], THREE.LinearSRGBColorSpace)),
    wsRimStrength: new THREE.Uniform(rim.strength),
    wsRimPower: new THREE.Uniform(rim.power),
  };
  return (shader) => {
    const fs = shader.fragmentShader;
    if (shader.uniforms['wsRimColour'] !== undefined || !fs.includes('#include <opaque_fragment>') || !fs.includes('#include <normal_fragment_begin>')) return;
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `uniform vec3 wsRimColour; uniform float wsRimStrength; uniform float wsRimPower;\n${fs.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      {
        // a rim on upright faces only: a floor seen at a grazing angle is not a silhouette
        vec3 wsRimN = normalize(normal);
        float wsRimSide = 1.0 - clamp(dot(wsRimN, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0, 1.0);
        gl_FragColor.rgb += wsRimColour * wsRimStrength * wsRimSide * pow(1.0 - clamp(dot(wsRimN, normalize(vViewPosition)), 0.0, 1.0), wsRimPower);
      }`)}`;
  };
}

/** how far over its ground point a pool decal floats (metres), clear of the floor's depth */
const POOL_LIFT = 0.04;

/**
 * The look's light pools: one instanced, additive, unfogged decal disc per lamp (`radius` metres across its ground point
 * `at`), a soft radial falloff in `colour` × `intensity`. One draw and one program for every pool; no light objects.
 */
export function lightPools(pools: LookPools): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    name: 'engine.look.pools', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: { uPool: { value: new THREE.Color().setRGB(pools.colour[0], pools.colour[1], pools.colour[2], THREE.LinearSRGBColorSpace).multiplyScalar(pools.intensity) } },
    vertexShader: 'varying vec2 vDisc; void main() { vDisc = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uPool; varying vec2 vDisc; void main() { float r = clamp(1.0 - length(vDisc), 0.0, 1.0); gl_FragColor = vec4(uPool * r * r, 1.0); }',
  });
  const mesh = new THREE.InstancedMesh(geometry, material, pools.at.length);
  const m = new THREE.Matrix4(), scale = new THREE.Vector3(pools.radius, 1, pools.radius), q = new THREE.Quaternion(), p = new THREE.Vector3();
  pools.at.forEach(([x, y, z], i) => { mesh.setMatrixAt(i, m.compose(p.set(x, y + POOL_LIFT, z), q, scale)); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'look-light-pools'; mesh.renderOrder = 1; mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

/** how far out the bounce light stands from its target (metres): far enough that its direction is the whole frame's */
const BOUNCE_DISTANCE = 100;

/**
 * The look's warm bounce (B2): one shadowless directional light from the anti-sun heading, lifted by `lift`, in linear
 * `colour` × `intensity`. `aim` points it for a sun direction (the clock's): call it when the sun moves.
 */
export function bounceLight(bounce: LookBounce): { light: THREE.DirectionalLight; aim: (sun: THREE.Vector3) => void } {
  const light = new THREE.DirectionalLight(new THREE.Color().setRGB(bounce.colour[0], bounce.colour[1], bounce.colour[2], THREE.LinearSRGBColorSpace), bounce.intensity);
  light.name = 'look-light-bounce'; light.castShadow = false;
  const dir = new THREE.Vector3();
  const aim = (sun: THREE.Vector3): void => {
    dir.set(-sun.x, 0, -sun.z);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(Math.sqrt(1 - bounce.lift * bounce.lift)).setY(bounce.lift);
    light.position.copy(dir).multiplyScalar(BOUNCE_DISTANCE); light.target.position.set(0, 0, 0);
    light.target.updateMatrixWorld();
  };
  return { light, aim };
}

/** SHARD-SOURCE AP24b: what a following lamp rides (`lamps[].follow`), or null while that actor is not in the world. */
export type LampFollowResolve = (actor: string, bone: string | undefined) => THREE.Object3D | null;
const lampFollows = new WeakMap<THREE.Object3D, LampFollowResolve>();
/** The page's actor lookup for the following lamps drawn under `root` (its scene); returns the undo. */
export function setLampFollow(root: THREE.Object3D, resolve: LampFollowResolve): () => void {
  lampFollows.set(root, resolve);
  return () => { if (lampFollows.get(root) === resolve) lampFollows.delete(root); };
}
const rootOf = (object: THREE.Object3D): THREE.Object3D => { let at = object; while (at.parent !== null) at = at.parent; return at; };

/** a lamp group's frame step: `time` drives the flicker, `eye` (world) picks the nearest lamps when more than `lit` exist */
export type LampUpdate = (time: number, eye?: THREE.Vector3Like) => void;

/**
 * The look's lamps (B2): a pool of at most `lit` shadowless point lights (AP28: 16 on a desktop, `PHONE_LAMPS` on a phone),
 * physical decay unless a lamp sets its own (M4.3). The pool's size never changes, so no shader recompiles as lamps come and
 * go: `update` gives its lights to the lamps nearest `eye`, places each following lamp (AP24b) at its offset in its actor's
 * or bone's frame (dark while that actor is absent), and flickers the lamps that declare a flicker (two incommensurate sines
 * per lamp, so no two pulse together). It is null when nothing moves: at most `lit` fixed lamps and no flicker, drawn
 * exactly as before.
 */
export function lampLights(lamps: readonly LookLamp[], lit: number = DESKTOP_LAMPS): THREE.Group & { update: LampUpdate | null } {
  const group = Object.assign(new THREE.Group(), { update: null as LampUpdate | null });
  group.name = 'look-light-lamps';
  const rows = lamps.map((lamp, i) => ({ lamp, phase: i * 2.399, at: new THREE.Vector3(...lamp.at), place: new THREE.Vector3(...lamp.at), live: lamp.follow === undefined,
    colour: new THREE.Color().setRGB(lamp.colour[0], lamp.colour[1], lamp.colour[2], THREE.LinearSRGBColorSpace) }));
  const pool = rows.slice(0, Math.max(0, Math.min(rows.length, lit))).map((row) => {
    const light = new THREE.PointLight(row.colour, row.live ? row.lamp.intensity : 0, row.lamp.distance, row.lamp.decay ?? 2);
    light.position.copy(row.place); light.castShadow = false;
    group.add(light);
    return light;
  });
  const following = rows.filter((row) => row.lamp.follow !== undefined), crowded = rows.length > pool.length;
  const flickers = rows.some((row) => (row.lamp.flicker?.amount ?? 0) > 0);
  if (following.length === 0 && !crowded && !flickers) return group;
  const eyeLocal = new THREE.Vector3(), chosen: typeof rows = [];
  group.update = (time, eye) => {
    if (following.length > 0) {
      const resolve = lampFollows.get(rootOf(group));
      for (const row of following) {
        const follow = row.lamp.follow, target = follow === undefined || resolve === undefined ? null : resolve(follow.actor, follow.bone);
        row.live = target !== null;
        if (target !== null) group.worldToLocal(target.localToWorld(row.place.copy(row.at)));
      }
    }
    chosen.length = 0;
    for (const row of rows) if (row.live) chosen.push(row);
    if (crowded && eye !== undefined) {
      group.worldToLocal(eyeLocal.copy(eye));
      chosen.sort((a, b) => a.place.distanceToSquared(eyeLocal) - b.place.distanceToSquared(eyeLocal));
    }
    pool.forEach((light, i) => {
      const row = chosen[i];
      if (row === undefined) { light.intensity = 0; return; }
      const flicker = row.lamp.flicker;
      light.color.copy(row.colour); light.distance = row.lamp.distance; light.decay = row.lamp.decay ?? 2; light.position.copy(row.place);
      if (flicker === undefined || flicker.amount <= 0) { light.intensity = row.lamp.intensity; return; }
      const w = Math.sin(time * flicker.rate * 2.1 + row.phase) * 0.6 + Math.sin(time * flicker.rate * 5.3 + row.phase * 1.7) * 0.4;
      light.intensity = row.lamp.intensity * (1 - flicker.amount * 0.5 + flicker.amount * 0.5 * w);
    });
  };
  return group;
}

/** the ground disc under the environment's sky: far below and wide, so every downward ray meets it */
const ENV_GROUND = { radius: 900, depth: -40 } as const;

/**
 * The look's environment scene (B2): the sky dome's own material over a ground disc in linear `ground`, for a PMREM to
 * filter once. The caller disposes the disc (the dome is the look's).
 */
export function environmentScene(dome: THREE.Mesh, environment: LookEnvironment): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(dome.geometry, dome.material);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ENV_GROUND.radius, 24).rotateX(-Math.PI / 2).translate(0, ENV_GROUND.depth, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(environment.ground[0], environment.ground[1], environment.ground[2], THREE.LinearSRGBColorSpace) }));
  scene.add(sky, floor);
  return { scene, dispose: () => { floor.geometry.dispose(); floor.material.dispose(); } };
}
