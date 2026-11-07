/**
 * E147: the sun's shadow steps crossfade instead of popping (the user's pick A; Bethesda's `fSunShadowUpdateTime`).
 *
 * The day / night clock turns the shadow light in steps (a stepped clock's SHADOW_STEP, E89): a map that turns a hair every
 * frame re-rasterizes every edge every frame and the shadows crawl. On the phone's 2c2k rig (1.6 cm texels) each step
 * moved the pier pennant's shadow ~3 cm at once, a jump every ~2 s in the middle of the view. Now a step starts a fade:
 *
 * - every cascade but the last has a **ghost** DirectionalLight (intensity 0, never lights anything) that keeps its
 *   shadow at the direction the step left, on the same square as the cascade would draw it, snapped the way CSM snaps;
 * - that cascade's shadow term is mix(ghost, cascade, uSunFade) while uSunFade runs 0 → 1 over SUN_FADE_S, so the edge
 *   slides from the old place to the new one. Both maps are held still, so nothing crawls;
 * - a ghost's map renders only while a fade runs (`shadow.autoUpdate`); settled, the shader skips it (a uniform branch).
 *   Its casters move with the frame (the pennant's flutter): it is a live second light, not a frozen snapshot.
 * - The last cascade steps without a fade: its texel is ~9 cm, larger than one step's move.
 *
 * The clock holds its next step until the fade ends (`busy`). A turn larger than MAX_FADE (the sun ↔ moon swap, a Time of
 * day pick) moves at once. The fading-out ghost is sampled with the 3×3 tent, 4 taps (E153's B, the user's pick A+B:
 * "they all look the same, use the cheapest").
 */
import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CSMFrustum } from 'three/examples/jsm/csm/CSMFrustum.js';

/** the fade's progress, 0 = the old direction … 1 = the new (settled); every CSM material shares it */
export const sunFadeUniform = { value: 1 };
/** the fade's length (s) (E153, the user's pick A+B: 1 s — the fade runs on ~34 % of frames, not ~74 %) */
const SUN_FADE_S = 1;
/** the ghosts' `shadow.radius`, i.e. their tent (shadowFilter.ts: < 1 is the 3×3 tent, 4 hardware taps) — the fading-out
 *  map sampled cheaper than its cascade's 7×7, while a fade runs only (E153's B) */
const GHOST_RADIUS = 0.6;
/** a larger turn is a jump, not a step: it moves at once */
const MAX_FADE = 5 * Math.PI / 180;

const _origin = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _center = new THREE.Vector3();
const _lo = new THREE.Matrix4(), _loInv = new THREE.Matrix4(), _c2l = new THREE.Matrix4(), _swap = new THREE.Matrix4();
const _box = new THREE.Box3();

/**
 * Patch the CSM light loop (three r186 CSMShader, CSM_FADE branch) once, before anything compiles: the loop skips the
 * ghosts (they have no cascade), and a CSM_GHOSTS material mixes ghost i's shadow into cascade i's while a fade runs.
 * The ghosts are the shadow lights after the cascades (three orders shadow-casting lights as the scene adds them).
 */
