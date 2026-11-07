/**
 * The view half of the named elites (src/client/game/Elite.ts): the bar over its head or pinned top-centre, the banner, the stings,
 * the skulls, the first-kill orb and the ground tells. It answers `EliteCore`'s moments and draws the focus each update
 * returns, and decides nothing. Nothing here imports the rules' side.
 */
import * as THREE from 'three';
import { fxMaterial, annulus, FX, type FxMaterial } from '@wildshard/engine/fx/groundFx';
import { WeaponPickup } from '@wildshard/engine/player/WeaponPickup';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Audio } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { HUD } from '@wildshard/engine/ui/HUD';
import type { EliteBar } from '@wildshard/engine/ui/EliteBar';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { EliteEnteredPresentation } from '@wildshard/format/eliteFeature';
import type { EliteHost, EliteScript } from './Elite';
import type { EncounterReward } from '@wildshard/engine/sim/encounterRows';
import { ITEM_PICKUP_HOVER } from '@wildshard/engine/world/interact/pickup';
import type { EliteCoreEntry, EliteCoreHooks, EliteCoreRecord } from '../../shared/game/eliteSystem';

/** Concrete entered owners; no author callbacks or service-name resolution. */
export interface EliteEnteredOwners {
  readonly scope: Scope; readonly interactables: Interactable[];
  readonly hud: HUD; readonly audio: Audio; readonly music: Music;
}
/** What the entered encounter lends the view. */
export interface EliteViewEntered { readonly owners: EliteEnteredOwners; readonly rows: EliteEnteredPresentation }
type PresentationCallbacks = 'addInteractable' | 'removeInteractable' | 'toast' | 'sting' | 'pickupHum';
type ViewHost = Omit<EliteHost, PresentationCallbacks | 'condition' | 'player'> & Partial<Pick<EliteHost, PresentationCallbacks>> & { readonly player: { readonly position: THREE.Vector3 } };
type Entry = EliteCoreEntry<EliteScript>;

const SIGHT_EVERY = 0.2;
const _h = new THREE.Vector3();

/** The bar, banner, orbs and skulls over `EliteCore`'s moments. */
export class EliteView {
  /** the lairs' first-kill orbs while they float */
  private readonly drops = new Map<Entry, WeaponPickup>();
  /** the elite whose bar is up (nearest aware / engaged) */
  focus: Entry | null = null;
  /** the focus's head in line of sight (re-cast every SIGHT_EVERY s while its bar floats over its head) */
  private seen = true; private sightT = 0;
  /** What the rules call at their moments. */
  readonly hooks: EliteCoreHooks<EliteScript> = {
      spawned: (e) => { this.drops.delete(e); },
      broken: (e, entering) => {
        if (entering) { this.focus = e; this.bar.show(e.script.def.name, e.script.def.epithet); this.bar.caption('BROKEN'); }
        const a = e.script.animal; if (a === null) return;
        a.headWorld(_h); _h.y += 0.55 * a.scale;
        this.bar.set(0, 'pinned', _h, this.host.camera, false, true);
      },
      banner: (e) => { this.bar.banner(e.script.def.name, e.script.def.epithet); this.sting(e, 'banner'); },
      phase2: (e) => { if (this.focus === e) this.bar.caption(e.script.def.phase2); this.sting(e, 'phase2'); },
      signature: (e) => { if (this.focus === e) this.bar.caption(e.script.def.signature); },
      fell: (e, firstSkin) => {
        const a = e.script.animal;
        this.sting(e, 'kill');
        if (firstSkin && a && e.script.def.drop.skin !== null) this.dropSkin(e, a.position);
        if (this.focus === e) { this.bar.set(0, 'pinned', null, this.host.camera, false); this.focus = null; this.scope.timeout(1600, () => { if (this.focus === null) this.bar.hide(); }); }
      },
      // Argymaq: no skin, the horse is the prize
      won: (e, firstSkin) => { const skin = e.script.def.drop.skin; if (firstSkin && skin !== null) this.host.ownSkin?.(skin); },
      retired: (e) => { if (this.focus === e) { this.focus = null; this.bar.hide(); } },
    };
  constructor(private readonly host: ViewHost, private readonly bar: EliteBar, private readonly scope: Scope, private readonly entered: () => EliteViewEntered | null,
    private readonly record: (id: string) => EliteCoreRecord | undefined, private readonly save: () => void) {}

  sting(entry: Entry, event: 'banner' | 'phase2' | 'kill'): void {
    const entered = this.entered();
    if (entered === null) { this.host.sting?.(event); return; }
    if (entered.owners.scope.disposed) return;
    const row = entered.rows[entry.script.def.id];
    if (row === undefined) throw new Error('Missing entered elite presentation');
    if (event === 'kill') entered.owners.music.sting(row.sting.kill);
    else entered.owners.music.combat(row.sting[event]);
  }

