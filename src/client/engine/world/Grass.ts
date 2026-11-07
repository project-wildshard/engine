import * as THREE from 'three';
import { SEED } from '../../../shared/engine/core/config';
import { Rng } from '../../../shared/engine/core/rng';
import { Noise2D, smoothstep, lerp } from '../../../shared/engine/core/noise';
import { heightAt, normalAt, splatAt, inChunk, pondMask, waterLevel, bindHeightfield, captureHeightfield } from '../../../shared/engine/world/Heightfield';
import { attachFogUniforms } from './Atmosphere';
import { windUniforms } from './TreeFactory';
import { patchWindField } from './wind';
import type { SkyRig as Sky } from './skyRig';
import type { Forest } from './forest/Forest';
import { TIER_CONFIG } from '../core/tier';
import { activeLevel, boundLevelLook } from '../../../shared/engine/level/selection';
import { groundSet } from './lookFlags';
import { app } from '../app/runtime';
import type { GrassLayer } from '../render/look';
import { practiceRoom } from '../core/practiceRoom';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import { gpuOnlyTexture } from '../core/gpuOnly';
import { registerScenePreparation } from '../render/scenePreparation';
import { resourceScope } from '../../../shared/engine/app/resources';
import { withOwner } from '../../../shared/engine/app/ownership';
import { workSlice } from '../../../shared/engine/core/workSlice';

/**
 * Wind-swept grass carpet around the player (Skyrim SE / Horizon style).
 *
 *   const grass = new Grass(sky, forest).build();
 *   scene.add(grass.group);
 *   game.onUpdate((dt) => grass.update(dt, player.position));
 *
 * One InstancedMesh (one draw call, 75k slots, ~25–35k live clumps) of grass *clumps* — 3 crossed,
 * curved blade quads each, drawn from a procedural Canvas2D blade atlas — that follows the player
 * in a 4 m cell grid (toroidal slot table, 28×28 cells × 96 slots). A cell is (re)seeded from a
 * hash of its coordinates, so the same square metre always grows the same grass. Density comes
 * from the terrain splat (dense on the grass layer, sparse on forest floor, none on trail / rock /
 * cabin pads / inside trunks). Instances sit on `heightAt`, tilt to the cell's `normalAt`, and get
 * a per-instance colour (yellow-green ↔ deep green patches, olive-brown on the forest floor).
 * Everything else is in the shader: the shared gust front (wind.ts windGustAt, PH-L6) + local ripple / flutter, distance LOD (3 → 2 → 1
 * quads, then every other clump, then shrink to 0 in the outer FADE metres), fake root AO,
 * translucent light-wrap / sun backlight, alpha sharpening so distant grass keeps its coverage.
 * The CPU only works when the player crosses a cell boundary (≈0.13 ms per cell, at most
 * `params.budget` cells per frame; the first fill after a spawn/teleport is done at once, ~50 ms).
 *
 * `flowers` is a second InstancedMesh on the same cell scheme (8 slots per cell): ~6 % of the
 * clumps in open, grassy clearings (grass splat high, `forest.canopyMap` low) get a white / blue /
 * yellow 4-petal flower head on a stem. Forest-floor clumps are a solid tuft carpet; along the
 * trail (trail weight 0.08–0.6) a taller, denser verge grows; the trail bed itself stays clear.
 *
 * Public: `group`, `mesh`, `flowers`, `material`, `update(dt, playerPos)`, `radius`,
 *         `params` = { budget, windStrength } (live tunables).
 *
 * Pine Hollow's trample (E322 F-L4, Jake picked it; the Debug row is gone): the carpet and the flowers bend round
 * Nalati's trample map + live movers (GrassTrample.ts `trampleBend`) — the player and the animals (AnimalManager, on Pine
 * Hollow) part it and leave it flattened a while. Only Pine Hollow's programs carry the code (their own cache keys);
 * Driftwood's carpet is the same shader as before.
 *
 * A level look with its own grass (`LookStrategy.grass`, a GrassDriver: GPU blade rings, say) is built instead
 * (exposed as `driven`; `mesh` / `material` / `flowers` stay unset) and `update()` forwards to it — the Pine Hollow /
 * Driftwood path below is untouched. Inside a bound level frame (a grid region, `LevelFrameOptions.look`) the driver is
 * that level's own (or none: the carpet), never the page look's (SF63).
 */

