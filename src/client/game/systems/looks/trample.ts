import * as THREE from 'three';
import { grassBaseHeightAt } from '../../../../shared/game/systems/looks/grassField';
import { TRAMPLE_SPAN, TRAMPLE_SIZE, TrampleField } from '../../../../shared/game/systems/looks/trampleField';

/**
 * Grass that parts around movers and stays trampled (Nalati, `stealth-and-storms.md` → "Living grass").
 *
 *   import { trample, grassHeightAt } from './GrassTrample';
 *   trample.push(x, z, radius, strength?, vx?, vz?)   // every frame, for every mover (player, horse, wolves…)
 *   const stop = trample.track(animal.position, 0.6, 1, () => animal.alive)   // or once: pushed every frame for you,
 *                                                     // velocity from its last position; `stop()` to forget it
 *   grassHeightAt(x, z)                               // effective height (m) incl. trampling — stealth + AI
 *   trample.amountAt(x, z)                            // 0..1 how flattened (a fresh track is ~1)
 *
 * Two layers, both read by the painterly grass vertex shader:
 *  - **live movers**: up to 16 `vec4(x, z, radius, strength)` per frame (the nearest to the camera win) —
 *    blades bend away from the body at any distance in the grass ring, so a wolf is seen by the wave it pushes;
 *  - **the trample map**: a 256² RG8 DataTexture, 0.5 m texels (a 128 m window that follows the player,
 *    addressed toroidally by world position so it never scrolls; rows/columns entering the window are
 *    cleared). R = how flat, G = which way the blades lie. Pushes stamp into it at once; it recovers over
 *    `RECOVER` seconds and is uploaded at most 10×/s (only while anything is flat).
 *
 * `update(dt, playerPos)` is called once a frame by the painterly grass (before it draws), after the movers
 * have pushed; it uploads, decays and resets the live list. Push from your own update — order within a frame
 * does not matter, a push lands in the next draw either way.
 */

const SIZE = TRAMPLE_SIZE;
const SPAN = TRAMPLE_SPAN;
const MAX_MOVERS = 16;

