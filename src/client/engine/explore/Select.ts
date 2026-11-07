import { listenDom } from '../input/dom';
import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
/**
 * Select — tap / click a model in the World Explorer (project/archive/2026-09-23-explore-world.md X4; mockups round-3 p09, round-4 g09 / g13;
 * E67: round-6 midway 04): a cyan box, its size in a tag over the box's top, and a glass card standing beside it —
 * name · source file · tris — with OPEN IN MODEL EXPLORER (the turntable), ORBIT (one finger / Alt-drag turns around
 * it) and ✕.
 *
 *   const sel = new Select(explore, world, targets);   // targets: what a tap can hit (catalog entries, batched meshes, animals)
 *   sel.pick(clientX, clientY)   // from TouchFly.onTap or a desktop left click
 *   sel.selectEntry(entry)       // VIEW IN WORLD lands with the model selected
 *   sel.copyInTheWay(eye, look, far) / sel.pickFrom(eye, look)   // VIEW IN WORLD's eye test (E342, viewPoint.ts)
 *   sel.update()                 // every frame: the tag and the card follow the box on screen
 */
import * as THREE from 'three';
import type { World } from '../core/bootstrap';
import type { ContextValue } from '../ui/review';
import { measure, type CatalogEntry } from './catalog';
import type { Explore } from './Explore';
import { copyInTheWay, pickTarget, type Picked, type SelectTarget } from './pick';


const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };

export class Select {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  private readonly ray = new THREE.Raycaster();
  /** VIEW IN WORLD's eye test (a tap's own `ray` is left alone) */
  private readonly probe = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly helper: THREE.Box3Helper;
  private readonly box = new THREE.Box3();
  private readonly card: HTMLElement;
  private readonly dim: HTMLElement;
  private readonly corner = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private current: { entry: CatalogEntry; label: string } | null = null;
  private down: { x: number; y: number; t: number } | null = null;