export function installShadowFadeChunk(): boolean {
  const pars = THREE.ShaderChunk.lights_pars_begin;
  const loop = THREE.ShaderChunk.lights_fragment_begin;
  const guard = '#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n\t\t\t\t// NOTE: Depth gets larger away from the camera.';
  const sample = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\n\n\t\t\t\t\tbool shouldFadeLastCascade';
  if (!loop.includes(guard) || !loop.includes(sample)) { console.warn('[sky] CSMShader changed: the E147 shadow fade is off'); return false; }
  THREE.ShaderChunk.lights_pars_begin = `${pars}
#ifdef CSM_GHOSTS
	uniform float uSunFade;
#endif`;
  THREE.ShaderChunk.lights_fragment_begin = loop
    .replace(guard, guard.replace('#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )', '#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) && ( UNROLLED_LOOP_INDEX < CSM_CASCADES )'))
    .replace(sample, /* glsl */`float csmShadow = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
					#if defined( CSM_GHOSTS ) && ( UNROLLED_LOOP_INDEX < CSM_GHOSTS ) && ( CSM_CASCADES + UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
					// E147: the cascade fades in from its ghost (the direction before the step)
					if ( uSunFade < 1.0 && directLight.visible && receiveShadow ) {
						DirectionalLightShadow ghostShadow = directionalLightShadows[ CSM_CASCADES + UNROLLED_LOOP_INDEX ];
						csmShadow = mix( getShadow( directionalShadowMap[ CSM_CASCADES + UNROLLED_LOOP_INDEX ], ghostShadow.shadowMapSize, ghostShadow.shadowIntensity, ghostShadow.shadowBias, ghostShadow.shadowRadius, vDirectionalShadowCoord[ CSM_CASCADES + UNROLLED_LOOP_INDEX ] ), csmShadow, uSunFade );
					}
					#endif
					directLight.color *= csmShadow;

					bool shouldFadeLastCascade`);
  return true;
}

export class ShadowFade {
  /** ghost i keeps cascade i's shadow at the direction before the step (every cascade but the last) */
  readonly ghosts: THREE.DirectionalLight[] = [];
  /** the direction the last step left (the ghosts') */
  private readonly from = new THREE.Vector3();
  /** the CSM direction last frame */
  private readonly last = new THREE.Vector3();
  private readonly lsFrustum = new CSMFrustum();
  private t = 1;
  /** E174 (shadowVariants.ts): a ghost smaller than its cascade takes its cascade's normal bias × this (its texel is larger) */
  biasScale = 1;

  private readonly csm: CSM;
  private readonly camera: THREE.Camera;
  constructor(csm: CSM, camera: THREE.Camera, parent: THREE.Object3D) {
    this.csm = csm;
    this.camera = camera;
    const n = Math.max(1, csm.lights.length - 1);
    for (let i = 0; i < n; i++) {
      const src = csm.lights[i];
      if (!src) break;
      const g = new THREE.DirectionalLight(0xffffff, 0);
      g.name = `sun-shadow-fade-${String(i)}`;
      g.castShadow = true;
      g.shadow.mapSize.copy(src.shadow.mapSize);
      g.shadow.bias = src.shadow.bias;
      g.shadow.autoUpdate = false;
      // E153: draw the map once at the first shadow pass (the boot's firstFrame). three allocates a light's map only when
      // it renders, and until then every lit program's ghost sampler (sampler2DShadow) is bound to the RGBA empty texture:
      // GL_INVALID_OPERATION, the draw is dropped. So the world's lit draws were all invalid until the first sun step
      // (~2 s into play), and that step's frame built every lit Metal pipeline at once: a 1.6–1.9 s freeze on a cold
      // shader cache on the M5 (WebKit), the "huge lag" of a first load on the phone.
      g.shadow.needsUpdate = true;
      parent.add(g, g.target);
      this.ghosts.push(g);
    }
    this.last.copy(csm.lightDirection);
    this.from.copy(csm.lightDirection);
  }

  /** a fade is running: the clock holds its next step */
  get busy(): boolean { return this.t < 1; }
  /** the fade began this frame and the ghosts must draw now, to catch the shadow from before the step (`adopt` refused) */
  started = false;

  /**
   * E153: the boot's warm-up (Sky.warmShadows): settle on the CSM's direction and draw each ghost's map on its cascade's
   * square at the next render, so the casters' depth draws into the ghost maps are built before play, not at the first
   * sun step. Only while no fade runs (the boot never has one).
   */
  warm(): void {
    if (this.busy) return;
    this.last.copy(this.csm.lightDirection);
    this.from.copy(this.csm.lightDirection);
    this.ghosts.forEach((g, i) => { this.place(g, i); g.shadow.needsUpdate = true; });
  }

