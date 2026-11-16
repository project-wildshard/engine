/**
 * Hanging bodies that swing (meta SHARD-SOURCE SS8c, shard-format `look.light.swings`): a lantern on its rope, a sign, a
 * banner. Each swing is a damped pendulum hanging from its pivot: it leans downwind with the gust (`amount` radians at
 * full gust), rocks at about its `rate`, and is kicked by a player or creature whose body comes within `reach` of it.
 *
 *   const swings = new SwingField(look.light.swings);
 *   swings.update(dt, movers);           // once a frame, after the wind clock (wind.ts) has advanced
 *   swings.uniforms                      // every swinging surface and card reads these (sceneSurface.ts)
 *   swings.place(n, at, out)             // where a point hanging from swing n is now (a lamp's light)
 *
 * The tilt is two angles (toward +x and toward +z), turned into one quaternion a swing for the shader: a vertex at `p`
 * hanging from pivot `c` draws at `c + q (p - c)`, so the whole lantern turns rigidly and its light goes with it.
 */
import * as THREE from 'three';
import { WIND_DIR, windGustAt } from './wind';

/** One `look.light.swings` row. */
export interface SwingRow {
  readonly pivot: readonly [number, number, number];
  readonly length: number;
  readonly rate: number;
  readonly amount: number;
  readonly reach: number;
}

/** A body that kicks swings it touches: its feet at `x, y, z`, `radius` metres round, `height` tall. */
export interface SwingMover { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly radius: number }

/** Shader arrays hold this many swings (shard-format `LOOK_SWINGS_MAX`). */
export const SWINGS_MAX = 32;
/** The steepest a swing leans, radians (a hard kick never flips a lantern over its arm). */
export const SWING_TILT_MAX = 0.7;
/** How tall a mover's body is, metres: it touches a body hanging anywhere from its feet to here. */
const MOVER_HEIGHT = 1.9;
/** Damping ratio: a kicked lantern rocks for a few seconds and settles. */
const DAMPING = 0.12;
/** How much of a mover's speed a touch gives the bob (a brush, not a carry). */
const KICK = 0.25;
/** A step faster than this (m/s) is a teleport or a respawn, never a kick. */
const TELEPORT_SPEED = 30;

interface Swing {
  readonly row: SwingRow;
  readonly pivot: THREE.Vector3;
  readonly omega: number;
  /** angles toward +x and +z, and their rates */
  ax: number; az: number; vx: number; vz: number;
  /** a slow sway of its own, so no two lanterns rock together */
  readonly phase: number;
}

const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

/** The rotation that leans a hanging body `ax` toward +x and `az` toward +z (its bob moves that way). */
export function swingQuaternion(ax: number, az: number, out: THREE.Quaternion): THREE.Quaternion {
  // a body hanging along -y moves toward +x when it turns about +z by +ax, and toward +z when it turns about -x by +az
  const qz = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, ax), qx = new THREE.Quaternion().setFromAxisAngle(AXIS_X, -az);
  return out.copy(qz).multiply(qx);
}

/** The one set of swing uniforms every swinging surface and card binds (one scene page draws at a time); a page's
 *  `SwingField` writes them and `dispose` stills them. */
export const swingUniforms: { readonly wsSwingPivot: { readonly value: THREE.Vector4[] }; readonly wsSwingTilt: { readonly value: THREE.Vector4[] } } = {
  wsSwingPivot: { value: Array.from({ length: SWINGS_MAX }, () => new THREE.Vector4()) },
  wsSwingTilt: { value: Array.from({ length: SWINGS_MAX }, () => new THREE.Vector4(0, 0, 0, 1)) },
};

export class SwingField {
  readonly uniforms: typeof swingUniforms = swingUniforms;
  private readonly swings: Swing[];
  private readonly last = new Map<string, { x: number; z: number; seen: boolean }>();
  private readonly q = new THREE.Quaternion();
  private time = 0;

  constructor(rows: readonly SwingRow[]) {
    if (rows.length > SWINGS_MAX) throw new Error(`A look declares ${rows.length} swings; at most ${SWINGS_MAX}`);
    this.swings = rows.map((row, i) => ({ row, pivot: new THREE.Vector3(...row.pivot), omega: row.rate * Math.PI * 2, ax: 0, az: 0, vx: 0, vz: 0, phase: i * 2.399 }));
    this.swings.forEach((swing, i) => { this.uniforms.wsSwingPivot.value[i]?.set(swing.pivot.x, swing.pivot.y, swing.pivot.z, 1); });
  }

  get count(): number { return this.swings.length; }

  /** still every swing in the shared uniforms (the page left) */
  dispose(): void {
    for (const tilt of this.uniforms.wsSwingTilt.value) tilt.set(0, 0, 0, 1);
    this.last.clear();
  }

  /** swing `n`'s lean, radians toward +x and +z */
  tilt(n: number): { readonly x: number; readonly z: number } {
    const swing = this.swings[n];
    return swing === undefined ? { x: 0, z: 0 } : { x: swing.ax, z: swing.az };
  }

