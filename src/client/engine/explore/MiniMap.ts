import { listenDom } from '../input/dom';
/**
 * MiniMap — the World Explorer's map (project/archive/2026-09-23-explore-world.md X5; E67 to the round-6 midway bar,
 * art/build-world/round-6-midway/05-world-map.jpg): a MAP button slides up a glass bottom sheet with the shard seen from
 * straight above — the real scene rendered once through the game's own post chain, not a painted map — a pin tag per
 * `ShardManifest.pois` entry, the camera's arrow + view cone, a north mark and a scale bar.
 * Tap a pin → the god-mode camera flies there (Explore.flyTo) and control comes straight back; tap anywhere else on
 * the map → fly over that spot; ⌂ SPAWN → back to the shard's spawn. Flying stays the way to get around — this is a
 * shortcut, not a mode.
 *
 *   const map = new MiniMap(explore, world);   map.toggle();   map.update();   // arrow follows the camera
 */
import * as THREE from 'three';
import type { World } from '../core/bootstrap';
import { app } from '../app/runtime';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import { heightAt, normalAt } from '../../../shared/engine/world/Heightfield';
import { fogUniforms } from '../world/Atmosphere';
import type { PoiSpec } from '../../../shared/engine/level/data';
import type { Explore } from './Explore';

const RES = 192; // the fallback relief's pixels (no composer yet / a lost context)
const EYE = 600; // metres: the top-down shot's camera height — the perspective is near enough orthographic, and the height fog's exp() stays finite (at 1.4 km it overflowed to NaN)
const CEILING = 120; // metres: nothing above this is in the shot (clouds, gulls)
const SCALE_M = 100; // the scale bar's length

const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };

export class MiniMap {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  readonly button: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly board: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly arrow: HTMLElement;
  private drawn = false;
  /** the clock's part of the day the shot was taken in (EXPLORE-V2 V3: re-shot when it moves on, not once a session) */
  private shotKey = '';
  private readonly pois: readonly PoiSpec[];
  /** the square the map shows: the land and every pin, not the whole chunk (an island in its sea fills the sheet) */
  private readonly view: { x: number; z: number; half: number };

  private readonly explore: Explore;
  private readonly world: World;
  private readonly overhead: readonly THREE.Object3D[];
  constructor(explore: Explore, world: World, overhead: readonly THREE.Object3D[] = []) {
    this.explore = explore;
    this.world = world;
    this.overhead = overhead;
    this.pois = world.game.level.pois ?? [];
    this.view = this.frame();
    this.button = html('button', 'ws-x-mapbtn', '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Map</span>');
    (this.button as HTMLButtonElement).type = 'button';
    const bar = (SCALE_M / (this.view.half * 2)) * 100;
    this.sheet = html('div', 'ws-x-map', `
      <i class="ws-x-map-grab"></i>
      <div class="ws-x-map-head">
        <div><b></b><small>World explorer · tap a place to fly there</small></div>
        <button type="button" class="ws-x-map-spawn"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7 M6 9.5V20h12V9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>Spawn</button>
        <button type="button" class="ws-x-map-close" aria-label="Close map">✕</button>
      </div>
      <div class="ws-x-map-board">
        <canvas width="${RES}" height="${RES}"></canvas>
        <i class="ws-x-map-me"><svg viewBox="-60 -60 120 120"><defs><radialGradient id="ws-x-cone" r="1" cx="0" cy="0" gradientUnits="userSpaceOnUse" gradientTransform="scale(58)"><stop offset="0" stop-color="#8fe3ff" stop-opacity="0.55"/><stop offset="1" stop-color="#8fe3ff" stop-opacity="0"/></radialGradient></defs><path d="M0 0 L-30 -50 A58 58 0 0 1 30 -50 Z" fill="url(#ws-x-cone)"/><path d="M0 -13 L8 9 L0 4 L-8 9 Z" fill="#eaf8ff" stroke="#06121c" stroke-width="1.5" stroke-linejoin="round"/></svg></i>
        <div class="ws-x-map-north"><svg viewBox="0 0 16 16"><path d="M8 1l5 12-5-3-5 3z" fill="currentColor"/></svg>N</div>
        <div class="ws-x-map-scale" style="width:${bar.toFixed(2)}%"><i></i><span>0</span><span>${SCALE_M / 2}</span><span>${SCALE_M} m</span></div>
      </div>`);
    const title = this.sheet.querySelector('.ws-x-map-head b'); if (title === null) throw new Error('MiniMap: missing title'); title.textContent = explore.title.name;
    this.board = this.sheet.querySelector<HTMLElement>('.ws-x-map-board') ?? this.sheet;
    this.canvas = this.board.querySelector('canvas') ?? document.createElement('canvas');
    this.arrow = this.sheet.querySelector<HTMLElement>('.ws-x-map-me') ?? this.sheet;
    for (const p of this.pois) {
      const pin = html('button', 'ws-x-pin', '<i></i><span></span>');
      const label = pin.querySelector('span'); if (label === null) throw new Error('MiniMap: missing pin label'); label.textContent = p.name;
      (pin as HTMLButtonElement).type = 'button';
      const [u, v] = this.toMap(p.x, p.z);
      pin.style.left = `${u * 100}%`; pin.style.top = `${v * 100}%`;
      listenDom(this.uiScope, pin, 'click', (e) => { e.stopPropagation(); this.flyToPoi(p); });
      this.board.append(pin);
    }
    this.layoutTags();
    listenDom(this.uiScope, this.board, 'click', (e) => {
      const r = this.board.getBoundingClientRect();
      const [x, z] = this.fromMap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      this.flyOver(x, z);
    });
    listenDom(this.uiScope, this.button, 'click', () => { this.toggle(); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-map-close'), 'click', () => { this.close(); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-map-spawn'), 'click', () => { this.home(); });
    explore.root.append(this.button, this.sheet);
  }

