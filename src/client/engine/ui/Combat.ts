import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import * as THREE from 'three';
import { app } from '../app/runtime';
import type { Game } from '../core/Game';
import type { RowBodiesView } from '../entities/RowBodies';
import type { Animal } from '../entities/AnimalView';
import type { Weapon } from '../../../shared/engine/combat/Weapon';
import { TIER } from '../core/tier';
import { viewportHeight } from '../core/viewport';
import { lockOn } from '../player/AimTargets';
import './styles/combat.css';

/**
 * Combat — MMO-style hunting feedback drawn over the game (DOM in `#hud`, styled by `src/client/engine/ui/styles/combat.css`,
 * prefix `ws-combat-`):
 *
 *   • HEALTH BARS anchored above animals (head position projected every frame): shown for any animal within
 *     BAR_DIST m that has been hit in the last BAR_HOLD ms OR is under the crosshair. Dark glass, cyan fill that turns
 *     amber then red as it drains, the kind as a tiny mono label. Pooled elements, at most BAR_MAX live (6 on phones).
 *   • FLOATING TEXT at the impact point on every hit: the damage number ("34"), bigger and yellow-white with
 *     "HEADSHOT" for a head hit, red "KILL" when it died. And "MISS" in grey when a shot the game judged to be
 *     AIMED at an animal (any animal within AIM_TOL m of the aim ray at the moment of firing) lands in a tree or
 *     the dirt first, or flies past it (a deadline from the target's distance and the bolt speed).
 *     Text rises FLOAT_RISE px and fades over FLOAT_LIFE s; pooled.
 *   • A missed bolt landing near animals disturbs them (animals.disturb) — the AI's "a bolt just thudded in next
 *     to me" trigger lives here because this module owns the crossbow impact hook.
 *
 * Self-wiring: `new Combat(game, animals, weapon, camera)` registers its own game.onUpdate (register it AFTER the
 * weapon/animals updaters so it reads this frame's positions) and taps `weapon.onFire` / `weapon.onImpact` and
 * `animals.onDamage` without clobbering callbacks assigned before OR after (the taps are property accessors).
 * The crosshair hit-marker stays with hud.showHitMarker (weapon.onHit) — nothing here duplicates it.
 * `weapon` is any `Weapon` (src/engine/player/Weapon.ts): crossbow or sword — or the `Weapons` kit manager, whose `reach` is
 * the HELD weapon's. A melee weapon's `reach` (read at every fire, so a swap is honoured) caps the MISS judgement — a
 * swing at a boar 30 m off is not a miss, it is out of range.
 */

const bossAim = { kind: '', distance: 0 };
/** the HUD's aim readout for `info`: a boss by its name, anything else as it is */
export function aimReadout(info: { kind: string; distance: number } | null): { kind: string; distance: number } | null {
  const name = info ? app.encounters.get(info.kind)?.displayName : undefined;
  if (!info || name === undefined) return info;
  bossAim.kind = name; bossAim.distance = info.distance;
  return bossAim;
}
const BAR_DIST = 60;                       // m: bars only this close
const BAR_HOLD = 4000;                     // ms: a bar stays up this long after the last hit
const BAR_MAX = TIER === 'phone' ? 6 : 12;  // pooled bar elements
const AIM_TOL = 1.2;                       // m: "aimed at it" — animal passes within this of the aim ray
const AIM_RANGE = 120;
const FLOAT_MAX = 10;
const FLOAT_LIFE = 0.9;                    // s
const FLOAT_RISE = 40;                     // px
const FLOAT_LIFT = 34;                     // px: floats start this far above the projected point, clear of the health bar
const PENDING_MAX = 4;                     // shots in the air we track for MISS
const BOLT_SPEED_EST = 50;                 // m/s: bolt speed after drag, for the "it has flown past the target" deadline
const PENDING_GRACE = 0.25;                // s: past that deadline with no hit → MISS over the target
const MELEE_DEADLINE = 0.75;               // s: a swing's blade reaches its targets through the whole active window (+ hit-stop), not at once