  private readonly explore: Explore;
  private readonly world: World;
  private readonly targets: SelectTarget[];
  private readonly entries: readonly CatalogEntry[];
  constructor(explore: Explore, world: World, targets: SelectTarget[], entries: readonly CatalogEntry[]) {
    this.explore = explore;
    this.world = world;
    this.targets = targets;
    this.entries = entries;
    this.helper = new THREE.Box3Helper(this.box, 0x8fe3ff);
    const m = this.helper.material as THREE.LineBasicMaterial;
    m.depthTest = false; m.transparent = true; m.opacity = 0.9; m.fog = false; m.toneMapped = false;
    this.helper.renderOrder = 999;
    this.helper.visible = false;
    world.game.scene.add(this.helper);
    this.card = html('div', 'ws-x-select', `
      <b></b><small></small>
      <div class="ws-x-select-actions"><button type="button" class="ws-x-open">Open in model explorer</button><button type="button" class="ws-x-orbit">Orbit</button><button type="button" class="ws-x-deselect" aria-label="Deselect">✕</button></div>`);
    this.dim = html('div', 'ws-x-select-dim');
    explore.root.append(this.dim, this.card);
    listenDom(this.uiScope, this.card.querySelector('.ws-x-open'), 'click', () => { const c = this.current; if (c) { this.clear(); this.explore.setMode('model', { model: c.entry.id }); } });
    listenDom(this.uiScope, this.card.querySelector('.ws-x-orbit'), 'click', () => { this.orbit(); });
    listenDom(this.uiScope, this.card.querySelector('.ws-x-deselect'), 'click', () => { this.clear(); });
    // desktop: a left click that did not drag (FreeCam owns right / middle / Alt+left)
    const canvas = world.game.canvas;
    listenDom(this.uiScope, canvas, 'pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0 && !e.altKey) this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    listenDom(this.uiScope, canvas, 'pointerup', (e) => {
      const d = this.down; this.down = null;
      if (!d || e.pointerType !== 'mouse' || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 400) this.pick(e.clientX, e.clientY);
    });
  }

  get selected(): CatalogEntry | null { return this.current?.entry ?? null; }

  /** the nearest target under a screen point; empty space clears the selection */
  pick(x: number, y: number): void {
    if (this.explore.mode !== 'world') return;
    const { camera } = this.world.game;
    this.ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, camera);
    this.ray.far = 600;
    // each object raycast once; on a kit several models are drawn into, only a copy under the finger takes the tap (E323)
    const best = pickTarget(this.ray, this.targets);
    if (!best) { this.clear(); return; }
    const entry = this.entries.find((e) => e.id === best.target.entry);
    if (!entry) { this.clear(); return; }
    this.box.copy(best.box);
    this.show(entry, best.target.label?.(best.point) ?? entry.name);
  }

  /** VIEW IN WORLD (E342): a drawn-into copy stands between `eye` and `look`, short of `far` metres (see pick.ts) */
  copyInTheWay(eye: THREE.Vector3, look: THREE.Vector3, far: number): boolean {
    this.probe.ray.origin.copy(eye);
    this.probe.ray.direction.subVectors(look, eye).normalize();
    return copyInTheWay(this.probe.ray, far, look, this.targets);
  }

  /** VIEW IN WORLD (E342): what a tap at the centre of a view from `eye` looking at `look` would select (as drawn now) —
   *  the landing's check reads `target.entry`, and where it hit (`point`) when that is something else (E345) */
  pickFrom(eye: THREE.Vector3, look: THREE.Vector3): Picked | null {
    this.probe.set(eye, this.tmp.subVectors(look, eye).normalize());
    this.probe.far = 600;
    return pickTarget(this.probe, this.targets);
  }

  /** select a catalog entry directly (VIEW IN WORLD): boxed on the real copy it flew to (`copy`, else the one nearest the
   *  spawn; E306), else its own object */
  selectEntry(e: CatalogEntry, copy: THREE.Box3 | null = e.worldBox?.() ?? null): void {
    if (copy) { this.box.copy(copy); this.show(e, e.name); return; }
    const o = e.object();
    if (!o.parent) return;
    this.box.setFromObject(o);
    this.show(e, e.name);
  }

  clear(): void {
    this.current = null;
    this.helper.visible = false;
    this.card.classList.remove('show');
    this.dim.classList.remove('show');
    this.explore.setOrbit(false);
  }

  context(): Record<string, ContextValue> {
    const c = this.current;
    return c ? { selected: c.entry.id, selectedFile: c.entry.file } : {};
  }

  private show(entry: CatalogEntry, label: string): void {
    this.current = { entry, label };
    this.helper.visible = true;
    const size = this.box.getSize(this.tmp);
    const b = this.card.querySelector('b'), small = this.card.querySelector('small');
    this.dim.textContent = engineString('s_d5977ab9ef6e', [size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1)]);
    if (b) b.textContent = label;
    if (small) small.textContent = engineString('s_276bbc529952', [entry.file, (entry.live ? measure(entry.object()).tris : 0) > 0 ? engineString('s_4c4a9fb609dc', [measure(entry.object()).tris.toLocaleString()]) : engineString('s_3439dca0983f')]);
    this.card.classList.add('show');
    this.dim.classList.add('show');
    this.update();
  }

  private orbit(): void {
    if (!this.current) return;
    this.explore.setOrbit(true, this.box.getCenter(new THREE.Vector3()));
  }

  /**
   * every frame: the box's screen rectangle (its eight corners projected) places the size tag over its top edge and the
   * card beside it — right if it fits, else left, else under it; both hide while the box is behind the camera
   */
  update(): void {
    if (!this.current || this.explore.mode !== 'world') { if (this.current && this.explore.mode !== 'world') this.clear(); return; }
    const { camera } = this.world.game;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      const p = this.corner.set(i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z).project(camera);
      if (p.z > 1) { behind = true; break; }
      const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const hide = behind ? 'hidden' : '';
    this.card.style.visibility = hide; this.dim.style.visibility = hide;
    if (behind) return;
    const W = innerWidth, H = innerHeight, pad = 8, top = 70, bottom = 90;
    const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.max(lo, Math.min(hi, v)));
    const dw = this.dim.offsetWidth, dh = this.dim.offsetHeight;
    this.dim.style.transform = `translate(${clamp((x0 + x1) / 2 - dw / 2, pad, W - dw - pad)}px, ${clamp(y0 - dh - 6, top, H - dh - bottom)}px)`;
    const w = this.card.offsetWidth, h = this.card.offsetHeight, mid = (y0 + y1) / 2 - h / 2;
    let cx: number, cy: number;
    if (x1 + 10 + w <= W - pad) { cx = x1 + 10; cy = mid; }
    else if (x0 - 10 - w >= pad) { cx = x0 - 10 - w; cy = mid; }
    else { cx = (x0 + x1) / 2 - w / 2; cy = y1 + 12; }
    this.card.style.transform = `translate(${clamp(cx, pad, W - w - pad)}px, ${clamp(cy, top, H - h - bottom)}px)`;
  }
}