const RADIUS = TIER_CONFIG.grassRadius; // metres: ring around the player that has grass (55 desktop, 40 phone)
const FADE = 10;           // metres: outer band where instances scale down to 0
const CELL = 4;            // metres per cell
const N = Math.ceil((RADIUS * 2) / CELL); // 28 cells per side (20 on the phone)
const KF = 8;              // flower slots per cell
const QUADS = TIER_CONFIG.grassQuads; // quads per clump: 3 crossed (+ 2 near fillers on desktop)

const grassUniforms = {
  uGrassWind: { value: 1.0 },
  uRadius: { value: RADIUS },
  uFade: { value: FADE },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 0.93, 0.8) },
};

/** A trample field the grass bends round and the player stamps into each frame (the kit's GrassTrample) */
interface TrampleField {
  readonly uniforms: Record<string, THREE.IUniform>;
  push: (x: number, z: number, radius: number, strength?: number, vx?: number, vz?: number) => void;
  update: (dt: number, playerPos: { x: number; z: number }) => void;
}
/** the field, and GLSL that defines `vec2 trampleBend(vec2 xz)` over its uniforms */
interface GrassTrampleField { field: TrampleField; glsl: string }

/** E322 F-L4: the trample, after the wind (inside its block: `im`, `ipos`, `s2`, `fade` in scope) — the blade lies over by
 *  the bend's angle (≤ 1.35 rad) the way it points, the top dropping as it goes */
const TRAMPLE_APPLY = /* glsl */`
            {
              vec2 tb = trampleBend( ipos.xz );
              float tl = length( tb );
              if ( tl > 1e-3 ) {
                float ta = min( tl, 1.35 );
                vec2 td = tb / tl;
                vec3 tw = vec3( td.x * sin( ta ), cos( ta ) - 1.0, td.y * sin( ta ) ) * transformed.y * sqrt( s2 );
                transformed += ( tw * im ) / max( s2, 1e-6 );
              }
            }`;

const UP = new THREE.Vector3(0, 1, 0);
const bilerp = (a: number, b: number, c: number, d: number, u: number, v: number) => lerp(lerp(a, b, u), lerp(c, d, u), v);

export class Grass {
  private readonly slots = TIER_CONFIG.grassSlots;
  group: THREE.Group = new THREE.Group();
  mesh!: THREE.InstancedMesh;
  material!: THREE.MeshStandardMaterial;
  /** small white / blue / yellow flower heads in ~4 % of clearing clumps (same cell scheme) */
  flowers!: THREE.InstancedMesh;
  readonly radius: number = RADIUS;
  /** live tunables */
  params = { budget: 6, windStrength: 1.0 };
  /** the level look's own grass (LookStrategy.grass); then nothing below is built */
  driven: GrassLayer | null = null;

  private slotKeyX = new Int32Array(N * N).fill(0x7fffffff);
  private slotKeyZ = new Int32Array(N * N).fill(0x7fffffff);
  private queue: number[] = [];       // cell indices (cx * 1e5 + cz) pending reseed
  private queued = new Set<number>();
  private lastCellX = 0x7fffffff;
  private lastCellZ = 0x7fffffff;
  private patchNoise = new Noise2D(SEED + 31);
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpC = new THREE.Color();
  /** × every tuft's colour: the chunk's boreal grass tint (PH-L1 round 3; 1 without a boreal set) */
  private tint = new THREE.Color(...(groundSet(activeLevel()).boreal?.grassTint ?? [1, 1, 1]));
  private zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  private meshColor!: THREE.InstancedBufferAttribute;
  private flowerColor!: THREE.InstancedBufferAttribute;
  private lastPX = Number.NaN;
  private lastPZ = Number.NaN;

  private sky: Sky;
  private forest: Forest;
  private readonly policy: { trample?: GrassTrampleField };
  /** `trample`: the level's trample field (its uniforms, and GLSL that defines `trampleBend(xz)`), handed in by the level
   *  that owns it (Pine Hollow passes the kit's; E405: the engine imports no kit) */
  constructor(sky: Sky, forest: Forest, policy: { trample?: GrassTrampleField } = {}) {
    this.sky = sky;
    this.forest = forest;
    this.policy = policy;
  }

  /** The level look's grass driver's preparation (`GrassDriver.prepare`), if it has one: await it before `build`, so a
   *  look's compiles and decodes take turns with the frame instead of all landing in the build's (G639). */
  async prepare(): Promise<void> {
    const bound = boundLevelLook();
    await (bound === undefined ? app.render?.look : bound)?.grass?.prepare?.();
  }