  /** Draw this frame's focus (`EliteCore.update`'s answer) and every lair's skull. */
  update(dt: number, t: number, best: Entry | null, entries: readonly Entry[]): void {
    const p = this.host.player.position;
    // ── the bar: the nearest aware / engaged elite ──
    if (best !== this.focus) {
      this.focus = best; this.sightT = 0;
      if (best) this.bar.show(best.script.def.name, best.script.def.epithet); else this.bar.hide();
    }
    if (this.focus) {
      const e = this.focus, a = e.script.animal;
      if (a) {
        a.headWorld(_h); _h.y += 0.55 * a.scale;
        const pinned = e.state === 'engaged';
        // the floating name is world-anchored: behind a wall it hides (a pinned bar is the fight's and stays)
        if (pinned || !this.host.canSee) { this.seen = true; this.sightT = 0; }
        else if ((this.sightT -= dt) <= 0) { this.sightT = SIGHT_EVERY; this.seen = this.host.canSee(this.host.camera.position, _h); }
        this.bar.set(e.script.barFrac?.() ?? a.hp / a.maxHp, pinned ? 'pinned' : 'head', _h, this.host.camera, e.beatT > 0, false, !this.seen);
      }
    }
    this.bar.skulls(entries.map((e) => ({
      x: e.script.def.lair.x, z: e.script.def.lair.z, shown: e.discovered && e.state !== 'retired',
      dead: e.state === 'dead', engaged: e.state === 'engaged', countdown: e.state === 'dead' ? e.timer / (e.script.def.respawnMin * 60) : 0,
    })), p);
    this.tendDrops(dt, t);
    this.bar.update(dt);
  }

  /** A first kill's orb where the server's row says it lies. Taking it is a press, and the row says whether it worked. */
  showRowDrop(e: Entry, at: EncounterReward, press: () => void): void { this.dropSkin(e, new THREE.Vector3(at.x, at.y - ITEM_PICKUP_HOVER, at.z), press); }
  /** The row ended. On this player's press the skin is theirs: what's in hand is the page's to change. */
  hideRowDrop(e: Entry, taken: boolean): void {
    const { drop: { skin } } = e.script.def, drop = this.drops.get(e);
    if (taken && skin !== null) this.host.ownSkin?.(skin);
    if (drop === undefined || drop.taken) return; // a taken orb finishes its burst
    this.forget(e, drop); drop.dispose(); this.drops.delete(e);
  }
  /** Rows draw this page's orbs: nothing else runs them. */
  tendDrops(dt: number, t: number): void { for (const [e, drop] of this.drops) { drop.update(dt, t, this.host.renderer, this.host.camera); if (drop.group.parent === null) this.drops.delete(e); } }
  /** An orb's prompt and hum go. */
  private forget(e: Entry, drop: WeaponPickup): void {
    const entered = this.entered(), row = entered?.rows[e.script.def.id];
    if (entered === null) { this.host.removeInteractable?.(drop.interactable); this.host.pickupHum?.(false); return; }
    const index = entered.owners.interactables.indexOf(drop.interactable);
    if (index !== -1) entered.owners.interactables.splice(index, 1);
    if (row?.hum === true) entered.owners.audio.pickupHum(false);
  }

  private dropSkin(e: Entry, at: THREE.Vector3, press?: () => void): void {
    const def = e.script.def, skin = def.drop.skin;
    if (skin === null) return;
    const entered = this.entered(), row = entered?.rows[def.id];
    if (entered?.owners.scope.disposed === true) return;
    if (entered === null && (this.host.addInteractable === undefined || this.host.removeInteractable === undefined || this.host.toast === undefined)) throw new Error('Elite pickup requires its entered presentation');
    const drop = new WeaponPickup({ scene: this.host.scene, item: e.script.dropModel(), position: press === undefined ? new THREE.Vector3(at.x, heightAt(at.x, at.z), at.z) : at, tier: 'rare', prompt: row?.prompt ?? `Take the ${def.drop.skinName} ${def.drop.weapon} skin`, scale: 1.4 });
    this.drops.set(e, drop);
    if (entered === null) this.host.addInteractable?.(drop.interactable);
    else entered.owners.interactables.push(drop.interactable);
    drop.onNear = (inside) => {
      if (entered === null) this.host.pickupHum?.(inside);
      else if (!entered.owners.scope.disposed && row?.hum === true) entered.owners.audio.pickupHum(inside);
    };
    drop.onPickup = () => {
      if (entered?.owners.scope.disposed === true) return;
      if (press === undefined) {
        const s = this.record(def.id);
        if (s) s.skinTaken = true;
        this.save();
        this.host.ownSkin?.(skin);
      } else press();
      this.forget(e, drop);
      if (entered === null) this.host.toast?.(`${def.drop.skinName} ${def.drop.weapon} skin — ${def.drop.blurb}`);
      else if (row !== undefined) entered.owners.hud.toast(row.toast);
    };
  }
}

/**
 * GroundTell — a terrain-draped telegraph decal (a ring at your feet, a lane across the grass), drawn over the grass
 * (depth test off: a tell must never hide) with the shared FX program. `ring(x, z, r, alpha)` / `lane(x0, z0, x1, z1,
 * width, alpha)` re-drape it (≤ 130 heightAt calls — only when it moves); `hide()`.
 */