  /**
   * each pin's tag hangs right unless it would run off the board or over another tag — then left. Tag widths are
   * estimated from the name (the sheet is not laid out yet): ~7 px a letter at 9.5 px letter-spaced caps, on a ~360 px board.
   */
  private layoutTags(): void {
    const pins = [...this.board.querySelectorAll<HTMLElement>('.ws-x-pin')];
    const boxes: { u0: number; u1: number; v: number }[] = [];
    const clash = (u0: number, u1: number, v: number): boolean => boxes.some((b) => Math.abs(b.v - v) < 0.06 && u0 < b.u1 && u1 > b.u0);
    this.pois.forEach((p, i) => {
      const pin = pins[i];
      if (!pin) return;
      const [u, v] = this.toMap(p.x, p.z), w = (p.name.length * 7 + 34) / 360;
      const right = u + w <= 0.98 && !clash(u, u + w, v);
      const left = u - w >= 0.02 && !clash(u - w, u, v);
      const flip = !right && left;
      pin.classList.toggle('flip', flip);
      boxes.push(flip ? { u0: u - w, u1: u, v } : { u0: u, u1: u + w, v });
    });
  }

  get isOpen(): boolean { return this.sheet.classList.contains('show'); }
  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  open(): void { this.draw(); this.sheet.classList.add('show'); this.button.classList.add('on'); this.explore.root.classList.add('mapopen'); this.update(); }
  close(): void { this.sheet.classList.remove('show'); this.button.classList.remove('on'); this.explore.root.classList.remove('mapopen'); }

  /** north (+Z) up, east (−X) right — the HUD compass's convention (src/client/engine/ui/HUD.ts bearingTo) */
  private toMap(x: number, z: number): [number, number] { const { view: w } = this; return [0.5 - (x - w.x) / (w.half * 2), 0.5 - (z - w.z) / (w.half * 2)]; }
  private fromMap(u: number, v: number): [number, number] { const { view: w } = this; return [w.x + (0.5 - u) * w.half * 2, w.z + (0.5 - v) * w.half * 2]; }