  build(): this {
    // a bound level frame (a grid region) grows its own level's grass, never the page look's (SF63)
    const bound = boundLevelLook();
    const driver = (bound === undefined ? app.render?.look : bound)?.grass;
    if (driver !== undefined) { this.driven = driver.build(this.sky, this.forest); this.group.add(this.driven.group); return this; } // the level look's own grass
    const geo = buildClumpGeometry();
    this.material = this.buildMaterial();
    this.mesh = new THREE.InstancedMesh(geo, this.material, N * N * this.slots);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.meshColor = new THREE.InstancedBufferAttribute(new Float32Array(N * N * this.slots * 3), 3);
    this.mesh.instanceColor = this.meshColor;
    this.meshColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // start with everything collapsed
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < N * N * this.slots; i++) this.zeroM.toArray(arr, i * 16);
    this.group.add(this.mesh);
    this.flowers = new THREE.InstancedMesh(buildFlowerGeometry(), this.buildFlowerMaterial(), N * N * KF);
    this.flowers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flowerColor = new THREE.InstancedBufferAttribute(new Float32Array(N * N * KF * 3), 3);
    this.flowers.instanceColor = this.flowerColor;
    this.flowerColor.setUsage(THREE.DynamicDrawUsage);
    this.flowers.frustumCulled = false;
    this.flowers.receiveShadow = true;
    const farr = this.flowers.instanceMatrix.array as Float32Array;
    for (let i = 0; i < N * N * KF; i++) this.zeroM.toArray(farr, i * 16);
    this.group.add(this.flowers);
    // the sky's own objects (not copies): the day / night clock moves the sun by mutating them in place
    grassUniforms.uSunDir.value = this.sky.sunDir;
    grassUniforms.uSunColor.value = this.sky.sunColor;
    const owner = resourceScope();
    // the terrain this grass grows on, captured while its level frame is entered: a grid cell's warm-up prepares its
    // roots from the road, under the road's field, and cells seeded there were never reseeded (look48: Pine's cell lost
    // its near grass). Each synchronous slice enters the captured field and leaves it before the next yield.
    const terrain = captureHeightfield();
    const onTerrain = (run: () => void): void => {
      const leave = bindHeightfield(terrain);
      try { withOwner(owner, run); } finally { leave(); }
    };
    registerScenePreparation(this.group, owner, async (eye, current) => {
      onTerrain(() => { this.queueAt(eye); });
      const slice = workSlice(undefined, owner);
      while (this.queue.length > 0) {
        if (!current()) throw new Error('Grass preparation left its owner');
        onTerrain(() => { this.flush(1); });
        if (slice.due()) await slice.yield();
      }
    });
    return this;
  }

  private buildMaterial() {
    const field = this.policy.trample, withTrample = field !== undefined;
    const tex = makeBladeAtlas();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
      color: new THREE.Color(1, 1, 1),
    });
    patchShader(mat, 'engine.grass-carpet', PATCH_ORDER.material, (shader) => {
      attachFogUniforms(shader);
      Object.assign(shader.uniforms, grassUniforms);
      patchWindField(shader);
      shader.uniforms['uWindStrength'] = windUniforms.uWindStrength;
      if (field) Object.assign(shader.uniforms, field.field.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
          uniform float uWindStrength; uniform float uGrassWind; uniform float uRadius; uniform float uFade;
          attribute float quadId;
          varying float vH;${field ? `\n${field.glsl}` : ''}`)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          {
            mat3 im = mat3( instanceMatrix );
            vec3 ipos = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
            float dist = distance( ipos, cameraPosition );
            float rnd = fract( sin( dot( ipos.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            float fade = 1.0 - smoothstep( uRadius - uFade, uRadius, dist );
            // LOD: filler quads only near the camera; far clumps lose their 3rd, then 2nd quad, then
            // every other clump thins out, before the ring fade — a gentle taper so no band pops
            if ( quadId > 2.5 ) fade *= 1.0 - smoothstep( 9.0, 16.0, dist );
            else if ( quadId > 1.5 ) fade *= 1.0 - smoothstep( 22.0, 34.0, dist );
            else if ( quadId > 0.5 ) fade *= 1.0 - smoothstep( 34.0, 46.0, dist );
            if ( rnd < 0.5 ) fade *= 1.0 - smoothstep( 40.0, 50.0, dist );
            // widen the surviving card a little so far coverage holds up
            transformed.x *= 1.0 + smoothstep( 20.0, 34.0, dist ) * 0.35;
            transformed *= fade;
            float h = uv.y;
            vH = h;
            // wind: the shared gust front (the one crossing the canopy) carrying a local swell, plus a faster ripple and a
            // per-blade flutter — all on the shared clock and direction
            vec2 dir = windDirXZ();
            vec3 wpos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
            float phase = dot( wpos.xz, dir ) * 0.32 + rnd * 1.7;
            float swell = sin( uWindTime * 1.25 - phase ) * 0.5 + 0.5;
            float gust = min( windGustAt( wpos.xz ), 1.3 ) * ( 0.35 + 0.65 * swell * swell ) * 1.25;
            float ripple = sin( uWindTime * 2.9 - phase * 2.1 + wpos.x * 0.45 ) * 0.5 + 0.5;
            float flutter = sin( uWindTime * 6.5 + wpos.x * 4.3 + wpos.z * 3.1 );
            float s2 = dot( im[0], im[0] );
            float amp = ( 0.02 + gust * 0.13 * ( 0.7 + 0.6 * rnd ) + ripple * 0.045 ) * uWindStrength * uGrassWind * sqrt( s2 ) * 2.0;
            float w = h * h;
            // a little per-clump lean in a random direction so the field is not combed flat
            vec2 leanDir = vec2( cos( rnd * 6.2832 ), sin( rnd * 6.2832 ) ) * 0.05;
            vec3 off = vec3( dir.x * amp + flutter * 0.02 + leanDir.x, 0.0, dir.y * amp + flutter * 0.015 + leanDir.y ) * w;
            off.y = - length( off.xz ) * 0.3;
            transformed += ( off * im ) / max( s2, 1e-6 ) * fade;${withTrample ? TRAMPLE_APPLY : ''}
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */`#include <common>
          varying float vH;
          uniform vec3 uSunDir; uniform vec3 uSunColor;`)
        .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
          // fake ground AO: roots sit in shadow between the blades
          diffuseColor.rgb *= mix( 0.32, 1.0, smoothstep( 0.0, 0.6, vH ) );`)
        .replace('#include <alphatest_fragment>', /* glsl */`
          // sharpen the mip-blurred alpha so distant grass keeps its coverage instead of thinning out
          diffuseColor.a = clamp( ( diffuseColor.a - alphaTest ) / max( fwidth( diffuseColor.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
          if ( diffuseColor.a < 0.5 ) discard;`)
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <lights_fragment_begin>', /* glsl */`#include <lights_fragment_begin>
          {
            // translucency: thin blades let light through, glowing when the sun is behind them
            vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
            float bl = pow( max( dot( normalize( - vViewPosition ), sunV ), 0.0 ), 5.0 );
            reflectedLight.indirectDiffuse += diffuseColor.rgb * ( 0.07 + bl * 0.55 * vH ) * uSunColor;
          }`);
    }, { mode: 'replace', key: (withTrample ? 'grass-carpet-trample' : 'grass-carpet') });
    this.sky.setupMaterial(mat);
    return mat;
  }

  private buildFlowerMaterial() {
    const field = this.policy.trample, withTrample = field !== undefined;
    const mat = new THREE.MeshStandardMaterial({ map: makeFlowerTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
    patchShader(mat, 'engine.grass-flowers', PATCH_ORDER.material, (shader) => {
      attachFogUniforms(shader);
      patchWindField(shader);
      shader.uniforms['uWindStrength'] = windUniforms.uWindStrength;
      shader.uniforms['uGrassWind'] = grassUniforms.uGrassWind;
      if (field) Object.assign(shader.uniforms, field.field.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
          uniform float uWindStrength; uniform float uGrassWind;${field ? `\n${field.glsl}` : ''}`)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          {
            mat3 im = mat3( instanceMatrix );
            vec3 ipos = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
            float dist = distance( ipos, cameraPosition );
            float fade = 1.0 - smoothstep( 24.0, 34.0, dist );
            transformed *= fade;
            float h = uv.y;
            vec3 wpos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
            vec2 dir = windDirXZ();
            float phase = dot( wpos.xz, dir ) * 0.32;
            float swell = sin( uWindTime * 1.25 - phase ) * 0.5 + 0.5;
            float gust = min( windGustAt( wpos.xz ), 1.3 ) * ( 0.35 + 0.65 * swell * swell ) * 1.25;
            float s2 = dot( im[0], im[0] );
            float amp = ( 0.01 + gust * 0.07 ) * uWindStrength * uGrassWind * sqrt( s2 ) * 2.0;
            vec3 off = vec3( dir.x * amp, 0.0, dir.y * amp ) * h * h;
            transformed += ( off * im ) / max( s2, 1e-6 ) * fade;${withTrample ? TRAMPLE_APPLY : ''}
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        .replace('#include <lights_fragment_begin>', /* glsl */`#include <lights_fragment_begin>
          reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;`);
    }, { mode: 'replace', key: (withTrample ? 'grass-flowers-trample' : 'grass-flowers') });
    this.sky.setupMaterial(mat);
    return mat;
  }

  private canopyAt(x: number, z: number) {
    const img = this.forest.canopyMap.image as { data: Float32Array; width: number; height: number };
    const ix = Math.min(img.width - 1, Math.max(0, Math.floor(((x + 250) / 500) * img.width)));
    const iz = Math.min(img.height - 1, Math.max(0, Math.floor(((z + 250) / 500) * img.height)));
    return img.data[iz * img.width + ix] ?? 0;
  }

  private slotOf(cx: number, cz: number) {
    return (((cx % N) + N) % N) * N + (((cz % N) + N) % N);
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    if (this.driven) { this.driven.update(dt, playerPos); return; }
    grassUniforms.uGrassWind.value = this.params.windStrength;
    if (this.policy.trample) this.trampleStep(this.policy.trample.field, dt, playerPos);
    const first = this.lastCellX === 0x7fffffff;
    this.queueAt(playerPos);
    if (first) this.flush(Infinity);
    if (this.queue.length > 0) this.flush(this.queue.length > 300 ? Infinity : this.params.budget);
  }

  private queueAt(playerPos: THREE.Vector3): void {
    const pcx = Math.floor(playerPos.x / CELL), pcz = Math.floor(playerPos.z / CELL);
    if (pcx !== this.lastCellX || pcz !== this.lastCellZ) {
      this.lastCellX = pcx; this.lastCellZ = pcz;
      const half = N >> 1;
      for (let cx = pcx - half; cx < pcx + half; cx++) for (let cz = pcz - half; cz < pcz + half; cz++) {
        const s = this.slotOf(cx, cz);
        if (this.slotKeyX[s] === cx && this.slotKeyZ[s] === cz) continue;
        const key = cx * 100000 + cz;
        if (!this.queued.has(key)) { this.queued.add(key); this.queue.push(key); }
      }
      // sort so cells nearest the player fill first (matters after a teleport / first frame)
      if (this.queue.length > 60) {
        this.queue.sort((a, b) => {
          const ax = Math.floor((a + 50000) / 100000), az = a - ax * 100000, bx = Math.floor((b + 50000) / 100000), bz = b - bx * 100000;
          return (ax - pcx) ** 2 + (az - pcz) ** 2 - ((bx - pcx) ** 2 + (bz - pcz) ** 2);
        });
      }
    }
  }

  /** E322 F-L4: the player parts the grass and leaves a trail (the animals push from AnimalManager); the map advances */
  private trampleStep(trample: TrampleField, dt: number, playerPos: THREE.Vector3): void {
    const vx = Number.isNaN(this.lastPX) || dt <= 0 ? 0 : (playerPos.x - this.lastPX) / dt;
    const vz = Number.isNaN(this.lastPZ) || dt <= 0 ? 0 : (playerPos.z - this.lastPZ) / dt;
    this.lastPX = playerPos.x; this.lastPZ = playerPos.z;
    if (vx * vx + vz * vz < 900 && !practiceRoom.open) trample.push(playerPos.x, playerPos.z, 0.55, 1, vx, vz); // E321: not from a room
    trample.update(dt, playerPos);
  }

  private flush(budget: number) {
    let n = 0;
    const half = N >> 1;
    let dirty = false;
    while (this.queue.length > 0 && n < budget) {
      const key = this.queue.shift();
      if (key === undefined) break;
      this.queued.delete(key);
      const cx = Math.floor((key + 50000) / 100000), cz = key - cx * 100000;
      // dropped out of the window while queued? (player moved on) → skip
      if (cx < this.lastCellX - half || cx >= this.lastCellX + half || cz < this.lastCellZ - half || cz >= this.lastCellZ + half) continue;
      this.seedCell(cx, cz);
      n++; dirty = true;
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true; this.meshColor.needsUpdate = true;
      this.flowers.instanceMatrix.needsUpdate = true; this.flowerColor.needsUpdate = true;
    }
  }

  private seedCell(cx: number, cz: number) {
    const slot = this.slotOf(cx, cz);
    this.slotKeyX[slot] = cx; this.slotKeyZ[slot] = cz;
    const rng = new Rng(((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ SEED) >>> 0) + 1);
    const x0 = cx * CELL, z0 = cz * CELL;
    const s00 = splatAt(x0, z0), s10 = splatAt(x0 + CELL, z0), s01 = splatAt(x0, z0 + CELL), s11 = splatAt(x0 + CELL, z0 + CELL);
    const nrm = normalAt(x0 + CELL / 2, z0 + CELL / 2, 1.0);
    const trees = this.forest.nearby(x0 + CELL / 2, z0 + CELL / 2, 3);
    const matArr = this.mesh.instanceMatrix.array as Float32Array;
    const colArr = this.meshColor.array as Float32Array;
    const base = slot * this.slots;
    const fArr = this.flowers.instanceMatrix.array as Float32Array;
    const fCol = this.flowerColor.array as Float32Array;
    const fBase = slot * KF;
    let fk = 0;
    const canopy = this.canopyAt(x0 + CELL / 2, z0 + CELL / 2);
    this.tmpN.set(nrm[0], nrm[1], nrm[2]);
    this.tmpQ2.setFromUnitVectors(UP, this.tmpN);
    for (let k = 0; k < this.slots; k++) {
      const u = rng.next(), v = rng.next();
      const x = x0 + u * CELL, z = z0 + v * CELL;
      // bilinear splat
      const g = bilerp(s00[1], s10[1], s01[1], s11[1], u, v);
      const f = bilerp(s00[0], s10[0], s01[0], s11[0], u, v);
      const t = bilerp(s00[3], s10[3], s01[3], s11[3], u, v);
      const r = bilerp(s00[2], s10[2], s01[2], s11[2], u, v);
      const patch = this.patchNoise.fbm(x * 0.045, z * 0.045, 2);
      // dense on the grass layer, a solid tuft carpet on the forest floor, a taller verge along the
      // trail edge (trail weight up to ~0.6), nothing on the trail bed / rock
      const verge = smoothstep(0.08, 0.4, t) * (1 - smoothstep(0.45, 0.62, t));
      let p = g * (1.0 + 0.3 * patch) + f * (0.5 + 0.12 * patch) + verge * 0.7;
      p *= smoothstep(0.62, 0.42, t) * smoothstep(0.5, 0.1, r);
      const roll = rng.next();
      const yaw = rng.range(0, Math.PI * 2);
      const hv = rng.next();
      const cv = rng.next();
      let keep = roll < p && inChunk(x, z, 1.5) && pondMask(x, z) < 0.02;
      if (keep) for (const tr of trees) { const dx = tr.x - x, dz = tr.z - z; if (dx * dx + dz * dz < (tr.r + 0.3) ** 2) { keep = false; break; } }
      const idx = base + k;
      if (!keep) { this.zeroM.toArray(matArr, idx * 16); continue; }
      const y = heightAt(x, z) - 0.03;
      if (y < waterLevel() + 0.15) { this.zeroM.toArray(matArr, idx * 16); continue; }
      const h = lerp(0.36, 0.68, hv) * lerp(0.78, 1.0, g) * (0.9 + 0.2 * patch) * (1 + verge * 0.55);
      this.tmpQ.setFromAxisAngle(UP, yaw).premultiply(this.tmpQ2);
      this.tmpM.compose(this.tmpP.set(x, y, z), this.tmpQ, this.tmpS.set(h, h, h));
      this.tmpM.toArray(matArr, idx * 16);
      // colour: yellow-green meadow ↔ deep green, patchy via noise, olive-brown on the forest floor
      const tone = smoothstep(-0.5, 0.5, patch) * 0.65 + cv * 0.35;
      this.tmpC.setRGB(lerp(0.6, 1.0, tone), lerp(0.72, 0.86, tone), lerp(0.36, 0.5, tone));
      const floorMix = f * (1 - g);
      this.tmpC.r = lerp(this.tmpC.r, 0.78, floorMix * 0.6);
      this.tmpC.g = lerp(this.tmpC.g, 0.62, floorMix * 0.6);
      this.tmpC.b = lerp(this.tmpC.b, 0.34, floorMix * 0.6);
      colArr[idx * 3] = this.tmpC.r * this.tint.r; colArr[idx * 3 + 1] = this.tmpC.g * this.tint.g; colArr[idx * 3 + 2] = this.tmpC.b * this.tint.b;
      // flowers: a few per cell in open, grassy clearings
      const fr = rng.next();
      if (fk < KF && g > 0.45 && canopy < 0.35 && fr < 0.06) {
        const fi = fBase + fk++;
        const fs = rng.range(0.9, 1.3) * h * 2.0;
        this.tmpM.compose(this.tmpP.set(x, y + 0.02, z), this.tmpQ, this.tmpS.set(fs, fs, fs));
        this.tmpM.toArray(fArr, fi * 16);
        const kind = rng.next();
        if (kind < 0.45) this.tmpC.setRGB(1.0, 1.0, 0.95);           // white
        else if (kind < 0.75) this.tmpC.setRGB(0.55, 0.62, 1.0);     // blue
        else this.tmpC.setRGB(1.0, 0.85, 0.25);                      // yellow
        fCol[fi * 3] = this.tmpC.r; fCol[fi * 3 + 1] = this.tmpC.g; fCol[fi * 3 + 2] = this.tmpC.b;
      }
    }
    for (let i = fk; i < KF; i++) this.zeroM.toArray(fArr, (fBase + i) * 16);
    this.flowers.instanceMatrix.addUpdateRange(fBase * 16, KF * 16);
    this.flowerColor.addUpdateRange(fBase * 3, KF * 3);
    this.mesh.instanceMatrix.addUpdateRange(base * 16, this.slots * 16);
    this.meshColor.addUpdateRange(base * 3, this.slots * 3);
  }
}