  /** where a point `at` (world, at rest) hanging from swing `n` is now; `at` itself when there is no such swing */
  place(n: number, at: THREE.Vector3Like, out: THREE.Vector3): THREE.Vector3 {
    out.set(at.x, at.y, at.z);
    const swing = this.swings[n];
    if (swing === undefined) return out;
    swingQuaternion(swing.ax, swing.az, this.q);
    return out.sub(swing.pivot).applyQuaternion(this.q).add(swing.pivot);
  }

  /**
   * One frame: each swing leans toward the gust at its bob and rocks at its rate (semi-implicit Euler, a few substeps so a
   * long frame never blows up), a mover touching its bob kicks it with its own velocity, then the uniforms are written.
   */
  update(dt: number, movers: Iterable<SwingMover> = []): void {
    if (dt <= 0) return;
    this.time += dt;
    const touches = this.touches(dt, movers);
    for (const [i, swing] of this.swings.entries()) {
      const { row } = swing, bobX = swing.pivot.x, bobZ = swing.pivot.z;
      const gust = windGustAt(bobX, bobZ), flutter = 0.25 * Math.sin(this.time * swing.omega * 0.37 + swing.phase);
      const lean = row.amount * Math.max(0, Math.min(1, gust)) * (1 + flutter);
      const restX = WIND_DIR.x * lean, restZ = WIND_DIR.z * lean;
      for (const touch of touches) if (touch.swing === i) { swing.vx += touch.kx; swing.vz += touch.kz; }
      const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps, k = swing.omega * swing.omega, c = 2 * DAMPING * swing.omega;
      for (let s = 0; s < steps; s++) {
        swing.vx += (-k * (swing.ax - restX) - c * swing.vx) * h; swing.vz += (-k * (swing.az - restZ) - c * swing.vz) * h;
        swing.ax += swing.vx * h; swing.az += swing.vz * h;
      }
      const lean2 = Math.hypot(swing.ax, swing.az);
      if (lean2 > SWING_TILT_MAX) { const f = SWING_TILT_MAX / lean2; swing.ax *= f; swing.az *= f; swing.vx *= 0.5; swing.vz *= 0.5; }
      swingQuaternion(swing.ax, swing.az, this.q);
      this.uniforms.wsSwingTilt.value[i]?.set(this.q.x, this.q.y, this.q.z, this.q.w);
    }
  }

  /** this frame's kicks: a moving body whose side comes within `reach` of a bob, by the bob's height range */
  private touches(dt: number, movers: Iterable<SwingMover>): { swing: number; kx: number; kz: number }[] {
    const out: { swing: number; kx: number; kz: number }[] = [];
    for (const seen of this.last.values()) seen.seen = false;
    const bob = new THREE.Vector3();
    for (const mover of movers) {
      const before = this.last.get(mover.id);
      let vx = before === undefined ? 0 : (mover.x - before.x) / dt, vz = before === undefined ? 0 : (mover.z - before.z) / dt;
      if (vx * vx + vz * vz > TELEPORT_SPEED * TELEPORT_SPEED) { vx = 0; vz = 0; }
      if (before === undefined) this.last.set(mover.id, { x: mover.x, z: mover.z, seen: true }); else { before.x = mover.x; before.z = mover.z; before.seen = true; }
      if (vx === 0 && vz === 0) continue;
      for (const [i, swing] of this.swings.entries()) {
        const { row } = swing;
        if (row.reach <= 0) continue;
        this.place(i, { x: swing.pivot.x, y: swing.pivot.y - row.length, z: swing.pivot.z }, bob);
        if (bob.y < mover.y - row.reach || bob.y > mover.y + MOVER_HEIGHT + row.reach) continue;
        const dx = bob.x - mover.x, dz = bob.z - mover.z, touch = mover.radius + row.reach;
        if (dx * dx + dz * dz > touch * touch) continue;
        // the bob takes a share of the body's speed as angular speed (v / length), every frame the body brushes it
        const share = (KICK / Math.max(row.length, 0.05)) * Math.min(1, dt * 8);
        out.push({ swing: i, kx: vx * share, kz: vz * share });
      }
    }
    for (const [id, seen] of this.last) if (!seen.seen) this.last.delete(id);
    return out;
  }
}

/** GLSL for a swinging vertex: `wsSwingAt(world, n)` turns a world point round swing n's pivot (n from 0). */
export const SWING_GLSL: string = /* glsl */`
uniform vec4 wsSwingPivot[ ${SWINGS_MAX} ];
uniform vec4 wsSwingTilt[ ${SWINGS_MAX} ];
vec3 wsSwingRotate( vec4 q, vec3 v ) { return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v ); }
vec3 wsSwingAt( vec3 world, int n ) {
	vec3 c = wsSwingPivot[ n ].xyz;
	return c + wsSwingRotate( wsSwingTilt[ n ], world - c );
}
`;

/** The page's swings that look lamps hang from (`lamps[].swing`), one page at a time like `swingUniforms`. */
let lampSwings: SwingField | null = null;
/** The page's swings for its look lamps; returns the undo. */
export function setLampSwings(field: SwingField): () => void {
  lampSwings = field;
  return () => { if (lampSwings === field) lampSwings = null; };
}
/** The swings look lamps hang from now, or null (no page has any). */
export function currentLampSwings(): SwingField | null { return lampSwings; }