interface BarSlot { el: HTMLElement; fill: HTMLElement; kind: HTMLElement; animal: Animal | null; lastHp: number; shown: boolean; }
interface FloatSlot { el: HTMLElement; num: HTMLElement; label: HTMLElement; x: number; y: number; t: number; active: boolean; }
interface Pending { animal: Animal | null; t: number; deadline: number; active: boolean }

const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

/** Wrap `obj[key]` (an optional callback field) so `hook` always runs before whatever the owner assigns, before or after this call. */
function tap<T extends object>(obj: T, key: keyof T, hook: (...args: unknown[]) => void): void {
  let user = obj[key] as unknown as ((...a: unknown[]) => void) | undefined;
  const combined = (...args: unknown[]): void => { hook(...args); user?.(...args); };
  Object.defineProperty(obj, key, { configurable: true, enumerable: true, get: () => combined, set: (f: ((...a: unknown[]) => void) | undefined) => { user = f; } });
}

export class Combat {
  readonly scope: ReturnType<typeof uiScope> = uiScope('Combat');
  /** the animal under the crosshair this frame (within AIM_TOL of the aim ray), or null */
  aimed: Animal | null = null;
  private layer: HTMLElement;
  private bars: BarSlot[] = [];
  private floats: FloatSlot[] = [];
  private pending: Pending[] = [];
  private w = 1; private h = 1;
  private candidates: Animal[] = [];
  private candDist: number[] = [];
  private t = 0;

  /** read at every fire, not once: the kit swaps between the sword (reach 2.2 m) and ranged weapons (no reach) mid-play */
  private weapon: { readonly reach?: number | undefined };

  private animals: RowBodiesView;
  private camera: THREE.Camera;
  constructor(game: Game, animals: RowBodiesView, weapon: Pick<Weapon, 'onFire' | 'onImpact'> & { readonly reach?: number | undefined }, camera: THREE.Camera) {
    this.animals = animals;
    this.camera = camera;
    this.weapon = weapon;
    this.layer = document.createElement('div');
    this.layer.className = 'ws-combat-layer';
    const hud = document.getElementById('hud');
    mountUi(this.layer, this.scope, hud ?? document.body, hud?.firstChild);

    for (let i = 0; i < BAR_MAX; i++) {
      const el = document.createElement('div'); el.className = 'ws-combat-hp';
      const kind = document.createElement('span'); kind.className = 'ws-combat-hp-kind';
      const track = document.createElement('div'); track.className = 'ws-combat-hp-track';
      const fill = document.createElement('i'); fill.className = 'ws-combat-hp-fill';
      track.append(fill); el.append(kind, track); this.layer.append(el);
      this.bars.push({ el, fill, kind, animal: null, lastHp: -1, shown: false });
    }
    for (let i = 0; i < FLOAT_MAX; i++) {
      const el = document.createElement('div'); el.className = 'ws-combat-float';
      const num = document.createElement('b'); const label = document.createElement('i');
      el.append(num, label); this.layer.append(el);
      this.floats.push({ el, num, label, x: 0, y: 0, t: 0, active: false });
    }
    for (let i = 0; i < PENDING_MAX; i++) this.pending.push({ animal: null, t: 0, deadline: 0, active: false });

    const measure = (): void => { this.w = window.innerWidth; this.h = viewportHeight(); };
    measure(); this.scope.listen(window, 'resize', measure);

    tap(weapon, 'onFire', () => { this.fired(); });
    tap(weapon, 'onImpact', (surface, point) => { this.impact(surface as string, point as THREE.Vector3); });
    tap(animals, 'onDamage', (a, amount, point, headshot, died) => { this.damage(a as Animal, amount as number, point as THREE.Vector3, headshot as boolean, died as boolean); });
    game.onUpdate((dt, t) => { this.update(dt, t); }, 'hud.combat');
  }

  // ── events ──