// ---------------------------------------------------------------------------------- geometry

/**
 * Five curved quads (4 rows each) with the pivot at the root. Unit height, ~0.72 wide. Quads 0–2 are
 * the crossed core; quads 3–4 are slightly offset fillers that only survive within ~16 m (see LOD).
 */
function buildClumpGeometry() {
  const rng = new Rng(SEED + 404);
  const rows = 4, quads = QUADS;
  const verts: number[] = [], norms: number[] = [], uvs: number[] = [], idx: number[] = [], qid: number[] = [];
  for (let q = 0; q < quads; q++) {
    const filler = q >= 3;
    const yaw = (filler ? (q - 3) * Math.PI * 0.5 + 0.4 : (q / 3) * Math.PI) + rng.range(-0.18, 0.18);
    const tilt = rng.range(-0.12, 0.12);
    const ox = rng.range(-0.05, 0.05) + (filler ? rng.range(-0.16, 0.16) : 0), oz = rng.range(-0.05, 0.05) + (filler ? rng.range(-0.16, 0.16) : 0);
    const width = (filler ? 0.6 : 0.72) * rng.range(0.9, 1.1);
    const bend = rng.range(0.12, 0.22);
    const tile = q % 4;
    const mirror = rng.next() < 0.5;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const base = verts.length / 3;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const y = t * (filler ? 0.85 : 1);
      const lean = bend * t * t;             // curve the quad along its normal
      for (let c = 0; c < 2; c++) {
        const lx = (c - 0.5) * width * (1 - t * 0.08);
        const lz = lean + tilt * t;
        const x = ox + lx * cy - lz * sy, z = oz + lx * sy + lz * cy;
        verts.push(x, y, z);
        qid.push(q);
        // normal: mostly up, leaning outwards from the clump axis → soft rounded shading
        const rl = Math.hypot(x, z) || 1;
        const nx = (x / rl) * 0.4, nz = (z / rl) * 0.4;
        const nl = Math.hypot(nx, 1, nz);
        norms.push(nx / nl, 1 / nl, nz / nl);
        const uu = (mirror ? 1 - c : c);
        uvs.push((tile + uu) / 4, t);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      const a = base + r * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('quadId', new THREE.Float32BufferAttribute(qid, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Two crossed quads, 0.16 wide × 0.32 tall, pivot at the root: a stem with a flower head on top. */
function buildFlowerGeometry() {
  const verts: number[] = [], norms: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let q = 0; q < 2; q++) {
    const yaw = q * Math.PI * 0.5, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const base = verts.length / 3;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const lx = (c - 0.5) * 0.16;
      verts.push(lx * cy, r * 0.32, lx * sy);
      norms.push(0, 1, 0);
      uvs.push(c, r);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('[grass] no 2d canvas context');
  return g;
}

/** Thin stem + a 4-petal head (white; tinted per instance) with a warm centre. */
function makeFlowerTexture() {
  const W = 64, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = ctx2d(c);
  g.strokeStyle = 'rgb(70,96,40)'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(32, 126); g.quadraticCurveTo(29, 80, 32, 30); g.stroke();
  // a tiny leaf on the stem
  g.fillStyle = 'rgb(78,110,44)';
  g.beginPath(); g.ellipse(36, 88, 7, 3, -0.6, 0, Math.PI * 2); g.fill();
  const cx = 32, cy = 26;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    g.fillStyle = 'rgb(250,250,250)';
    g.beginPath(); g.ellipse(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, 11, 7, a, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgb(255,200,60)';
  g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  gpuOnlyTexture(tex, 'grass/flower-canvas');
  return tex;
}

// ---------------------------------------------------------------------------------- texture

/** 4 tiles × (4–5 blades): soft-tipped, curved, dark root, per-blade tint, lighter midrib. */
function makeBladeAtlas() {
  const W = 1024, H = 512, TILE = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = ctx2d(c);
  g.clearRect(0, 0, W, H);
  const rng = new Rng(SEED + 505);
  for (let tile = 0; tile < 4; tile++) {
    const nBlades = 9 + (tile % 3);
    const x0 = tile * TILE;
    for (let b = 0; b < nBlades; b++) {
      const rootX = x0 + TILE * (0.14 + 0.72 * ((b + 0.5) / nBlades)) + rng.range(-16, 16);
      const height = H * (b % 3 === 1 ? rng.range(0.45, 0.7) : rng.range(0.68, 1.0));
      const bendX = rng.range(0.1, 0.3) * TILE * (b % 2 ? 1 : -1) * (rng.next() < 0.25 ? -1 : 1);
      const w0 = rng.range(15, 26);
      const hue = rng.range(-1, 1);
      drawBlade(g, rootX, H, bendX, height, w0, hue, rng);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  gpuOnlyTexture(tex, 'grass/blade-canvas');
  return tex;
}

function drawBlade(g: CanvasRenderingContext2D, rx: number, ry: number, bendX: number, height: number, w0: number, hue: number, rng: Rng) {
  // centreline: quadratic bezier from the root up and over
  const p0: [number, number] = [rx, ry], p1: [number, number] = [rx + bendX * 0.35, ry - height * 0.58], p2: [number, number] = [rx + bendX, ry - height];
  const steps = 24;
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, it = 1 - t;
    const x = it * it * p0[0] + 2 * it * t * p1[0] + t * t * p2[0];
    const y = it * it * p0[1] + 2 * it * t * p1[1] + t * t * p2[1];
    const dx = 2 * it * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * it * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const w = (w0 * (1 - t) ** 0.75 + 0.6) * 0.5;
    left.push([x + nx * w, y + ny * w]); right.push([x - nx * w, y - ny * w]);
  }
  const path = () => {
    g.beginPath();
    left.forEach(([lx, ly], i) => { if (i === 0) g.moveTo(lx, ly); else g.lineTo(lx, ly); });
    for (let i = right.length - 1; i >= 0; i--) { const r = right[i]; if (r) g.lineTo(r[0], r[1]); }
    g.closePath();
  };
  // vertical gradient: dark olive root → mid green → lighter yellow-green tip
  const grad = g.createLinearGradient(0, ry, 0, ry - height);
  const rootC = `rgb(${60 + hue * 6},${70 + hue * 4},26)`;
  const midC = `rgb(${112 + hue * 16},${138 + hue * 8},${46 + hue * 5})`;
  const tipC = `rgb(${164 + hue * 20},${172 + hue * 10},${74 + hue * 8})`;
  grad.addColorStop(0, rootC); grad.addColorStop(0.45, midC); grad.addColorStop(1, tipC);
  g.fillStyle = grad;
  g.globalAlpha = 1;
  path(); g.fill();
  // midrib highlight
  g.strokeStyle = `rgba(${185 + hue * 20},196,104,0.5)`;
  g.lineWidth = Math.max(1, w0 * 0.22);
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const l = left[i], r = right[i];
    if (!l || !r) continue;
    const x = (l[0] + r[0]) / 2 + (i % 2 ? 0.3 : -0.3), y = (l[1] + r[1]) / 2;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // darker edge on one side for volume
  g.strokeStyle = `rgba(30,40,12,${0.35 + rng.next() * 0.2})`;
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i <= steps * 0.8; i++) { const r = right[i]; if (!r) continue; const [x, y] = r; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
}