export class GrassTrample extends TrampleField {
  /** RG8: the lie vector × flatten amount, 0.5-biased (128, 128 = standing) — filters linearly, unlike an angle */
  readonly texture: THREE.DataTexture;
  readonly uniforms: { tTrample: { value: THREE.DataTexture | null; };
/** xz = window centre (m), z = window half-span (m), w = 1 / span */
uTrampleWin: { value: THREE.Vector4; }; uMovers: { value: THREE.Vector4[]; }; uMoverCount: { value: number; }; } = {
    tTrample: { value: null as THREE.DataTexture | null },
    /** xz = window centre (m), z = window half-span (m), w = 1 / span */
    uTrampleWin: { value: new THREE.Vector4(0, 0, SPAN / 2, 1 / SPAN) },
    uMovers: { value: Array.from({ length: MAX_MOVERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uMoverCount: { value: 0 },
  };

  private data = new Uint8Array(SIZE * SIZE * 2).fill(128);
  private live: { x: number; z: number; r: number; s: number; d: number }[] = [];
  private liveN = 0;

  constructor() {
    super();
    this.texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms.tTrample.value = this.texture;
    for (let i = 0; i < MAX_MOVERS; i++) this.live.push({ x: 0, z: 0, r: 0, s: 0, d: 0 });
  }

  /**
   * A mover at (x, z) this frame: bends blades within ~`radius` m away from it and stamps the trample map.
   * `strength` 1 = a person / wolf, 1.5 = a horse. (vx, vz) = its velocity (m/s) — trampled blades lie the
   * way it went; standing still they lie outward.
   */
  override push(x: number, z: number, radius: number, strength = 1, vx = 0, vz = 0): void {
    // live list: keep the MAX_MOVERS nearest the player (the camera)
    const d = (x - this.cx) ** 2 + (z - this.cz) ** 2;
    let slot = -1;
    if (this.liveN < MAX_MOVERS) slot = this.liveN++;
    else {
      let wd = d;
      for (let i = 0; i < MAX_MOVERS; i++) { const m = this.live[i]; if (m && m.d > wd) { wd = m.d; slot = i; } }
    }
    const m = this.live[slot];
    if (m) { m.x = x; m.z = z; m.r = radius; m.s = strength; m.d = d; }
    super.push(x, z, radius, strength, vx, vz);
  }

  /** live movers → uniforms */
  protected override frame(): void {
    const u = this.uniforms;
    for (let i = 0; i < MAX_MOVERS; i++) {
      const m = this.live[i], v = u.uMovers.value[i];
      if (!v) continue;
      if (m && i < this.liveN) v.set(m.x, m.z, m.r, m.s); else v.set(0, 0, 0, 0);
    }
    u.uMoverCount.value = this.liveN;
    this.liveN = 0;
    u.uTrampleWin.value.set(this.cx, this.cz, SPAN / 2, 1 / SPAN);
  }

  protected override texels(): Uint8Array { return this.data; }
  protected override uploaded(): void { this.texture.needsUpdate = true; }
}

/** the world's trample map (a singleton — movers anywhere push into it) */
export const trample: GrassTrample = new GrassTrample();

/**
 * Effective grass height at (x, z) in metres, including trampling (a fresh track lays it to ~15 %).
 * The stealth `cover` and the wolves' "in grass ≥ 0.8 m" read this.
 */
export function grassHeightAt(x: number, z: number): number {
  return grassBaseHeightAt(x, z) * (1 - 0.85 * trample.amountAt(x, z));
}

/** GLSL for the grass vertex shader: uniforms + `vec2 trampleBend(vec2 p)` → bend vector (radians × dir) */
type TrampleShaderSource = "\nuniform sampler2D tTrample;\nuniform vec4 uTrampleWin;\nuniform vec4 uMovers[16];\nuniform int uMoverCount;\nvec2 trampleBend( vec2 p ) {\n  vec2 b = vec2( 0.0 );\n  // persistent trample map (toroidal, world-addressed)\n  vec2 rel = abs( p - uTrampleWin.xy );\n  float inWin = 1.0 - smoothstep( uTrampleWin.z - 6.0, uTrampleWin.z - 1.0, max( rel.x, rel.y ) );\n  if ( inWin > 0.0 ) {\n    vec2 t = texture( tTrample, p * uTrampleWin.w ).rg * ( 255.0 / 127.0 ) - ( 127.5 / 127.0 );\n    b += t * 1.3 * inWin;\n  }\n  // live movers: push blades away from the body\n  for ( int i = 0; i < 16; i++ ) {\n    if ( i >= uMoverCount ) break;\n    vec4 m = uMovers[ i ];\n    vec2 d = p - m.xy;\n    float r = m.z * 1.6;\n    float l2 = dot( d, d );\n    if ( l2 < r * r ) {\n      float l = sqrt( l2 ) + 1e-3;\n      float f = 1.0 - l / r;\n      b += d / l * f * f * 1.6 * m.w;\n    }\n  }\n  return b;\n}\n";
export const TRAMPLE_GLSL: TrampleShaderSource = /* glsl */`
uniform sampler2D tTrample;
uniform vec4 uTrampleWin;
uniform vec4 uMovers[${MAX_MOVERS}];
uniform int uMoverCount;
vec2 trampleBend( vec2 p ) {
  vec2 b = vec2( 0.0 );
  // persistent trample map (toroidal, world-addressed)
  vec2 rel = abs( p - uTrampleWin.xy );
  float inWin = 1.0 - smoothstep( uTrampleWin.z - 6.0, uTrampleWin.z - 1.0, max( rel.x, rel.y ) );
  if ( inWin > 0.0 ) {
    vec2 t = texture( tTrample, p * uTrampleWin.w ).rg * ( 255.0 / 127.0 ) - ( 127.5 / 127.0 );
    b += t * 1.3 * inWin;
  }
  // live movers: push blades away from the body
  for ( int i = 0; i < ${MAX_MOVERS}; i++ ) {
    if ( i >= uMoverCount ) break;
    vec4 m = uMovers[ i ];
    vec2 d = p - m.xy;
    float r = m.z * 1.6;
    float l2 = dot( d, d );
    if ( l2 < r * r ) {
      float l = sqrt( l2 ) + 1e-3;
      float f = 1.0 - l / r;
      b += d / l * f * f * 1.6 * m.w;
    }
  }
  return b;
}
`;