  private fired(): void {
    // judged at the moment of firing: was an animal on (or nearly on) the aim ray?
    if (!this.aimed) return;
    _o.setFromMatrixPosition(this.camera.matrixWorld);
    const reach = this.weapon.reach ?? Infinity; // the HELD weapon's (Weapons.reach): undefined = ranged
    if (this.aimed.position.distanceTo(_o) > reach + 1) return; // melee: out of reach is not a miss
    let slot = this.pending.find((p) => !p.active);
    if (!slot) { for (const p of this.pending) if (!slot || p.t < slot.t) slot = p; } // recycle the oldest
    if (!slot) return;
    slot.animal = this.aimed; slot.t = this.t; slot.active = true;
    slot.deadline = this.t + (this.weapon.reach !== undefined ? MELEE_DEADLINE : this.aimed.position.distanceTo(_o) / BOLT_SPEED_EST + PENDING_GRACE);
  }

  private damage(a: Animal, amount: number, point: THREE.Vector3, headshot: boolean, died: boolean): void {
    // this bolt landed on flesh: it is no longer a candidate for MISS
    this.resolveOldest();
    if (!this.project(point)) { a.headWorld(_v); _v.y += 0.3; if (!this.project(_v)) return; }
    this.float(String(Math.round(amount)), died ? (headshot ? engineString('s_9ca42a3b84d2') : engineString('s_448dd87e3774')) : headshot ? engineString('s_a3de28c1f757') : '', headshot ? 'head' : '', died);
  }

  private impact(surface: string, point: THREE.Vector3): void {
    if (surface === 'flesh') return;
    const p = this.resolveOldest();
    if (!p) return;
    // MISS at the impact point if it is on screen, else over the animal we were aiming at
    if (!this.project(point) && (!p.animal || !this.projectAnimal(p.animal))) return;
    this.float(engineString('s_e0a896a85299'), '', 'miss', false);
  }

  /** pop the oldest pending aimed shot (the bolts fly in order) */
  private resolveOldest(): Pending | null {
    let best: Pending | null = null;
    for (const p of this.pending) if (p.active && (!best || p.t < best.t)) best = p;
    if (best) best.active = false;
    return best;
  }

  // ── per frame ──

  private update(dt: number, t: number): void {
    this.t = t;
    const cam = this.camera;
    // crosshair target: the animal nearest along the aim ray, within AIM_TOL m of it
    _o.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(_d);
    const aimed = this.animals.nearRay(_o, _d, AIM_RANGE, AIM_TOL);   // not the horse you sit on
    this.aimed = aimed?.mem['owned'] === 1 ? null : aimed;                                  // nor a camp horse / Tulpar

    // aimed shots that flew past the target without touching it → MISS over the target (don't wait for the bolt to land)
    for (const p of this.pending) {
      if (!p.active || t < p.deadline) continue;
      p.active = false;
      if (p.animal && p.animal.alive && this.projectAnimal(p.animal)) this.float(engineString('s_e0a896a85299'), '', 'miss', false);
    }

    this.updateBars();
    this.updateFloats(dt);
  }

