import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import * as THREE from 'three';
import './styles/elite.css';
import { toastArea } from './ToastStack';

/**
 * EliteBar — the named-elite screen pieces (src/client/game/Elite.ts drives them), styled by `src/client/engine/ui/styles/elite.css` (prefix
 * `ws-elite-`; the boss bar's antique gold, lighter — elites live in the world, bosses own the screen). Mockups:
 * art/nalati-grasslands/round-2/4-named-elites/*.png.
 *
 *   const ui = new EliteBar();                               // mounts into #hud
 *   ui.show('Aqbars the Pale', 'Irbis of the Crags');  ui.hide();
 *   ui.set(frac, 'head' | 'pinned', headWorld, camera, shimmer, broken, occluded)   // every frame: OVER THE HEAD until the fight
 *                                                            // starts (clamped to the screen edge with an arrow when off it),
 *                                                            // then PINNED top-centre (the user's rule); 50 % tick; grey BROKEN;
 *                                                            // `occluded` (no line of sight): the floating name fades out
 *   ui.caption('POUNCE')                                     // the signature's name / ENRAGED / BROKEN under the bar
 *   ui.banner(name, epithet)                                 // "NAMED ELITE NEARBY" — slim glass, gold edges, ~4.5 s
 *   ui.chevron(worldPoint | null, camera)                    // a gold chevron at the screen edge toward a threat (Qyran's stoop)
 *   ui.skulls(list, playerPos)                               // gold / grey skulls over the minimap (its north-up ±110 m view)
 *   ui.update(dt)
 */

export interface SkullMark { x: number; z: number; shown: boolean; dead: boolean; engaged: boolean; countdown: number }

const SKULL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C7 2 3.5 5.6 3.5 10.2c0 2.6 1.1 4.6 2.9 5.9V19c0 .9.7 1.6 1.6 1.6h.9v-2.2h1.4v2.2h3.4v-2.2h1.4v2.2h.9c.9 0 1.6-.7 1.6-1.6v-2.9c1.8-1.3 2.9-3.3 2.9-5.9C20.5 5.6 17 2 12 2zm-3.6 11.6a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zm7.2 0a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM12 16.2l-1.2-2.1h2.4z"/></svg>`;
const MINI_R = 110;   // the minimap's view radius (m) — src/client/engine/ui/Minimap.ts VIEW_RADIUS

/** CSS `ease-in-out` (cubic-bezier(0.42, 0, 0.58, 1)) at x ∈ [0, 1] */
function easeInOut(x: number): number {
  // solve bx(t) = x by Newton, then by = y(t); both control points' x mirror, so t starts at x
  let t = x;
  for (let i = 0; i < 6; i++) {
    const bx = 3 * (1 - t) * (1 - t) * t * 0.42 + 3 * (1 - t) * t * t * 0.58 + t * t * t - x;
    const dx = 3 * (1 - t) * (1 - t) * 0.42 + 6 * (1 - t) * t * (0.58 - 0.42) + 3 * t * t * (1 - 0.58);
    if (Math.abs(bx) < 1e-5 || dx === 0) break;
    t = Math.min(1, Math.max(0, t - bx / dx));
  }
  return 3 * (1 - t) * t * t + t * t * t; // y control points 0 and 1
}
/** the engaged skull's glow at time `t` s: elite.css's former `ws-elite-pulse 0.6s ease-in-out infinite alternate`, from
 *  drop-shadow(0 0 4px rgba(255,170,60,.7)) to drop-shadow(0 0 14px rgba(255,200,90,1)) */
function skullPulse(t: number): string {
  const u = (t / 0.6) % 2, k = easeInOut(u < 1 ? u : 2 - u);
  return engineString('s_f38bbfcd335d', [(4 + 10 * k).toFixed(1), Math.round(170 + 30 * k), Math.round(60 + 30 * k), (0.7 + 0.3 * k).toFixed(2)]);
}
const _v = new THREE.Vector3();

