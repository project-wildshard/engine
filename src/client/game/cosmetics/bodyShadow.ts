/**
 * The player's body shadow (E314 stage 3, Jake 2026-09-30: "a simple body shadow — an invisible low-poly castaway that only
 * casts a shadow"; project/archive/2026-09-30-driftwood-loot.md). The game is first person with no body, so the sand under you was empty.
 * Now a plain low-poly figure (legs, hips, torso, arms, neck, head: ~330 triangles) stands on your feet, turns with the
 * camera and walks — its legs and arms swing with the distance you cover (one morph target, played −1 … +1 so one pose
 * mirrors the other) and it bobs a little with each step. It draws nothing to the screen: its material writes no colour and
 * no depth (Cosmetics.ts's shadow-only material), so the one thing it adds is its SHADOW, and the worn hat and cape ride on
 * it through its `wardrobe` (Cosmetics.ts, shadow mode).
 *
 * Posed with the player: crouched → it squats (the whole figure scaled down to the crouched eye), in the air it hangs
 * under your eye as you jump. Hidden (no draw at all) where a standing figure would look wrong or where there is no
 * sand under you: swimming or under water, on the hoverboard, in the saddle, on the zipline (carried), in a practice room
 * or when the shard is not in play.
 *
 * Shared code: any shard can have it; `ShardManifest.bodyShadow` switches it on (Driftwood only for now; main.ts installs it).
 *
 *   const body = installBodyShadow({ game, player });     // main.ts, once per shard
 *   body.wardrobe.wear('hat', hatMesh)                     // src/shards/driftwood-isle/loot/keepsakes.ts dresses it from GEAR
 *   body.enabled = false                                   // dev / the cost capture: take it out of the frame
 *
 * Cost (E314 stage 3, scripts/e314-keepsakes-capture.mjs --measure, phone tier): it sits on SHADOW_LAYER, so NO draw in the
 * view; one draw of ~330 triangles in each shadow map the frame renders (3 on Driftwood's phone frame: 3 draws, 984 tris;
 * with the hat + cape 6 draws); the GPU time difference was below the measurement noise (±0.4 ms at 804 × 1748 on the M5).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHADOW_LAYER } from '@wildshard/engine/core/shadowLayer';
import { shadowOnlyMaterial, Wardrobe } from './cosmetics';

/** what the body reads of the player (Player.ts satisfies it) */
export interface BodyPlayer {
  position: THREE.Vector3; yaw: number; crouching: boolean; hover: boolean; swimming: boolean; submerged: boolean;
  carried: boolean; ride: object | null;
}
export interface BodyHost {
  game: { rootScene: THREE.Scene; camera: THREE.Camera; onUpdate: (fn: (dt: number, t: number) => void, label?: string) => void };
  player: BodyPlayer;
  /** extra reasons to hide it (a practice room, the title screen) */
  hidden?: () => boolean;
}

/** the figure's joints (m over the feet): the hips the legs swing from, the shoulders the arms swing from */
const HIP_Y = 0.92, SHOULDER_Y = 1.42;
/** the swing at a full stride (rad): legs, arms */
const LEG_SWING = 0.5, ARM_SWING = 0.38;
/** rad of the walk cycle per metre walked (a cycle = two steps ≈ 1.5 m) */
const STRIDE = (Math.PI * 2) / 1.5;
/** the crouched figure's height (Player: the eye drops 0.65 m of 1.68) */
const CROUCH_SCALE = (1.68 - 0.65) / 1.68;

/** non-indexed (the parts merge into one flat list) */
const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** a tapered 6-sided tube from y0 (radius r0) to y1 (r1) at (x, z), squashed in depth by `d` */
function tube(x: number, z: number, y0: number, y1: number, r0: number, r1: number, d = 1, sides = 6): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, false);
  g.scale(1, 1, d);
  g.translate(x, (y0 + y1) / 2, z);
  return flat(g);
}