/** Wedge-specific shader parameters are authored by the caller; geometry/draping is shared. */
interface GroundTellWedgeStyle {
  cone: number;
  material: THREE.Material;
  /** the fill (0 at the feet .. 1 at the tip) and opacity the material reads: a uniform, or a port onto a look's params */
  fill: { value: number };
  alpha: { value: number };
}

type OptionalWedgeStyle = GroundTellWedgeStyle | undefined;

export class GroundTell {
  readonly mesh: THREE.Mesh;
  private readonly mat: FxMaterial | null;
  private readonly base: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  constructor(scene: THREE.Scene, kind: 'ring' | 'lane' | 'wedge', color: THREE.ColorRepresentation, private readonly wedgeStyle?: OptionalWedgeStyle) {
    let g: THREE.BufferGeometry;
    if (kind === 'ring') g = annulus(0.86, 1, 64);
    else if (kind === 'wedge') {
      if (wedgeStyle === undefined) throw new Error('GroundTell wedge needs a shader profile');
      const R = 7, N = 14, uv: number[] = [], idx: number[] = [];
      for (let r = 0; r <= R; r++) for (let n = 0; n <= N; n++) uv.push(n / N, r / R);
      for (let r = 0; r < R; r++) for (let n = 0; n < N; n++) { const a = r * (N + 1) + n, b = a + N + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    } else {
      // a unit lane: x across (−0.5..0.5), z along (0..1); uv.x along, uv.y across (the ring look: a bright band)
      const seg = 24, P: number[] = [], U: number[] = [], N: number[] = [], I: number[] = [];
      for (let i = 0; i <= seg; i++) { const z = i / seg; P.push(-0.5, 0, z, 0.5, 0, z); U.push(z, 0, z, 1); N.push(0, 1, 0, 0, 1, 0); if (i < seg) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    }
    this.pos = g.getAttribute('position') as THREE.BufferAttribute;
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.base = new Float32Array(this.pos.array);
    if (kind === 'wedge' && wedgeStyle !== undefined) {
      this.mat = null;
      const R = 7, N = 14;
      for (let r = 0; r <= R; r++) for (let n = 0; n <= N; n++) {
        const a = (n / N - 0.5) * 2 * wedgeStyle.cone, rr = r / R, i = r * (N + 1) + n;
        // Retain the legacy two-component Float32 rounding before reach/yaw application.
        this.base[i * 3] = Math.sin(a) * rr; this.base[i * 3 + 2] = Math.cos(a) * rr;
      }
      this.mesh = new THREE.Mesh(g, wedgeStyle.material);
      this.mesh.renderOrder = 9; this.mesh.name = 'tell-wedge';
    } else {
      this.mat = fxMaterial(FX.ring, color, 0);
      this.mat.uniforms.uP.value.x = kind === 'ring' ? 0.8 : 0.6;
      this.mat.depthTest = kind !== 'ring';
      this.mesh = new THREE.Mesh(g, this.mat);
      this.mesh.renderOrder = 30;
    }
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  setTime(t: number): void { if (this.mat !== null) this.mat.uniforms.uTime.value = t; }
  hide(): void { this.mesh.visible = false; }
  ring(x: number, z: number, r: number, alpha: number, lift = 0.35): void {
    const b = this.base, P = this.pos;
    for (let i = 0; i < P.count; i++) { const lx = (b[i * 3] ?? 0) * r, lz = (b[i * 3 + 2] ?? 0) * r; P.setXYZ(i, x + lx, heightAt(x + lx, z + lz) + lift, z + lz); }
    P.needsUpdate = true; this.show(alpha);
  }
  lane(x0: number, z0: number, x1: number, z1: number, width: number, alpha: number, lift = 0.35): void {
    const b = this.base, P = this.pos, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1, ax = -dz / L, az = dx / L;
    for (let i = 0; i < P.count; i++) {
      const across = (b[i * 3] ?? 0) * width, along = b[i * 3 + 2] ?? 0;
      const x = x0 + dx * along + ax * across, z = z0 + dz * along + az * across;
      P.setXYZ(i, x, heightAt(x, z) + lift, z);
    }
    P.needsUpdate = true; this.show(alpha);
  }
  /** Animal yaw convention: forward = (sin, cos); fill runs from the feet toward the tip. */
  wedge(x: number, z: number, yaw: number, reach: number, fill: number, alpha: number, lift = 0.06): void {
    const profile = this.wedgeStyle;
    if (profile === undefined) throw new Error('GroundTell is not a wedge');
    const c = Math.cos(yaw), s = Math.sin(yaw), p = this.pos.array;
    for (let i = 0; i < this.pos.count; i++) {
      const lx = (this.base[i * 3] ?? 0) * reach, lz = (this.base[i * 3 + 2] ?? 0) * reach;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      p[i * 3] = wx; p[i * 3 + 1] = heightAt(wx, wz) + lift; p[i * 3 + 2] = wz;
    }
    this.pos.needsUpdate = true; profile.fill.value = fill; profile.alpha.value = alpha; this.mesh.visible = true;
  }
  private show(alpha: number): void { if (this.mat !== null) this.mat.uniforms.uAlpha.value = alpha; this.mesh.visible = alpha > 0.01; }
}