  /** the land above the sea (sampled on a 64² grid), the pins and the spawn, squared with a margin; a shard with no sea is all land */
  private frame(): { x: number; z: number; half: number } {
    const sea = app.world.water.level;
    if (sea === null) return { x: 0, z: 0, half: CHUNK_HALF };
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const add = (x: number, z: number, r = 0): void => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); };
    const N = 64;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * CHUNK_HALF * 2, z = ((j + 0.5) / N - 0.5) * CHUNK_HALF * 2;
      if (heightAt(x, z) > sea + 0.5) add(x, z);
    }
    for (const p of this.pois) add(p.x, p.z, p.r ?? 14);
    const s = this.world.game.level.spawn; add(s.x, s.z, 10);
    if (!Number.isFinite(x0)) return { x: 0, z: 0, half: CHUNK_HALF };
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, half: Math.min(CHUNK_HALF, Math.max(x1 - x0, z1 - z0) / 2 + 24) };
  }

  /** a clock shard's hour in eighths of its day (the photoreal clock: `app.world.dayCycle.phase`); a fixed sky is always the same shot */
  private dayKey(): string { const ph = this.world.game.app.world.dayCycle?.phase; return ph === undefined ? 'fixed' : String(Math.floor(ph * 8)); }

  /** the shard from above, once per part of the day: the rendered shot (+ the forest's crowns painted over it), else the heightfield relief */
  private draw(): void {
    const key = this.dayKey();
    if (this.drawn && key === this.shotKey) return;
    const shot = this.shoot();
    const g = this.canvas.getContext('2d');
    if (!g) return;
    this.drawn = true; this.shotKey = key;
    if (shot) {
      this.canvas.width = shot.width; this.canvas.height = shot.height;
      g.drawImage(shot, 0, 0);
      this.crowns(g, shot.width);
    } else this.relief(g);
  }

  /**
   * One frame of the real scene from `EYE` m straight up, north up, through the composer (the shard's own grade, toon
   * shading and water), cropped to the chunk square. The fog is switched off for it and everything above `CEILING` is
   * outside the near plane; the forest is left out — its LOD buckets only hold the trees around the eye, so its
   * crowns are painted from the placement instead (crowns()).
   */
  private shoot(): HTMLCanvasElement | null {
    const { game, forest } = this.world;
    const gl = game.renderer.getContext();
    if (gl.isContextLost()) return null;
    const composer = game.composer; // built long before Explore can open
    const cam = game.camera, src = game.canvas;
    const side = Math.min(src.width, src.height);
    if (side < 64) return null;
    const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), fov: cam.fov, near: cam.near, far: cam.far };
    const fog = { dist: fogUniforms.fogDistDensity.value, height: fogUniforms.fogHeightDensity.value };
    const hidden = [forest.group, ...this.overhead].map((o) => [o, o.visible] as const);
    const { x: vx, z: vz, half: vh } = this.view;
    const half = vh * (src.height / side); // the vertical half-extent that makes the centre square span the view
    cam.fov = (2 * Math.atan(half / EYE) * 180) / Math.PI;
    cam.near = EYE - CEILING; cam.far = EYE + 200;
    cam.position.set(vx, EYE, vz); cam.up.set(0, 0, 1); cam.lookAt(vx, 0, vz); // up = +Z: north at the top, screen right = −X (east)
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    fogUniforms.fogDistDensity.value = 0; fogUniforms.fogHeightDensity.value = 0;
    app.world.water.reflect('top-down'); // the pond reflects its sky from up here, not its black deep body (V3)
    game.look?.fogControl?.suspend(); // a level look's own haze (LookStrategy.fogControl)
    for (const [o] of hidden) o.visible = false;
    const ao = composer.passes.filter((q) => q.enabled && 'configuration' in q); // N8AO: its screen-space radius means nothing from 1.4 km up
    for (const q of ao) q.enabled = false;
    // the sun's cascades were fitted to the real eye: from up here the last one smears the old frame's depths over
    // whole squares of ground (black) — the shot goes without shadows (a uniform, no shader rebuild)
    const suns = this.world.game.sky.csm.lights.map((l) => [l.shadow, l.shadow.intensity] as const);
    for (const [s] of suns) s.intensity = 0;
    forest.update(0, cam.position); // the culled props / terrain dressing refill for this eye (the next frame refills them for the real one)
    const out = document.createElement('canvas'); out.width = side; out.height = side;
    try {
      composer.render(0);
      out.getContext('2d')?.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, side, side);
    } finally {
      for (const [o, v] of hidden) o.visible = v;
      for (const q of ao) q.enabled = true;
      for (const [s, k] of suns) s.intensity = k;
      fogUniforms.fogDistDensity.value = fog.dist; fogUniforms.fogHeightDensity.value = fog.height;
      game.look?.fogControl?.resume();
      app.world.water.reflect('eye');
      cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.up.copy(saved.up);
      cam.fov = saved.fov; cam.near = saved.near; cam.far = saved.far;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    }
    return out;
  }

  /** the forest from above: a crown per tree, a soft shadow to the south-east, lit from the north-west */
  private crowns(g: CanvasRenderingContext2D, side: number): void {
    const trees = this.world.forest.trees;
    if (trees.length === 0) return;
    const px = side / (this.view.half * 2);
    const at = (x: number, z: number): [number, number] => { const [u, v] = this.toMap(x, z); return [u * side, v * side]; };
    const disc = (x: number, y: number, r: number, fill: string): void => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    for (const t of trees) { const [x, y] = at(t.x, t.z); disc(x + 0.7 * px * 2, y + 0.7 * px * 2, Math.max(1.2, t.height * 0.13 * px), 'rgba(8, 20, 12, 0.45)'); }
    for (const t of trees) {
      const [x, y] = at(t.x, t.z), r = Math.max(1.1, t.height * 0.12 * px);
      const c = t.tint;
      disc(x, y, r, `rgb(${Math.round(40 + c.r * 40)}, ${Math.round(70 + c.g * 50)}, ${Math.round(40 + c.b * 25)})`);
      disc(x - r * 0.3, y - r * 0.3, r * 0.5, 'rgba(170, 210, 140, 0.35)');
    }
  }

  /** the fallback: sea by depth, sand, grass, rock by slope — from the same heightfield the terrain is */
  private relief(g: CanvasRenderingContext2D): void {
    this.canvas.width = RES; this.canvas.height = RES;
    const img = g.createImageData(RES, RES), d = img.data;
    const sea = app.world.water.level ?? -Infinity;
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const [x, z] = this.fromMap((i + 0.5) / RES, (j + 0.5) / RES);
      const h = heightAt(x, z), [nx, ny, nz] = normalAt(x, z);
      let r: number, gg: number, b: number;
      if (h < sea) { const k = Math.min(1, (sea - h) / 14); r = 40 - 30 * k; gg = 190 - 110 * k; b = 205 - 60 * k; }
      else if (h < sea + 2.4) { r = 232; gg = 214; b = 160; }
      else if (ny < 0.78) { r = 128; gg = 132; b = 142; }
      else { const k = Math.min(1, (h - Math.max(sea, 0)) / 30); r = 100 - 30 * k; gg = 180 - 40 * k; b = 80 - 20 * k; }
      const shade = 0.78 + 0.22 * Math.max(0, nx * -0.5 + ny * 0.7 + nz * 0.5); // a touch of relief, lit from the NW
      const o = (j * RES + i) * 4;
      d[o] = r * shade; d[o + 1] = gg * shade; d[o + 2] = b * shade; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  private flyToPoi(p: PoiSpec): void {
    const r = p.r ?? 14;
    const ground = Math.max(heightAt(p.x, p.z), app.world.water.level ?? -Infinity);
    const look = new THREE.Vector3(p.x, ground + r * 0.2, p.z);
    // come in from the side the camera is already on, a little above
    const cam = this.world.game.camera.position;
    const dir = new THREE.Vector3(cam.x - p.x, 0, cam.z - p.z);
    if (dir.lengthSq() < 1) dir.set(0, 0, -1);
    dir.normalize().multiplyScalar(r * 2.4);
    this.close();
    this.explore.flyTo(new THREE.Vector3(p.x + dir.x, ground + r * 1.1, p.z + dir.z), look);
    this.explore.toast(p.name);
  }

  private flyOver(x: number, z: number): void {
    const ground = Math.max(heightAt(x, z), app.world.water.level ?? -Infinity);
    this.close();
    this.explore.flyTo(new THREE.Vector3(x, ground + 30, z - 30), new THREE.Vector3(x, ground, z));
  }

  private home(): void {
    const s = this.world.game.level.spawn;
    const y = Math.max(heightAt(s.x, s.z), app.world.water.level ?? -Infinity) + 3;
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    this.close();
    this.explore.flyTo(new THREE.Vector3(s.x, y + 2, s.z), new THREE.Vector3(s.x + fwd.x * 40, y, s.z + fwd.z * 40));
  }

  /** the camera arrow + view cone on the map */
  update(): void {
    if (!this.isOpen) return;
    const cam = this.world.game.camera;
    const [u, v] = this.toMap(cam.position.x, cam.position.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const ang = Math.atan2(-fwd.x, fwd.z); // the arrow is drawn pointing up (north); screen right = −world X, up = +world Z
    this.arrow.style.left = `${Math.min(100, Math.max(0, u * 100))}%`; this.arrow.style.top = `${Math.min(100, Math.max(0, v * 100))}%`;
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
  }
}