  /** after csm.update(): notice a step, advance the fade, and place the ghosts' shadows while it runs */
  update(dt: number): void {
    this.started = false;
    const dir = this.csm.lightDirection;
    if (!dir.equals(this.last)) {
      const turn = dir.angleTo(this.last);
      // a step starts a fade from where the last one ended; a jump (or a step mid-fade) moves at once
      if (turn < MAX_FADE && this.t >= 1) { this.from.copy(this.last); this.t = 0; this.started = !this.adopt(); } else this.t = 1;
      this.last.copy(dir);
    }
    if (this.t < 1) this.t = Math.min(1, this.t + dt / SUN_FADE_S);
    const k = this.t;
    sunFadeUniform.value = k * k * (3 - 2 * k);
    const on = this.t < 1;
    this.ghosts.forEach((g, i) => { g.shadow.autoUpdate = on; if (on) this.place(g, i); });
  }

  /**
   * G913: a fade's first frame redrew every ghost at once (+~40 draws on the phone, 164-172 a frame). Each cascade's map
   * already holds its shadow from before the step, with the matrix it was drawn with: the ghost takes that pair and the
   * cascade takes the ghost's, redrawn at the new direction on its own tick (weighted uSunFade, ~0 by then). False, and
   * nothing swapped, unless every pair is drawn at one size.
   */
  private adopt(): boolean {
    const pairs = this.ghosts.map((g, i) => ({ ghost: g.shadow, cascade: this.csm.lights[i]?.shadow }));
    for (const { ghost, cascade } of pairs) {
      if (cascade === undefined || ghost.map === null || cascade.map === null) return false;
      if (ghost.map.width !== cascade.map.width || ghost.map.height !== cascade.map.height) return false;
    }
    for (const { ghost, cascade } of pairs) {
      if (cascade === undefined) continue;
      const map = ghost.map; ghost.map = cascade.map; cascade.map = map;
      _swap.copy(ghost.matrix); ghost.matrix.copy(cascade.matrix); cascade.matrix.copy(_swap);
    }
    return true;
  }

  /** CSM.update for cascade i, at the old direction: the same square, snapped to its own texel grid */
  private place(ghost: THREE.DirectionalLight, i: number): void {
    const light = this.csm.lights[i], frustum = this.csm.frustums[i];
    if (!light || !frustum) return;
    const src = light.shadow.camera, cam = ghost.shadow.camera;
    if (cam.left !== src.left || cam.right !== src.right || cam.top !== src.top || cam.bottom !== src.bottom || cam.near !== src.near || cam.far !== src.far) {
      cam.left = src.left; cam.right = src.right; cam.top = src.top; cam.bottom = src.bottom; cam.near = src.near; cam.far = src.far;
      cam.updateProjectionMatrix();
    }
    const s = ghost.shadow;
    s.normalBias = this.biasScale === 1 ? light.shadow.normalBias : Math.min(0.14, light.shadow.normalBias * this.biasScale); s.radius = GHOST_RADIUS; s.intensity = light.shadow.intensity;
    const size = s.mapSize.x, texelW = (cam.right - cam.left) / size, texelH = (cam.top - cam.bottom) / size;
    _lo.lookAt(_origin, this.from, _up);
    _loInv.copy(_lo).invert();
    _c2l.multiplyMatrices(_loInv, this.camera.matrixWorld);
    frustum.toSpace(_c2l, this.lsFrustum);
    _box.makeEmpty();
    for (const v of this.lsFrustum.vertices.near) _box.expandByPoint(v);
    for (const v of this.lsFrustum.vertices.far) _box.expandByPoint(v);
    _box.getCenter(_center);
    _center.z = _box.max.z + this.csm.lightMargin;
    _center.x = Math.floor(_center.x / texelW) * texelW;
    _center.y = Math.floor(_center.y / texelH) * texelH;
    _center.applyMatrix4(_lo);
    ghost.position.copy(_center);
    ghost.target.position.copy(_center).add(this.from);
  }
}