  private updateBars(): void {
    const now = performance.now();
    const list = this.animals.animals;
    const cand = this.candidates, cd = this.candDist;
    let n = 0;
    _o.setFromMatrixPosition(this.camera.matrixWorld);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      // a boss / a named elite has its own wide bar (src/client/game/Boss.ts, src/client/game/Elite.ts); the horse you ride has none
      if (a === undefined || a.hidden || app.encounters.get(a.kind)?.showHeadBar === false || a.mem['noHeadBar'] === 1 || a === app.equipmentHost?.player.mountedOn) continue;
      const show = now - a.lastHitT < BAR_HOLD || a === this.aimed || (lockOn.state === 'locked' && a === lockOn.target); // the locked enemy keeps its tag (E50, N)
      if (!show) continue;
      const d2 = a.position.distanceToSquared(_o);
      if (d2 > BAR_DIST * BAR_DIST) continue;
      // keep the BAR_MAX nearest (insertion into a short sorted list; no allocations once warmed)
      let k = n < BAR_MAX ? n : -1;
      if (k < 0) { if (d2 >= (cd[BAR_MAX - 1] ?? Infinity)) continue; k = BAR_MAX - 1; } else n++;
      while (k > 0 && (cd[k - 1] ?? 0) > d2) { const pa = cand[k - 1]; if (pa === undefined) break; cand[k] = pa; cd[k] = cd[k - 1] ?? 0; k--; }
      cand[k] = a; cd[k] = d2;
    }
    // free slots whose animal dropped out, then give newcomers a free slot (stable assignment: no bar swapping)
    for (const s of this.bars) if (s.animal) { let keep = false; for (let i = 0; i < n; i++) if (cand[i] === s.animal) { keep = true; break; } if (!keep) { s.animal = null; s.lastHp = -1; } }
    for (let i = 0; i < n; i++) {
      const a = cand[i];
      if (a === undefined) continue;
      let have = false; for (const s of this.bars) if (s.animal === a) { have = true; break; }
      if (have) continue;
      const free = this.bars.find((s) => !s.animal);
      if (!free) break;
      free.animal = a; free.kind.textContent = a.label.toUpperCase(); free.lastHp = -1;
    }
    for (const s of this.bars) {
      const a = s.animal;
      let on = false;
      if (a) {
        a.headWorld(_v); _v.y += 0.32 * a.scale;
        if (this.project(_v)) {
          on = true;
          s.el.style.transform = `translate3d(${_v.x.toFixed(1)}px,${_v.y.toFixed(1)}px,0)`;
          if (a.hp !== s.lastHp) {
            s.lastHp = a.hp;
            const f = Math.max(0, a.hp / a.maxHp);
            s.fill.style.transform = `scaleX(${f.toFixed(3)})`;
            s.el.classList.toggle('low', f < 0.5 && f > 0.25); s.el.classList.toggle('crit', f <= 0.25); s.el.classList.toggle('dead', !a.alive);
          }
        }
      }
      if (on !== s.shown) { s.shown = on; s.el.classList.toggle('show', on); }
    }
  }

  /** spawn a floating text at the screen point the last successful project() left in _v */
  private float(text: string, label: string, cls: string, kill: boolean): void {
    let f = this.floats.find((s) => !s.active);
    if (!f) { for (const s of this.floats) if (!f || s.t > f.t) f = s; } // recycle the oldest
    if (!f) return;
    f.active = true; f.t = 0; f.x = _v.x; f.y = _v.y - FLOAT_LIFT;
    f.num.textContent = text; f.label.textContent = label;
    f.el.className = `ws-combat-float show${cls ? ` ${cls}` : ''}${kill ? ' kill' : ''}`;
    f.el.style.opacity = '1';
    f.el.style.transform = `translate3d(${f.x.toFixed(1)}px,${f.y.toFixed(1)}px,0) scale(1.15)`;
  }

  private updateFloats(dt: number): void {
    for (const f of this.floats) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / FLOAT_LIFE;
      if (k >= 1) { f.active = false; f.el.classList.remove('show'); continue; }
      const ease = 1 - (1 - k) * (1 - k);
      const pop = k < 0.12 ? 1.15 - (k / 0.12) * 0.15 : 1;
      f.el.style.transform = `translate3d(${f.x.toFixed(1)}px,${(f.y - FLOAT_RISE * ease).toFixed(1)}px,0) scale(${pop.toFixed(3)})`;
      f.el.style.opacity = k < 0.55 ? '1' : (1 - (k - 0.55) / 0.45).toFixed(3);
    }
  }

  // ── projection (writes screen px into _v.x/_v.y; false when behind the camera or off screen) ──

  private project(world: THREE.Vector3): boolean {
    _v.copy(world).project(this.camera);
    if (_v.z > 1 || _v.z < -1) return false;
    const x = (_v.x * 0.5 + 0.5) * this.w, y = (0.5 - _v.y * 0.5) * this.h;
    if (x < -40 || x > this.w + 40 || y < -40 || y > this.h + 40) return false;
    _v.x = x; _v.y = y;
    return true;
  }
  private projectAnimal(a: Animal): boolean {
    a.headWorld(_v); _v.y += 0.2;
    return this.project(_v);
  }
}
