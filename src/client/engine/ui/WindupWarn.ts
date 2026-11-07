import { uiScope, mountUi } from './ownership';
import * as THREE from 'three';
import './styles/combat.css';

/**
 * WindupWarn — E297 (DRIFTWOOD-TOP10 row 1): the warning BEFORE an off-screen hit. When an enemy starts its wind-up (a
 * boar or bear pawing before a charge, a crab raising its claws, the cutlass drawn back, a monkey's throw) and it is
 * outside the view or behind you, an amber chevron sits on the screen edge toward it — pulsing, growing as the attack
 * comes — until the attack lands, misses or is broken, or the attacker comes into view. It is the "look out" half of
 * the pair; HurtArc's red arc on the crosshair ring is the "you were hit from there" half after it.
 *
 * DOM in `#hud` (styled in `src/client/engine/ui/styles/combat.css`, prefix `ws-combat-warn`). Pooled (SLOTS marks, the oldest
 * recycled), no per-frame allocation beyond the style strings of a mark that is showing.
 *
 *   const warn = new WindupWarn();
 *   animals.onWindup = (a, dur) => warn.start(a, dur);   // the manager's wind-up hook
 *   game.onUpdate((dt) => warn.update(dt, camera, player.position, player.yaw, animals.isThreat));
 *   warn.dispose();                                        // the shard's world torn down
 *
 * The edge spot is the attacker's bearing from where you face (ahead = the top edge, behind = the bottom, like
 * HurtArc), so one straight behind you is not mirrored by the projection; the on-screen test is the camera's own.
 */

const SLOTS = 4;
/** the most a mark stays up (s): a charge runs ≤ 4 s after its wind-up */
const MAX_T = 5;
/** px from the layer's edge (the screen less the safe areas) to the mark's centre */
const EDGE = 30;
/** NDC inside which the attacker counts as seen (a little in from the edge: half a body in view still warns) */
const SEEN = 0.9;

export interface Warned { readonly position: THREE.Vector3 }
interface Slot<T> { el: HTMLElement; who: T | null; t: number; dur: number; shown: boolean; tf: string }

const _p = new THREE.Vector3();

/** an amber chevron on the screen edge toward an off-screen enemy that is winding up an attack */
export class WindupWarn<T extends Warned = Warned> {
  readonly scope: ReturnType<typeof uiScope> = uiScope('windup');
  private readonly layer: HTMLElement;
  private readonly slots: Slot<T>[] = [];
  /** the layer's size (px): the screen less the safe areas (combat.css), kept by a ResizeObserver */
  private w = innerWidth; private h = innerHeight;
  private readonly resize: ResizeObserver;

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'ws-combat-warn';
    for (let i = 0; i < SLOTS; i++) {
      const el = document.createElement('i');
      el.className = 'ws-combat-warn-mark';
      this.layer.append(el);
      this.slots.push({ el, who: null, t: 0, dur: 0.6, shown: false, tf: '' });
    }
    const hud = document.getElementById('hud');
    mountUi(this.layer, this.scope, hud ?? document.body, hud?.firstChild);
    const layer = this.layer;
    const measure = (): void => { this.w = layer.clientWidth || innerWidth; this.h = layer.clientHeight || innerHeight; };
    this.resize = new ResizeObserver(measure);
    this.resize.observe(layer);
    this.scope.onDispose(() => { this.dispose(); });
    measure();
  }

  /** the shard's world is torn down (main.ts, the shard host's dispose): the observer off, the layer out of `#hud` */
  dispose(): void {
    this.resize.disconnect();
    for (const s of this.slots) s.who = null;
    this.layer.remove();
  }

  /** an attack's wind-up began (`dur` s of wind-up): track it until `live` says it is over */
  start(who: T, dur: number): void {
    let s = this.slots.find((k) => k.who === who) ?? this.slots.find((k) => k.who === null);
    if (s === undefined) for (const k of this.slots) if (s === undefined || k.t > s.t) s = k; // recycle the oldest
    if (s === undefined) return;
    s.who = who; s.t = 0; s.dur = Math.max(0.2, dur);
  }

  /** every frame: hide the marks whose attack is over, place the rest on the edge toward their attacker */
  update(dt: number, camera: THREE.Camera, player: { x: number; z: number }, yaw: number, live: (who: T) => boolean): void {
    const w = this.w, h = this.h;
    for (const s of this.slots) {
      const who = s.who;
      if (who === null) continue;
      s.t += dt;
      if (s.t > MAX_T || !live(who)) { s.who = null; this.hide(s); continue; }
      // in view (in front and inside the frame): the wind-up itself is the telegraph, no mark
      const v = project(who.position, camera);
      if (v.z < 1 && Math.abs(v.x) < SEEN && Math.abs(v.y) < SEEN) { this.hide(s); continue; }
      // the bearing from where you face: 0 = ahead (top edge), +π/2 = right, π = behind (bottom edge) — HurtArc.aim
      const dx = who.position.x - player.x, dz = who.position.z - player.z;
      const fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw), right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const ang = Math.atan2(right, fwd);
      const ux = Math.sin(ang), uy = -Math.cos(ang); // screen space: x right, y down
      const k = Math.min((w / 2 - EDGE) / Math.max(1e-3, Math.abs(ux)), (h / 2 - EDGE) / Math.max(1e-3, Math.abs(uy)));
      const x = w / 2 + ux * k, y = h / 2 + uy * k;
      // grows through the wind-up (0.8 → 1.15), then holds while the charge runs
      const grow = 0.8 + 0.35 * Math.min(1, s.t / s.dur);
      const tf = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0) rotate(${(ang - Math.PI / 2).toFixed(2)}rad) scale(${grow.toFixed(2)})`;
      if (tf !== s.tf) { s.tf = tf; s.el.style.transform = tf; }
      s.el.style.opacity = (0.84 + 0.16 * Math.sin(s.t * 17)).toFixed(2); // a quick pulse, written with the frame (no CSS loop, E142)
      if (!s.shown) { s.shown = true; s.el.classList.add('show'); }
    }
  }

  /** the dev harness / capture scripts: how many marks are up */
  get showing(): number { let n = 0; for (const s of this.slots) if (s.shown) n++; return n; }

  private hide(s: Slot<T>): void { if (s.shown) { s.shown = false; s.el.classList.remove('show'); } }
}

/** `p` (0.6 m up: the body, not the feet) projected by `camera` into NDC — x, y in −1..1 on screen, z > 1 behind */
function project(p: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
  return _p.set(p.x, p.y + 0.6, p.z).project(camera);
}
