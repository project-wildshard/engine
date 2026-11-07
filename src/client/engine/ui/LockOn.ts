import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
/**
 * LockOn — the target frame over enemies (mockups: art/hud/round-7-sword-touch/B-lunge.jpg, art/combat/round-1-lockon/N.jpg):
 *
 *   - the sword's lunge target (`meleeLock.target`, Sword.ts — in range and inside the lunge cone): four cyan corner
 *     brackets, brightened while the lunge dash runs (`.lunging`);
 *   - the Zelda lock-on (E50, `lockOn` — src/client/engine/player/LockOnTarget.ts): LOCKED → the brackets stay on the locked enemy, with a
 *     solid ▼ over it (`.locked`); AVAILABLE → a hollow ▽ over the enemy LOCK would take (`.ws-game-lockcand`); while locked,
 *     an edge chevron ‹ / › with the distance ("4 M") at the screen edge, level with the next target a flick would switch to
 *     (`.ws-game-lockedge`), which flashes when a flick on that side finds nothing (`flashMiss`). The name + health tag rides
 *     the locked enemy (src/client/engine/ui/Combat.ts pins its bar).
 *
 *   const lockOn = new LockOn(game.camera);   // mounts into #hud
 *   lockOn.update();                          // once per frame, after the camera is posed
 *
 * The frame is sized from the enemy's body (dims × scale) projected at its distance, so it tightens as you close in. Hidden
 * when nothing is framed or the target is behind the camera. Every write is skipped when nothing changed.
 */
import * as THREE from 'three';
import { lockOn, meleeLock, type AimTarget } from '../player/AimTargets';
import { targetRadius } from '../../../shared/engine/combat/lungeTarget';
import { aimPoint, type FlickDir } from '../player/LockOnTarget';
import { viewportHeight } from '../core/viewport';

const _c = new THREE.Vector3(), _e = new THREE.Vector3(), _right = new THREE.Vector3(), _top = new THREE.Vector3();

export class LockOn {
  readonly scope: ReturnType<typeof uiScope> = uiScope('LockOn');
  private readonly el: HTMLElement;
  private readonly cand: HTMLElement;
  private readonly edges: { l: HTMLElement; r: HTMLElement };
  private shown = false; private lunging = false; private locked = false; private candShown = false;
  private x = -1; private y = -1; private w = -1; private h = -1;
  private edgeText = { l: '', r: '' }; private edgeY = { l: -1, r: -1 }; private edgeShown = { l: false, r: false };

  private camera: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.el = document.createElement('div');
    this.el.className = 'ws-game-lock';
    this.el.innerHTML = engineString('s_5b2adc2f66ea');
    this.cand = document.createElement('div');
    this.cand.className = 'ws-game-lockcand';
    const edge = (side: 'l' | 'r') => { const e = document.createElement('div'); e.className = `ws-game-lockedge ${side}`; e.innerHTML = engineString('s_8779ab060e33', [side === 'l' ? engineString('s_0685a836e461') : engineString('s_7bb37df5cb36')]); return e; };
    this.edges = { l: edge('l'), r: edge('r') };
    for (const el of [this.el, this.cand, this.edges.l, this.edges.r]) mountUi(el, this.scope);
  }

  update(): void {
    const locked = lockOn.state === 'locked' && lockOn.target !== null;
    const t = locked ? lockOn.target : meleeLock.target;
    let show = t !== null;
    if (t !== null && !this.frame(t)) show = false;
    if (show !== this.shown) { this.shown = show; this.el.classList.toggle('show', show); }
    if (locked !== this.locked) { this.locked = locked; this.el.classList.toggle('locked', locked); }
    const lunging = show && meleeLock.lunging;
    if (lunging !== this.lunging) { this.lunging = lunging; this.el.classList.toggle('lunging', lunging); }

    // AVAILABLE: the hollow ▽ over what LOCK would take
    const c = lockOn.state === 'available' ? lockOn.candidate : null;
    let candShow = false;
    if (c !== null) {
      const p = this.screen(this.above(c, _top));
      if (p !== null) { candShow = true; this.cand.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`; }
    }
    if (candShow !== this.candShown) { this.candShown = candShow; this.cand.classList.toggle('show', candShow); }

    // LOCKED: the edge chevrons to the next target each side
    this.edge('l', locked ? lockOn.left : null, lockOn.leftDist);
    this.edge('r', locked ? lockOn.right : null, lockOn.rightDist);
  }

  /** a flick on that side found nothing: flash its chevron (or the empty edge) once */
  flashMiss(dir: FlickDir): void {
    const e = dir === 'left' ? this.edges.l : dir === 'right' ? this.edges.r : null;
    if (e === null) return;
    e.classList.remove('miss'); void e.offsetWidth; e.classList.add('miss');
  }

  private edge(side: 'l' | 'r', t: AimTarget | null, dist: number): void {
    const e = this.edges[side];
    let show = false;
    if (t !== null) {
      aimPoint(t, _c).project(this.camera);
      const vh = viewportHeight();
      const y = Math.round(Math.max(90, Math.min(vh * 0.7, (1 - _c.y) / 2 * vh)) / 4) * 4;
      if (y !== this.edgeY[side]) { this.edgeY[side] = y; e.style.top = `${y}px`; }
      const text = `${Math.max(1, Math.round(dist))} M`;
      if (text !== this.edgeText[side]) { this.edgeText[side] = text; const s = e.querySelector('span'); if (s) s.textContent = text; }
      show = true;
    }
    if (show !== this.edgeShown[side]) { this.edgeShown[side] = show; e.classList.toggle('show', show); }
  }

  /** a point just over the enemy's back / head */
  private above(t: AimTarget, out: THREE.Vector3): THREE.Vector3 {
    const s = t.scale ?? 1;
    out.copy(t.position); out.y += ((t.dims?.bodyY ?? 0.5) + 0.35) * s + 0.25;
    return out;
  }

  private screen(v: THREE.Vector3): { x: number; y: number } | null {
    v.project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * viewportHeight() };
  }

  /** place the brackets round `t`; false when it is behind the camera */
  private frame(t: AimTarget): boolean {
    const s = t.scale ?? 1;
    _c.copy(t.position); _c.y += (t.dims?.bodyY ?? 0.5) * s;
    _right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    _e.copy(_c).addScaledVector(_right, Math.max(targetRadius(t), (t.dims?.bodyHalfLen ?? 0) * s) * 1.3).project(this.camera); // half-length: a boar side-on fits
    _c.project(this.camera);
    if (_c.z > 1 || _c.z < -1) return false;
    const vw = innerWidth, vh = viewportHeight();
    const x = (_c.x + 1) / 2 * vw, y = (1 - _c.y) / 2 * vh;
    const half = Math.max(22, Math.min(vw * 0.4, Math.abs(_e.x - _c.x) / 2 * vw));
    this.place(Math.round(x), Math.round(y), Math.round(half * 2), Math.round(half * 1.6));
    return true;
  }

  private place(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return;
    this.x = x; this.y = y; this.w = w; this.h = h;
    const st = this.el.style;
    st.transform = `translate(${x - w / 2}px, ${y - h / 2}px)`;
    st.width = `${w}px`; st.height = `${h}px`;
  }
}