/** the body in own space (feet at y 0, facing +Z) and its stride pose: legs and arms rotated about their joints */
function bodyGeometry(): THREE.BufferGeometry {
  const legs = (side: number): THREE.BufferGeometry[] => [
    tube(side * 0.1, 0, 0.06, HIP_Y, 0.06, 0.085),
    flat(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(side * 0.1, 0.035, 0.05)),   // the foot
  ];
  const arms = (side: number): THREE.BufferGeometry[] => [
    tube(side * 0.24, 0, 0.8, SHOULDER_Y, 0.042, 0.055),
    new THREE.IcosahedronGeometry(0.05, 0).translate(side * 0.24, 0.77, 0),     // the hand
  ];
  const trunk = [
    tube(0, 0, HIP_Y - 0.06, 1.2, 0.17, 0.19, 0.62, 8),                                          // hips and belly
    tube(0, 0, 1.2, SHOULDER_Y + 0.06, 0.19, 0.23, 0.58, 8),                                      // chest to the shoulders
    tube(0, 0, SHOULDER_Y + 0.04, 1.56, 0.05, 0.05),                                             // neck
    new THREE.IcosahedronGeometry(0.105, 1).scale(0.95, 1.1, 1).translate(0, 1.64, 0.01), // head
  ];
  const parts = { legL: legs(-1), legR: legs(1), armL: arms(-1), armR: arms(1) };
  const pose = (gs: THREE.BufferGeometry[], pivotY: number, angle: number): THREE.BufferGeometry[] =>
    gs.map((g) => g.clone().translate(0, -pivotY, 0).rotateX(angle).translate(0, pivotY, 0));
  // the stride: left leg forward (+z is forward: a rotation about −x swings the foot forward), right back, arms opposite
  const rest = [...parts.legL, ...parts.legR, ...parts.armL, ...parts.armR, ...trunk];
  const stride = [
    ...pose(parts.legL, HIP_Y, -LEG_SWING), ...pose(parts.legR, HIP_Y, LEG_SWING),
    ...pose(parts.armL, SHOULDER_Y, ARM_SWING), ...pose(parts.armR, SHOULDER_Y, -ARM_SWING), ...trunk,
  ];
  const strip = (g: THREE.BufferGeometry): THREE.BufferGeometry => { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); return g; };
  const base = mergeGeometries(rest.map(strip), false);
  const moved = mergeGeometries(stride.map(strip), false);
  base.morphAttributes.position = [moved.getAttribute('position')];
  base.computeBoundingSphere();
  if (base.boundingSphere) base.boundingSphere.radius += 0.3; // room for the swing
  return base;
}

export class BodyShadow {
  readonly wardrobe: Wardrobe = new Wardrobe('shadow');
  /** false: out of the frame altogether (no draw), whatever the player does */
  enabled = true;
  readonly mesh: THREE.Mesh;
  private phase = 0; private swing = 0; private crouch = 1;
  private lastX = 0; private lastZ = 0; private have = false;

  constructor() {
    this.mesh = new THREE.Mesh(bodyGeometry(), shadowOnlyMaterial());
    this.mesh.name = 'body-shadow';
    this.mesh.castShadow = true; this.mesh.receiveShadow = false;
    this.mesh.layers.set(SHADOW_LAYER); // the shadow pass only: no draw at all in the view (src/client/engine/core/shadowLayer.ts)
    this.mesh.morphTargetInfluences = [0];
    this.wardrobe.root.name = 'body-shadow-root';
    this.wardrobe.root.add(this.mesh);
  }

  /** is the figure drawn this frame (its shadow cast) */
  get shown(): boolean { return this.wardrobe.root.visible; }

  /** pose it on the player's feet: (x, z) where the eye is over, `feetY` the feet, `yaw` the camera's; `show` false hides it */
  update(dt: number, x: number, feetY: number, z: number, yaw: number, crouching: boolean, show: boolean): void {
    const root = this.wardrobe.root;
    root.visible = show && this.enabled;
    if (!root.visible) { this.have = false; return; }
    // the walk: the phase advances with the ground covered, the swing eases in and out with the pace
    const moved = this.have ? Math.min(1, Math.hypot(x - this.lastX, z - this.lastZ)) : 0;
    this.lastX = x; this.lastZ = z; this.have = true;
    const speed = dt > 0 ? moved / dt : 0;
    this.phase = (this.phase + moved * STRIDE) % (Math.PI * 2);
    this.swing += ((speed > 0.4 ? Math.min(1, speed / 4.5) : 0) - this.swing) * Math.min(1, dt * 8);
    const infl = this.mesh.morphTargetInfluences;
    if (infl) infl[0] = Math.sin(this.phase) * this.swing;
    this.crouch += ((crouching ? CROUCH_SCALE : 1) - this.crouch) * Math.min(1, dt * 10);
    const bob = Math.abs(Math.cos(this.phase)) * 0.035 * this.swing;
    this.wardrobe.follow(x, feetY + bob, z, yaw);
    root.scale.set(1, this.crouch, 1);
  }
}

/** the body shadow in the running game: added to the scene, posed after the player moves each frame */
export function installBodyShadow(h: BodyHost): BodyShadow {
  const body = new BodyShadow();
  h.game.rootScene.add(body.wardrobe.root);
  const p = h.player;
  h.game.onUpdate((dt) => {
    const show = !p.swimming && !p.submerged && !p.hover && !p.carried && p.ride === null && h.hidden?.() !== true;
    const eye = h.game.camera.position; // the rendered eye: interpolated between physics steps, so the shadow never judders
    body.update(dt, eye.x, p.position.y, eye.z, p.yaw, p.crouching, show);
  }, 'body-shadow');
  return body;
}