export class EliteBar {
  readonly scope: ReturnType<typeof uiScope> = uiScope('EliteBar');
  readonly root: HTMLElement;
  private bar: HTMLElement; private name: HTMLElement; private epithet: HTMLElement; private fill: HTMLElement; private lag: HTMLElement;
  private cap: HTMLElement; private arrow: HTMLElement;
  private ban: HTMLElement; private banName: HTMLElement;
  private chev: HTMLElement;
  private skullLayer: HTMLElement | null = null; private skullEls: HTMLElement[] = [];
  private active = true;
  /** the skull layer's half-width, measured when it resizes, and what each skull was last written (E142 aggro-perf:
   *  skulls() ran every frame and read clientWidth after the frame's HUD writes — a forced layout per frame) */
  private skullR = -1; private skullLast: string[] = [];
  private frac = 1; private lagFrac = 1; private lagT = 0; private capT = 0; private banT = 0;
  private mode: 'head' | 'pinned' = 'head';

  constructor(parent: HTMLElement = document.getElementById('hud') ?? document.body) {
    const el = (tag: string, cls: string, html = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
    this.root = el('div', engineString('s_beb26b328669'));
    this.bar = el('div', engineString('s_e9c3ff48e734'));
    this.name = el('div', engineString('s_773f5023eb38')); this.epithet = el('div', engineString('s_615cabd12786'));
    const frame = el('div', engineString('s_ff51d38b2c32'));
    const track = el('div', engineString('s_11c4725bfcf1'));
    this.lag = el('div', engineString('s_d61ce14df1db')); this.fill = el('div', engineString('s_140a09bf0fc0'));
    track.append(this.lag, this.fill, el('i', engineString('s_299f841789a8')), el('div', engineString('s_7c362fc63ef4')));
    frame.append(el('span', engineString('s_02d5bb9a468b'), SKULL), track);
    this.cap = el('div', engineString('s_ed4694ff96c0'));
    this.arrow = el('i', engineString('s_1052929f5366'));
    this.bar.append(this.name, this.epithet, frame, this.cap, this.arrow);
    this.ban = el('div', engineString('s_31fdfcd8ef0a'));
    this.banName = el('div', engineString('s_78b3e3398890'));
    const banText = el('div', engineString('s_bfb25bd4f3f5'));
    banText.append(el('div', engineString('s_e25cdae4577d'), engineString('s_59729f06918a')), this.banName);
    this.ban.append(el('span', engineString('s_02d5bb9a468b'), SKULL), banText);
    this.chev = el('i', engineString('s_026ecaf4ec08'));
    this.root.append(this.bar, this.ban, this.chev);
    mountUi(this.root, this.scope, parent);
    const measure = (): void => {
      const w: unknown = Reflect.get(globalThis, 'innerWidth'), h: unknown = Reflect.get(globalThis, 'innerHeight');
      this.viewW = typeof w === 'number' ? w : 0; this.viewH = typeof h === 'number' ? h : 0;
    };
    measure(); if (typeof window !== 'undefined') this.scope.listen(window, 'resize', measure);
  }
  /** G639: the viewport, kept by resize (reading innerWidth after another bar's transform write forced a layout a bar a frame) */
  private viewW = 0; private viewH = 0;

  show(name: string, epithet: string): void {
    this.name.textContent = name; this.epithet.textContent = epithet;
    this.frac = this.lagFrac = 1; this.write();
    this.bar.classList.remove('broken'); this.flags.clear();
    this.bar.classList.add('show');
  }
  hide(): void { this.bar.classList.remove('show', 'pinned', 'offscreen', 'beat', 'broken', 'occluded', 'dim'); this.flags.clear(); this.mode = 'head'; }

  /** Park separately mounted minimap marks while their resident encounter is inactive. */
  setActive(on: boolean): void {
    this.active = on;
    if (this.skullLayer !== null) this.skullLayer.hidden = !on;
  }

  set(frac: number, mode: 'head' | 'pinned', head: THREE.Vector3 | null, camera: THREE.PerspectiveCamera, beat: boolean, broken = false, occluded = false): void {
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - this.frac) > 1e-4) { if (f < this.frac) this.lagT = 0.5; this.frac = f; if (f > this.lagFrac) this.lagFrac = f; this.write(); }
    if (mode !== this.mode) { this.mode = mode; this.bar.classList.toggle('pinned', mode === 'pinned'); if (mode === 'pinned') this.ban.classList.remove('show'); }
    this.flag('beat', beat);
    this.flag('broken', broken);
    // over its head but out of sight (a wall between): the world-anchored name fades out rather than show through it
    this.flag('occluded', occluded && mode === 'head');
    // (classList.remove writes the class attribute even when neither is there — toggle(…, false) does not)
    if (mode === 'pinned' || head === null) { this.barTf(''); this.flag('offscreen', false); this.flag('dim', false); return; }
    // over its head: project; off screen → clamp to the edge, the arrow points at it
    _v.copy(head).project(camera);
    const w = this.viewW, h = this.viewH;
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const m = 70, inside = !behind && x > m && x < w - m && y > m && y < h - m;
    let ang = 0;
    if (!inside) {
      const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy;
      const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (h / 2 - m) / Math.max(1e-3, Math.abs(dy)));
      x = cx + dx * Math.min(1, k); y = cy + dy * Math.min(1, k);
      if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) y = h - m;
      ang = Math.atan2(dy, dx);
    }
    this.flag('offscreen', !inside);
    // under the toast column (ToastStack): the world-anchored name steps back (the bar's box: 250 × ~64 above the point)
    const T = toastArea, hw = inside ? 125 : 85;
    this.flag('dim', T.bottom > T.top && x + hw > T.left && x - hw < T.right && y > T.top && y - 64 < T.bottom);
    const at = `rotate(${ang.toFixed(3)}rad)`;
    if (at !== this.arrowLast) { this.arrowLast = at; this.arrow.style.transform = at; }
    this.barTf(`translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`);
  }
  // E142 aggro-perf: set() runs every frame of a fight — only a changed transform is written (the pinned bar wrote '' a frame)
  private barLast = ''; private arrowLast = '';
  /** the per-frame classes as last written (G639: five DOM toggles a frame on every visible bar); show/hide forget them */
  private readonly flags = new Map<string, boolean>();
  private flag(name: string, on: boolean): void { if (this.flags.get(name) !== on) { this.flags.set(name, on); this.bar.classList.toggle(name, on); } }
  private barTf(tf: string): void { if (tf !== this.barLast) { this.barLast = tf; this.bar.style.transform = tf; } }
  private write(): void { this.fill.style.transform = `scaleX(${this.frac.toFixed(4)})`; this.lag.style.transform = `scaleX(${this.lagFrac.toFixed(4)})`; }

  caption(text: string, seconds = 2.6): void {
    this.cap.textContent = text; this.cap.classList.add('show'); this.capT = seconds;
  }
  banner(name: string, epithet: string): void {
    // name · epithet (layout D on the phone shows the name alone — elite.css hides the epithet span there)
    const n = document.createElement('span'), e = document.createElement('span');
    n.textContent = name.toUpperCase(); e.className = 'ws-elite-banner-epithet'; e.textContent = engineString('s_614cafefe4f0', [epithet.toUpperCase()]);
    this.banName.replaceChildren(n, e);
    // another elite's bar already pinned (two lairs close together): the banner drops below it instead of over it
    this.ban.classList.toggle('below', this.mode === 'pinned' && this.bar.classList.contains('show'));
    this.ban.classList.add('show'); this.banT = 4.5;
  }

  /** a gold chevron on the screen edge toward `world` (null hides it) */
  chevron(world: THREE.Vector3 | null, camera: THREE.PerspectiveCamera): void {
    if (world === null) { this.chev.classList.remove('show'); return; }
    _v.copy(world).project(camera);
    let dx = _v.x, dy = -_v.y;
    if (_v.z > 1) { dx = -dx; dy = -dy; }
    const onScreen = _v.z <= 1 && Math.abs(_v.x) < 0.85 && Math.abs(_v.y) < 0.85;
    if (onScreen) { this.chev.classList.remove('show'); return; }
    const w = this.viewW, h = this.viewH, m = 46;
    const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx * w / 2)), (h / 2 - m) / Math.max(1e-3, Math.abs(dy * h / 2)));
    const x = w / 2 + dx * w / 2 * k, y = h / 2 + dy * h / 2 * k;
    this.chev.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${Math.atan2(dy * h, dx * w).toFixed(3)}rad)`;
    this.chev.classList.add('show');
  }

  /** the lairs' skulls over the minimap (north up, −X east, ±110 m) — drawn into the minimap's own box */
  skulls(list: SkullMark[], player: THREE.Vector3): void {
    if (this.skullLayer === null) {
      const mini = document.querySelector('.ws-minimap');
      if (!(mini instanceof HTMLElement)) return;
      this.skullLayer = document.createElement('div'); this.skullLayer.className = 'ws-elite-skulls';
      if (!this.active) this.skullLayer.hidden = true;
      mountUi(this.skullLayer, this.scope, mini);
      const layer = this.skullLayer;
      const resize = new ResizeObserver(() => { this.skullR = layer.clientWidth / 2; }); resize.observe(layer);
      this.scope.onDispose(() => { resize.disconnect(); });
    }
    const layer = this.skullLayer;
    if (this.skullR < 0) return; // drawn from the observer's first size report: reading it here forced a page layout
    while (this.skullEls.length < list.length) { const e = document.createElement('i'); e.className = 'ws-elite-mapskull'; e.innerHTML = SKULL; layer.append(e); this.skullEls.push(e); }
    const r = this.skullR;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], e = this.skullEls[i];
      if (!s || !e) continue;
      const dx = -(s.x - player.x) / MINI_R * r, dy = -(s.z - player.z) / MINI_R * r;
      const on = s.shown && r > 0 && Math.hypot(dx, dy) < r - 9;
      e.classList.toggle('show', on);
      if (!on) continue;
      const tf = `translate(${(r + dx).toFixed(1)}px, ${(r + dy).toFixed(1)}px)`, cd = `${Math.round((1 - s.countdown) * 360)}deg`;
      e.classList.toggle('dead', s.dead); e.classList.toggle('engaged', s.engaged);
      // the engaged skull's pulse, written with the game's frame (elite.css had it as an infinite CSS filter animation:
      // on iOS that repainted the skull and re-composited the page at the display's rate, 60–120 Hz, over the canvas)
      const fl = s.engaged ? skullPulse(performance.now() / 1000) : '';
      if (this.skullLast[i * 3 + 2] !== fl) { this.skullLast[i * 3 + 2] = fl; e.style.filter = fl; }
      // only what changed is written (a still player's skulls write nothing)
      if (this.skullLast[i * 3] !== tf) { this.skullLast[i * 3] = tf; e.style.transform = tf; }
      if (this.skullLast[i * 3 + 1] !== cd) { this.skullLast[i * 3 + 1] = cd; e.style.setProperty('--cd', cd); }
    }
  }

  update(dt: number): void {
    if (this.lagT > 0) this.lagT -= dt;
    else if (this.lagFrac > this.frac) { this.lagFrac = Math.max(this.frac, this.lagFrac - dt * 0.4); this.lag.style.transform = `scaleX(${this.lagFrac.toFixed(4)})`; }
    if (this.capT > 0) { this.capT -= dt; if (this.capT <= 0) this.cap.classList.remove('show'); }
    if (this.banT > 0) { this.banT -= dt; if (this.banT <= 0) this.ban.classList.remove('show'); }
  }
}
