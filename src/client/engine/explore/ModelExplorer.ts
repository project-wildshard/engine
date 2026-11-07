import { listenDom, listenPage } from '../input/dom';
import { engineString } from '../../../shared/engine/strings';
/**
 * Model Explorer (project/archive/2026-09-23-explore-world.md X3; mockups round-3 p04 catalog, p03 turntable, p17 close-up): the Explore pane that
 * puts one model at a time on a turntable — isolated IN the live scene (same renderer, lights, day/night, post chain),
 * so what you inspect is exactly what the game draws.
 *
 *   const me = new ModelExplorer(explore, world, entries);   explore.addPane('model', me);
 *   me.show({ model: 'hut' })  // straight onto a turntable;  me.show({}) → the catalog
 *
 * Catalog: a filterable grid; every card's thumbnail is rendered through the game's own composer, one per two frames
 * (so thumbnails show the real look, AO and grade included). Turntable: drag = orbit (idle → it slowly turns), wheel /
 * pinch = zoom; SOLID · WIREFRAME · FACETS · PAINT; DAWN · NOON · DUSK · NIGHT pin the day/night clock; the sheet shows
 * the source file, triangles, draw calls; PART OF names the sets it is in (each opens in the Set Explorer, E315 M7);
 * VIEW IN WORLD hands the model to the World Explorer.
 *
 * The turntable's frame (E315, Jake: "too zoomed in" · "the model rendering zone should be the top two thirds of the
 * screen"): the model renders in the band between the top bars and 2/3 of the screen (or the clip / variant rows, if
 * higher), the lens shifted onto that band (setView.ts lensShift: the orbit still turns round the model), and it is
 * fitted there with a margin — the model and the disc it stands on, from every side as it turns, never nearer than
 * MIN_DIST. The bottom third is the card's: a fixed height for every model (one-line path, name, stats, PART OF, budget).
 * A flat piece drawn from one side (a sign board, a roll shutter, a couplet: Nine Dragon's facade pieces face +z out of
 * their wall) opens facing its face, and the idle turn sways round its front instead of turning its blank back to you.
 * While a model is on show, `ws:turntable` lets the shard install its specimen lighting.
 */
import * as THREE from 'three';
import type { World } from '../core/bootstrap';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import type { ContextValue } from '../ui/review';
import { CATEGORIES, measure, type CatalogEntry, type Category } from './catalog';
import type { Explore, ExplorePane } from './Explore';
import { TIERS } from './tiers';
import { TIER as CURRENT_TIER, type Tier } from '../core/tier';
import { frameBudget } from '../render/budgetReport';
import { activeLevel } from '../../../shared/engine/level/selection';
import type { Animal } from '../entities/AnimalView';
import type { DrawnAs, Pipeline } from '../world/registry';
import type { LightPreset, DayCycleClock } from '../../../shared/engine/world/dayCycle';
import { app } from '../app/runtime';
import { registeredSets } from './registry';
import { bandWindow, fitOrbit, lensReset, lensShift, setsOf } from './setView';
import { LoadProgress } from '../ui/loadProgress';

type View = 'solid' | 'wire' | 'facets' | 'paint' | 'tiers';
const VIEWS: readonly [View, string][] = [['solid', 'Solid'], ['wire', 'Wireframe'], ['facets', 'Facets'], ['paint', 'Paint'], ['tiers', 'Tiers']];
/** the light presets: held on the shard's day clock (src/engine/world/WorldClock.ts — a level backdrop's or Nalati's sky rig) */
const LIGHTS: readonly [string, LightPreset][] = [['Dawn', 'dawn'], ['Noon', 'noon'], ['Dusk', 'dusk'], ['Night', 'night']];
const THUMB_W = 240, THUMB_H = 180;
/** what the creature viewer can play — a gait speed on the treadmill, or an event (stagger, death) */
type Clip = 'idle' | 'walk' | 'trot' | 'charge' | 'hit' | 'die';
const CLIPS: readonly [Clip, string][] = [['idle', 'Idle'], ['walk', 'Walk'], ['trot', 'Trot'], ['charge', 'Charge'], ['hit', 'Hit'], ['die', 'Die']];
const GAIT: Record<Clip, number> = { idle: 0, walk: 1.3, trot: 3.2, charge: 7, hit: 0, die: 0 };

/** a mesh with three's default generics (instanceof narrows to Mesh<any>) */
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as Partial<THREE.Mesh>).isMesh === true;
/** something the renderer draws (a mesh, a line, points, a sprite) */
const drawn = (o: THREE.Object3D): boolean => { const d = o as Partial<THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite>; return d.isMesh === true || d.isLine === true || d.isPoints === true || d.isSprite === true; };
/** where isolate puts what it hides: the camera draws layer 0 only */
const HIDDEN_LAYER = 31;
/** 86 tris · 5.3k tris */
const trisLabel = (n: number): string => (n < 1000 ? `${n} tris` : `${(n / 1000).toFixed(1)}k tris`);
/** the card's badge words (E306: how each model is made) */
const PIPELINE_LABEL: Readonly<Record<Pipeline, string>> = { code: 'CODE', blender: 'BLENDER', trellis: 'TRELLIS', hunyuan: 'HUNYUAN', cc0: 'CC0' };
const DRAWN_LABEL: Readonly<Record<DrawnAs, string>> = { single: 'single', merged: 'merged', instanced: 'instanced', batched: 'batched', skinned: 'skinned' };
/** CODE · × 110 merged — SHARED first for a model several shards use (src/client/engine/models/: the dummy, the deer; E315 M5) */
const factsLabel = (e: CatalogEntry): string => `${e.shared === true ? 'SHARED · ' : ''}${e.pipeline.map((p) => PIPELINE_LABEL[p]).join(' + ')} · × ${e.copies.toLocaleString()} ${DRAWN_LABEL[e.drawnAs]}`;
/** one copy's triangles (a live instanced object measures every instance) */
const perCopy = (e: CatalogEntry, tris: number): number => (e.live && e.drawnAs === 'instanced' && e.copies > 1 ? Math.round(tris / e.copies) : tris);
/** the nearest the turntable's camera frames a model from, metres (a 0.4 m hatchet still stands on its disc) */
const MIN_DIST = 1.1;
/** frames a rig's idle loop is sampled for its widest reach (≈ 1.5 s at 60 fps) */
const RIG_FRAMES = 90;
/** how far past its first framed box a rig's idle loop may widen the fit (further is a journey, not a pose) */
const RIG_REACH = 1.8;
/** the render zone's bottom: two thirds down the screen (the card and its rows have the third below) */
const ZONE_BOTTOM = 2 / 3;
/** a path as its folder (it gives way, an ellipsis in the middle of the path) and its file name (it never does) */
/** oneSided's threshold: the share of a piece's area its faces' level sum must reach */
const ONE_SIDED = 0.3;
/** a one-sided piece is flat when its depth along its face is at most this share of its width across it; its disc's
 *  radius, as a share of its half-width (a round model's is 1.3) */
const FLAT = 0.35, FLAT_DISC = 0.6;
/** a one-sided piece (oneSided): opened this far (rad) off its front; its idle sway's half-angle; the sway's phase there */
const SWAY_OPEN = 0.35, SWAY = 0.8, SWAY_PHASE = Math.asin(SWAY_OPEN / SWAY);
/** the turntable's shadow map, every tier: one model in the map, so 2048 is cheap */
const STUDIO_SHADOW_MAP = 2048;

function setShadowMapSize(l: THREE.DirectionalLight, n: number): void {
  if (l.shadow.mapSize.x === n) return;
  l.shadow.mapSize.set(n, n); l.shadow.map?.dispose(); l.shadow.map = null;
}

const html = (tag: string, cls: string, inner = ''): HTMLElement => { const e = document.createElement(tag); e.className = cls; e.innerHTML = inner; return e; };
const words = (tag: string, cls: string, text: string): HTMLElement => { const node = html(tag, cls); node.textContent = text; return node; };
const fileNodes = (path: string): HTMLElement[] => { const i = path.lastIndexOf('/') + 1; return [words('span', 'ws-x-file-dir', path.slice(0, i)), words('span', 'ws-x-file-name', path.slice(i))]; };

export class ModelExplorer implements ExplorePane {
  private readonly uiScope = (app.levelScope ?? app.engineScope).child('explore-widget');
  readonly el: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly sheetObserver: ResizeObserver;
  private readonly studio = new THREE.Group();
  private readonly floor: THREE.Group;
  private readonly contact: THREE.Mesh;
  private savedBackground: THREE.Scene['background'] | undefined;
  /** the built-on-view models standing in the studio (one of a batch, the creatures): only the one on show is visible */
  private readonly fresh = new Set<THREE.Object3D>();
  private current: CatalogEntry | null = null;
  private filter: Category | 'all' = 'all';
  private view: View = 'solid';
  private light = -1;
  private readonly hidden = new Map<THREE.Object3D, boolean>();
  /** what isolate moved off the camera's layer, and its layers before */
  private readonly layered = new Map<THREE.Object3D, number>();
  private readonly swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private readonly overlays: THREE.LineSegments<THREE.WireframeGeometry, THREE.LineBasicMaterial>[] = [];
  private readonly thumbs = new Map<string, HTMLCanvasElement>();
  private thumbQueue: CatalogEntry[] = [];
  private pendingThumb: CatalogEntry | null = null;
  private thumbnailVersion = 0;
  /** cards whose model threw while its thumbnail was drawn: kept out of the queue until the model says it is ready again */
  private readonly failedThumbs = new Set<string>();
  private frame = 0;
  // orbit
  private readonly target = new THREE.Vector3();
  private yaw = 0.7; private pitch = 0.32; private dist = 12; private minDist = 2; private maxDist = 60;
  /** a one-sided model's front (the camera's yaw that faces it): the idle turn sways round it; null = it turns all round */
  private front: number | null = null;
  private swayT = 0;
  /** the fitted distance (the zoom is a ratio of it), the box that is fitted, where the lens is centred (CSS px) */
  private fitDist = 0;
  private readonly framed = new THREE.Box3();
  private lensY = 0;
  private zone = { top: 0, bottom: 0 };
  /** frames until the fit is checked: the model's own vertices landed inside the zone (`data-clip`, for the sweep) */
  private checkFit = 0;
  /** a rig's first frames on show: every few, its posed box is taken and the fit widens to the widest of its idle loop */
  private rigFrames = 0;
  /** the rig's first framed box, its largest side (metres): how far its loop may widen the fit is measured from it */
  private rigBase = 0;
  private readonly scratch = new THREE.PerspectiveCamera();
  private idle = 0;
  private drag: { id: number; x: number; y: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private catalogT = 0;
  private wireMat: THREE.MeshBasicMaterial | null = null;
  private readonly paintMats = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  /** creatures (X8): the clip playing on the treadmill, where it is pinned, the skeleton overlay, half speed */
  private clip: Clip = 'idle';
  private readonly pin = new Map<Animal, { x: number; z: number }>();
  private skeleton = false;
  private skelHelper: THREE.SkeletonHelper | null = null;
  private slow = false;
  /** LINEUP (X8): every creature side by side with height lines */
  private lineup: { group: THREE.Group; labels: { a: Animal; el: HTMLElement }[]; ruler: THREE.LineSegments; marks: HTMLElement[]; base: number } | null = null;
  /** DETAIL TIERS: the model built at each tier, side by side on the disc, with a label each */
  private readonly tierBuilds = new Map<string, Map<Tier, THREE.Object3D>>();
  private tierShown: { tier: Tier; o: THREE.Object3D; label: HTMLElement }[] = [];

  private readonly explore: Explore;
  private readonly world: World;
  private readonly entries: CatalogEntry[];
  private readonly preparation: LoadProgress;
  constructor(explore: Explore, world: World, entries: CatalogEntry[]) {
    this.explore = explore;
    this.world = world;
    this.entries = entries;
    this.el = html('div', 'ws-x-models');
    this.preparation = new LoadProgress(this.el);
    this.uiScope.onDispose(() => { this.preparation.dispose(); });
    this.grid = html('div', 'ws-x-catalog', '<div class="ws-x-filter"><button type="button" class="ws-x-lineup">Lineup</button></div><div class="ws-x-grid"></div>');
    const lineup = this.grid.querySelector('.ws-x-lineup'); if (lineup === null) throw new Error('ModelExplorer: missing lineup');
    for (const category of CATEGORIES.filter((c) => c.id === 'all' || entries.some((e) => e.category === c.id))) {
      const chip = words('button', '', category.label) as HTMLButtonElement; chip.type = 'button'; chip.dataset['f'] = category.id; lineup.before(chip);
    }
    this.sheet = html('div', 'ws-x-turntable', `
      <div class="ws-x-views">${VIEWS.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="ws-x-lights">${LIGHTS.map(([l], i) => `<button type="button" data-l="${i}">${l}</button>`).join('')}</div>
      <div class="ws-x-creature">
        <div class="ws-x-clips">${CLIPS.map(([c, l]) => `<button type="button" data-c="${c}">${l}</button>`).join('')}</div>
        <div class="ws-x-creature-row"><span class="ws-x-variants"></span><button type="button" class="ws-x-skel">Skeleton</button><button type="button" class="ws-x-slow">0.5×</button></div>
      </div>
      <div class="ws-x-sheet">
        <div class="ws-x-sheet-head"><button class="ws-x-back" type="button">‹ Catalog</button><b class="ws-x-name"></b><span class="ws-x-step"><button class="ws-x-prev" type="button" aria-label="Previous model">‹</button><button class="ws-x-next" type="button" aria-label="Next model">›</button></span></div>
        <button class="ws-x-file" type="button" aria-label="Source file"></button>
        <div class="ws-x-stats"><span><i>Tris</i><b data-s="tris"></b></span><span><i>Draw calls</i><b data-s="calls"></b></span><span><i>Build</i><b data-s="build"></b></span><span><i>Made with</i><b data-s="made"></b></span><span><i>Copies</i><b data-s="copies"></b></span><span><i>Drawn as</i><b data-s="drawn"></b></span></div>
        <div class="ws-x-budget"><span></span><div class="ws-x-budget-bar"><i></i></div></div>
        <div class="ws-x-actions"><button class="ws-x-inworld" type="button">View in world</button><div class="ws-x-partof"><i>Part of</i><span></span></div></div>
      </div>`);
    this.el.append(this.grid, this.sheet);
    // The bottom sheet changes height with iPhone viewport, safe area, text wrapping and localization. Keep the
    // variant and clip controls above its *measured* top, rather than a fixed 208 px from the screen bottom.
    this.sheetObserver = new ResizeObserver(() => { this.placeVariantControls(); this.refit(false); });
    listenDom(this.uiScope, document, 'ws:model-ready', (event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      const entry = this.entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      this.thumbs.delete(id); this.failedThumbs.delete(id);
      this.thumbQueue = this.thumbQueue.filter((candidate) => candidate.id !== id);
      this.grid.querySelector(`.ws-x-model[data-id="${id}"] .ws-x-model-thumb`)?.replaceChildren();
      if (this.el.dataset['view'] === 'catalog' && this.pendingThumb !== entry) this.thumbQueue.push(entry);
      if (this.current?.id !== id) return;
      const model = entry.object();
      this.frameModel(model);
      this.refit(true);
      this.setView(this.view, false);
      const measured = measure(model);
      const set = (key: string, value: string): void => { const node = this.sheet.querySelector<HTMLElement>(`.ws-x-stats b[data-s="${key}"]`); if (node) node.textContent = value; };
      const each = perCopy(entry, measured.tris);
      set('tris', each.toLocaleString()); set('calls', String(measured.calls));
      this.budget(each, measured.calls, entry.copies);
    });
    // index.html swallows touchmove outside [data-scroll]: without the mark the catalog can't scroll on a phone (E109)
    for (const s of this.el.querySelectorAll<HTMLElement>('.ws-x-grid, .ws-x-filter, .ws-x-variants, .ws-x-clips')) s.dataset['scroll'] = '';
    this.grid.querySelectorAll<HTMLElement>('.ws-x-filter button').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { this.filter = (b.dataset['f'] ?? 'all') as Category | 'all'; this.renderGrid(); }); });
    this.sheet.querySelectorAll<HTMLElement>('.ws-x-views button').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { this.setView((b.dataset['v'] ?? 'solid') as View); }); });
    this.sheet.querySelectorAll<HTMLElement>('.ws-x-lights button').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { this.setLight(Number(b.dataset['l'] ?? -1)); }); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-back'), 'click', () => { this.openCatalog(); });
    // the path is one line (its folder gives way in the middle): a tap shows the whole of it
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-file'), 'click', () => { const e = this.current; if (e) this.explore.toast(e.file); });
    // E181 (Jake: "there's no buttons to go left or right in the catalog"): step through the list the catalog is showing
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-prev'), 'click', () => { this.step(-1); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-next'), 'click', () => { this.step(1); });
    listenDom(this.uiScope, this.grid.querySelector('.ws-x-lineup'), 'click', () => { this.openLineup(); });
    this.sheet.querySelectorAll<HTMLElement>('.ws-x-clips button').forEach((b) => { listenDom(this.uiScope, b, 'click', () => { this.playClip((b.dataset['c'] ?? 'idle') as Clip); }); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-skel'), 'click', () => { this.setSkeleton(!this.skeleton); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-slow'), 'click', (ev) => { this.slow = !this.slow; (ev.currentTarget as HTMLElement).classList.toggle('on', this.slow); });
    listenDom(this.uiScope, this.sheet.querySelector('.ws-x-inworld'), 'click', () => { const e = this.current; if (e) this.explore.viewInWorld(e); });

    // the studio (X11, target art/build-world/round-6-midway/07): a dark floor whose grid fades into the dark, a raised
    // glass disc with a glowing cyan rim (HDR colour → the bloom picks it up), a soft contact shadow; the day sky is
    // swapped for a deep blue gradient while a model is on show (studioBackdrop). Everything unit-sized; frameModel scales it.
    this.floor = new THREE.Group();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: fadingGrid(), transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    grid.position.y = -0.002;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.03, 0.12, 72), new THREE.MeshStandardMaterial({ color: 0x10283b, metalness: 0.6, roughness: 0.24 }));
    disc.position.y = -0.06; disc.receiveShadow = true;
    world.sky.setupMaterial(disc.material);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.007, 6, 128).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fe3ff).multiplyScalar(1.9), fog: false, toneMapped: false }));
    rim.position.y = 0.002;
    const glow = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.14, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: rimGlow(), transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    glow.position.y = -0.001;
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, fog: false, opacity: 0.75 }));
    this.contact.position.y = 0.004;
    this.floor.add(grid, disc, glow, rim);
    this.studio.add(this.contact);
    this.studio.add(this.floor);
    this.studio.visible = false;
    world.game.scene.add(this.studio);

    const canvas = world.game.canvas;
    listenDom(this.uiScope, canvas, 'pointerdown', this.onDown);
    listenPage(this.uiScope, 'pointermove', this.onMove);
    listenPage(this.uiScope, 'pointerup', this.onUp);
    listenPage(this.uiScope, 'pointercancel', this.onUp);
    listenDom(this.uiScope, canvas, 'wheel', this.onWheel, { passive: false });
    this.renderGrid();
  }

  get entryList(): readonly CatalogEntry[] { return this.entries; }

  /** the shard's day clock (src/engine/world/WorldClock.ts) when it has one: the light presets hold it */
  private clock(): DayCycleClock | null { return app.world.dayCycle; }

  show(opts: Record<string, string>): void {
    this.el.classList.add('show');
    const bottomSheet = this.sheet.querySelector('.ws-x-sheet');
    if (bottomSheet) this.sheetObserver.observe(bottomSheet);
    this.sheetObserver.observe(this.el);
    const id = opts['model'];
    const e = id !== undefined ? this.entries.find((x) => x.id === id) : undefined;
    if (e) this.openModel(e); else this.openCatalog();
  }

  hide(): void {
    this.thumbnailVersion++;
    this.el.classList.remove('show');
    this.sheetObserver.disconnect();
    this.closeModel();
    this.pendingThumb?.release?.();
  }

  private placeVariantControls(): void {
    if (this.el.dataset['view'] !== 'model') return;
    const sheetTop = this.sheet.querySelector('.ws-x-sheet')?.getBoundingClientRect().top ?? 0;
    if (sheetTop > 0) this.el.style.setProperty('--ws-x-variant-bottom', `${Math.ceil(innerHeight - sheetTop + 10)}px`);
  }

  context(): Record<string, ContextValue> {
    const e = this.current;
    if (!e) return { view: 'catalog' };
    const m = measure(e.object());
    return { model: e.id, file: e.file, view: this.view, light: this.light >= 0 ? LIGHTS[this.light]?.[0] ?? '' : 'live', tris: m.tris, modelCalls: m.calls };
  }

  // ── catalog ──
  private openCatalog(): void {
    this.closeModel();
    this.el.dataset['view'] = 'catalog';
    this.renderGrid();
    this.thumbQueue = this.entries.filter((e) => !this.thumbs.has(e.id) && !this.failedThumbs.has(e.id));
  }

  /** the entries the catalog is showing, in its order — what PREV / NEXT walk (E181) */
  private shown(): CatalogEntry[] {
    return this.entries.filter((e) => this.filter === 'all' || e.category === this.filter);
  }

  /** PREV / NEXT: the neighbour in the catalog's own order, wrapping round. A lineup has no neighbour. */
  private step(by: -1 | 1): void {
    const cur = this.current;
    if (!cur || this.lineup !== null) return;
    const list = this.shown();
    const i = list.findIndex((e) => e.id === cur.id);
    if (i === -1 || list.length < 2) return;
    const next = list[(i + by + list.length) % list.length];
    if (next) this.openModel(next);
  }

  /** E182: ✕ / Esc steps back to the catalog while a model is up, and hands the step on from the catalog itself */
  back(): boolean {
    if (this.el.dataset['view'] !== 'model') return false;
    this.openCatalog();
    return true;
  }

  private renderGrid(): void {
    this.grid.querySelectorAll<HTMLElement>('.ws-x-filter button').forEach((b) => { b.classList.toggle('on', b.dataset['f'] === this.filter); });
    const box = this.grid.querySelector('.ws-x-grid');
    if (!box) return;
    box.replaceChildren();
    for (const e of this.entries) {
      if (this.filter !== 'all' && e.category !== this.filter) continue;
      const tris = e.live ? `${trisLabel(perCopy(e, measure(e.object()).tris))}${e.copies > 1 ? ' each' : ''}` : 'built on view';
      const card = html('button', 'ws-x-model', '<span class="ws-x-model-thumb"></span>');
      card.append(words('b', '', e.name), words('small', '', factsLabel(e)), words('small', '', tris));
      (card as HTMLButtonElement).type = 'button';
      const thumb = this.thumbs.get(e.id);
      if (thumb) card.querySelector('.ws-x-model-thumb')?.append(thumb);
      listenDom(this.uiScope, card, 'click', () => { this.openModel(e); });
      card.dataset['id'] = e.id;
      box.append(card);
    }
  }

  // ── turntable ──
  private openModel(e: CatalogEntry): void {
    this.thumbnailVersion++;
    this.closeModel();
    if (this.pendingThumb !== e) this.pendingThumb?.release?.();
    this.current = e;
    this.el.dataset['view'] = 'model';
    const o = e.object();
    if (e.ready !== undefined) void this.preparation.watch(e.name, [e.ready()]).catch(() => undefined); // The status retains this failure until another choice.
    if (!e.live && o.parent !== this.studio) { this.studio.add(o); this.fresh.add(o); }
    this.isolate(o);
    this.frameModel(o);
    this.setView(this.view);
    this.setLight(this.light);
    const a = e.animal;
    this.sheet.classList.toggle('creature', a !== undefined && this.lineup === null);
    this.sheet.classList.toggle('variant', a === undefined && (e.variants?.length ?? 0) > 0 && this.lineup === null);
    this.sheet.classList.toggle('lineup', this.lineup !== null);
    if (a) { this.pin.set(a, { x: a.position.x, z: a.position.z }); this.clip = 'idle'; this.markClip(); if (this.skeleton) this.setSkeleton(true); }
    this.rigFrames = this.lineup === null && o.getObjectsByProperty('isSkinnedMesh', true).length > 0 ? RIG_FRAMES : 0; // (a creature, the dummy)
    const first = this.framed.getSize(new THREE.Vector3());
    this.rigBase = Math.max(first.x, first.y, first.z, 0.5);
    if ((e.variants?.length ?? 0) > 0) this.renderVariants(e);
    this.sheet.classList.toggle('noclock', this.clock() === null);
    const m = measure(o);
    const q = (s: string): HTMLElement | null => this.sheet.querySelector<HTMLElement>(s);
    const name = q('.ws-x-name'), file = q('.ws-x-file');
    if (name) { name.textContent = e.name; name.title = e.name; }
    if (file) { file.replaceChildren(...fileNodes(e.file)); file.title = e.file; }
    const worldAction = this.sheet.querySelector<HTMLButtonElement>('.ws-x-inworld');
    if (worldAction) worldAction.classList.toggle('off', e.worldView === false); // (its room kept: the card never changes height)
    this.renderPartOf(e);
    const step = q('.ws-x-step'); // E181: nothing to step to in a one-model filter, or in a lineup
    if (step) step.hidden = this.lineup !== null || this.shown().length < 2;
    const set = (k: string, v: string): void => { const el = q(`.ws-x-stats b[data-s="${k}"]`); if (el) el.textContent = v; };
    const each = perCopy(e, m.tris);
    set('tris', each.toLocaleString()); set('calls', String(m.calls)); set('build', e.live ? 'at boot' : `${e.buildMs.toFixed(1)} ms`);
    set('made', `${e.pipeline.map((p) => PIPELINE_LABEL[p]).join(' + ')}${e.shared === true ? ' · shared' : ''}`); set('copies', `× ${e.copies.toLocaleString()}`); set('drawn', DRAWN_LABEL[e.drawnAs]);
    this.budget(each, m.calls, e.copies);
    this.placeVariantControls();
    this.refit(true);
  }

  /** PART OF (E315 M7): the sets this model is a member of — each opens in the Set Explorer */
  private renderPartOf(e: CatalogEntry): void {
    const row = this.sheet.querySelector<HTMLElement>('.ws-x-partof'), box = row?.querySelector('span');
    if (!row || !box) return;
    const sets = this.lineup === null ? setsOf(e.id, registeredSets()) : [];
    row.classList.toggle('none', sets.length === 0); // (the row keeps its room: no set reads 'Part of —')
    box.replaceChildren(...sets.map((s) => {
      const b = words('button', '', s.name);
      (b as HTMLButtonElement).type = 'button';
      b.dataset['set'] = s.id;
      listenDom(this.uiScope, b, 'click', () => { this.explore.openSet(s.id); });
      return b;
    }));
  }

  private closeModel(): void {
    this.preparation.clear();
    this.closeLineup();
    this.setSkeleton(false, false);
    if (!this.current) { this.unisolate(); return; }
    if (lensReset(this.world.game.camera)) this.world.game.sky.csm.updateFrustums();
    this.setView('solid', false);
    this.restoreLight();
    this.releaseShadows();
    this.unisolate();
    if (this.current.release !== undefined) {
      this.fresh.delete(this.current.object());
      this.tierBuilds.delete(this.current.id);
      this.current.release();
      for (const material of this.paintMats.values()) material.dispose();
      this.paintMats.clear();
    }
    this.current = null;
  }

  /** show only `o` (+ the sky, the lights, the studio floor) */
  private isolate(o: THREE.Object3D): void {
    const { scene } = this.world.game;
    const keep = new Set<THREE.Object3D>([this.studio]);
    if (this.savedBackground === undefined) {
      this.savedBackground = scene.background; scene.background = studioBackdrop();
      // the studio is indoors: a shard's weather drawn in its post (Nine Dragon's drizzle) stops while a model is on show (E306)
      document.dispatchEvent(new CustomEvent('ws:studio-active', { detail: true }));
    this.world.game.app.events.emit('explore.studio', true);
      // (the Model Explorer's own: a shard's specimen light, keyed from the side the turntable opens on — frameModel)
      this.world.game.app.events.emit('explore.turntable', { on: true, key: this.world.game.sky.sunDir.clone() });
    }
    // every level from the model up to the scene: its siblings go (one cabin out of the homestead group, one jetty
    // out of the pier), the lights stay
    for (let node: THREE.Object3D = o; node.parent; node = node.parent) {
      keep.add(node);
      for (const c of node.parent.children) {
        if (keep.has(c) || c === node) continue;
        if (node.parent === this.studio && !this.fresh.has(c)) continue; // the studio's own children are the stage
        if (!this.hidden.has(c)) this.hidden.set(c, c.visible);
        c.visible = c instanceof THREE.Light;
        // (and every drawn thing under it off the camera's layer: Pine Hollow's forest bands and cells are culled per frame,
        // their cullers set `visible` back on, never `layers` — they floated behind the turntable)
        if (!(c instanceof THREE.Light)) c.traverse((d) => { if (drawn(d) && !this.layered.has(d)) { this.layered.set(d, d.layers.mask); d.layers.set(HIDDEN_LAYER); } });
      }
      if (node.parent === scene) break;
    }
    this.studio.visible = true;
    o.visible = true;
  }

  private unisolate(): void {
    for (const [c, v] of this.hidden) c.visible = v;
    this.hidden.clear();
    for (const [d, m] of this.layered) d.layers.mask = m;
    this.layered.clear();
    this.studio.visible = false;
    if (this.savedBackground !== undefined) {
      this.world.game.scene.background = this.savedBackground; this.savedBackground = undefined;
      document.dispatchEvent(new CustomEvent('ws:studio-active', { detail: false }));
    this.world.game.app.events.emit('explore.studio', false);
      this.world.game.app.events.emit('explore.turntable', { on: false });
    }
  }

  /** the turntable's shadow (E115): the shard's cascade spans 80 m at 1024 px on a phone, so a 6 m model got a hand's
   *  width per shadow texel — blocky, swimming as you orbit, and the world's 0.14 m normal bias let light leak past every
   *  edge. While a model is on show the cascade ends just past it, the map is STUDIO_SHADOW_MAP and the bias ~2.5 texels. */
  private shadowSaved: { maxFar: number; bias: number[]; size: number } | null = null;

  private fitShadows(): void {
    const csm = this.world.game.sky.csm;
    if (!this.shadowSaved) {
      this.shadowSaved = { maxFar: csm.maxFar, bias: csm.lights.map((l) => l.shadow.normalBias), size: csm.lights[0]?.shadow.mapSize.x ?? 1024 };
      for (const l of csm.lights) setShadowMapSize(l, STUDIO_SHADOW_MAP);
    }
    const far = this.dist + this.floor.scale.x * 1.4; // the floor disc is scaled to the model's (or the lineup's) radius
    if (Math.abs(far - csm.maxFar) < far * 0.04) return;
    csm.maxFar = far; csm.updateFrustums();
    const texel = (far * 1.6) / STUDIO_SHADOW_MAP; // the cascade's box ≈ the view slice's bounding sphere, ~1.6 × far across
    const saved = this.shadowSaved.bias;
    csm.lights.forEach((l, i) => { l.shadow.normalBias = Math.min(saved[i] ?? 0.05, texel * 2.5); });
  }

  private releaseShadows(): void {
    const s = this.shadowSaved;
    if (!s) return;
    this.shadowSaved = null;
    const csm = this.world.game.sky.csm;
    csm.maxFar = s.maxFar; csm.updateFrustums();
    csm.lights.forEach((l, i) => { l.shadow.normalBias = s.bias[i] ?? l.shadow.normalBias; setShadowMapSize(l, s.size); });
  }

  private frameModel(o: THREE.Object3D): void {
    const box = visibleBox(o);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    // a flat piece seen from one side only (its faces' normals add up to one way, and it is thin that way: a sign board, a
    // roll shutter, a laundry line): opened facing it, a little off-axis; it stands on a smaller disc (a wall piece on a
    // plinth), so the fit is the piece's own width, not a disc wider than it
    const face = oneSided(o);
    const flat = face !== null && Math.abs(face.x) * size.x + Math.abs(face.z) * size.z <= FLAT * (Math.abs(face.z) * size.x + Math.abs(face.x) * size.z);
    this.front = face !== null && flat ? Math.atan2(face.x, face.z) : null;
    this.swayT = 0;
    const r = Math.max(size.x, size.z) * 0.5, disc = Math.max(0.5, r * (this.front === null ? 1.3 : FLAT_DISC));
    this.floor.position.set(centre.x, box.min.y, centre.z);
    this.floor.scale.setScalar(disc);
    this.contact.position.set(centre.x, box.min.y + 0.004, centre.z);
    this.contact.scale.set(Math.max(0.3, size.x * 0.62), 1, Math.max(0.3, size.z * 0.62));
    // what the turntable frames: the model and the disc it stands on (refit), turning round their middle
    this.framed.copy(box).union(new THREE.Box3(new THREE.Vector3(centre.x - disc, box.min.y - 0.06, centre.z - disc), new THREE.Vector3(centre.x + disc, box.min.y, centre.z + disc)));
    this.framed.getCenter(this.target);
    // open on the lit side: the camera sits between the sun and the model, a little off-axis so the form reads
    const sun = this.world.game.sky.sunDir;
    this.yaw = Math.atan2(sun.x, sun.z) + 0.55; this.pitch = 0.3; this.idle = 0;
    if (this.front !== null) this.yaw = this.front + SWAY_OPEN;
  }

  /**
   * The render zone (the band between the top bars and 2/3 of the screen, or the clip / variant rows when they reach
   * higher), the lens shifted onto it, and the model + disc fitted inside it with a margin from every side of the turn.
   * `reset`: the fitted distance; else the zoom keeps its ratio (the screen or the card changed size).
   */
  private refit(reset: boolean): void {
    if (this.current === null || this.el.dataset['view'] !== 'model') return;
    const { camera: cam, canvas } = this.world.game, H = canvas.clientHeight || innerHeight;
    const bottomOf = (s: string): number => { const r = this.el.querySelector(s)?.getBoundingClientRect(); return r && r.height > 0 ? r.bottom : 0; };
    const topOf = (s: string): number => { const r = this.el.querySelector(s)?.getBoundingClientRect(); return r && r.height > 0 ? r.top : H; };
    const top = Math.max(document.querySelector('.ws-x-top')?.getBoundingClientRect().bottom ?? 60, bottomOf('.ws-x-views'), bottomOf('.ws-x-lights')) + 8;
    const rows = this.sheet.classList.contains('creature') || this.sheet.classList.contains('variant') ? topOf('.ws-x-creature') : H;
    const bottom = Math.max(top + 160, Math.min(H * ZONE_BOTTOM, rows - 8, topOf('.ws-x-sheet') - 8));
    this.lensY = (top + bottom) / 2;
    this.zone = { top, bottom };
    this.lens();
    this.scratch.copy(cam); this.scratch.updateProjectionMatrix();
    const turns = this.lineup === null; // (the lineup is seen from one side)
    const win = bandWindow(top, bottom, H, 0.1, 0.72), front = this.front;
    // (a flat piece is fitted over its sway round its front, not all the way round: edge-on it never shows)
    const fit = Math.max(MIN_DIST, turns && front !== null
      ? Math.max(...[-1, -0.5, 0, 0.5, 1].map((k) => fitOrbit(this.framed, this.scratch, this.pitch, win, 1, front + k * SWAY, 0)))
      : fitOrbit(this.framed, this.scratch, this.pitch, win, turns ? 8 : 1, turns ? 0 : this.yaw, 0));
    const k = reset || this.fitDist <= 0 ? 1 : this.dist / this.fitDist;
    this.fitDist = fit; this.dist = fit * k; this.minDist = Math.max(0.4, fit * 0.3); this.maxDist = fit * 3;
    this.el.dataset['fit'] = String(Number(fit.toFixed(2))); // (a capture script reads it)
    if (reset) this.checkFit = this.rigFrames > 0 ? 0 : 4; // (a rig: once its idle loop has been sampled)
  }

  /**
   * A rig's reach over its idle loop (Nalati's Qyran spreads its wings past its rest pose): its first RIG_FRAMES frames on
   * show, every sixth, the posed box widens what is framed (and the fit, the zoom keeping its ratio); then the fit check.
   */
  private sampleRig(e: CatalogEntry): void {
    this.rigFrames--;
    if (this.rigFrames % 6 === 0) {
      const b = visibleBox(e.object());
      // (a pose, not a journey: a rig whose loop carries it far past its first box — Qyran soars up out of its perch — is
      // framed on its reach while it stays within RIG_REACH × that box, else left to leave the frame now and then)
      const grown = new THREE.Box3().copy(this.framed).union(b), now = grown.getSize(new THREE.Vector3());
      if (!b.isEmpty() && !this.framed.containsBox(b) && Math.max(now.x, now.y, now.z) <= RIG_REACH * this.rigBase) {
        this.framed.copy(grown); this.framed.getCenter(this.target); this.refit(false);
      }
    }
    if (this.rigFrames === 0) this.checkFit = 1;
  }

  /** is any vertex of the model on show outside the render zone from where the camera stands now? */
  private clipped(): boolean {
    const e = this.current;
    if (!e) return false;
    const { camera, canvas } = this.world.game, W = canvas.clientWidth || innerWidth, H = canvas.clientHeight || innerHeight;
    const b = visibleBox(e.object()), v = new THREE.Vector3();
    if (b.isEmpty()) return false;
    camera.updateMatrixWorld();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
      const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
      if (x < 0 || x > W || y < this.zone.top || y > this.zone.bottom) return true;
    }
    return false;
  }

  /** the lens on the render zone (again each frame: the other pane may have reset it as the tabs switched) */
  private lens(): void {
    const { camera, canvas } = this.world.game;
    if (lensShift(camera, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, this.lensY)) this.world.game.sky.csm.updateFrustums();
  }

  /**
   * this model's share of the active level's phone frame budget:
   * one copy's, and all its copies' if every one were in the frame (E306)
   */
  private budget(tris: number, calls: number, copies = 1): void {
    const level = activeLevel(), limits = frameBudget(level.id, 'phone', level.budgets);
    const b = { calls: limits.draws ?? Infinity, tris: limits.tris ?? Infinity }, share = tris / b.tris, all = share * copies;
    const pct = (x: number): string => (x * 100).toFixed(x < 0.01 ? 2 : 1);
    const bar = this.sheet.querySelector<HTMLElement>('.ws-x-budget i'), text = this.sheet.querySelector('.ws-x-budget span');
    if (bar) bar.style.width = `${Math.min(100, Math.max(1.5, all * 100))}%`;
    if (text) text.textContent = engineString('s_84b14a244823', [pct(share), copies > 1 ? engineString('s_4f98e74b623b', [pct(all), copies.toLocaleString()]) : '', b.tris / 1e6, calls, b.calls, CURRENT_TIER]);
  }

  private setView(v: View, mark = true): void {
    this.clearTiers();
    // undo the previous swap
    for (const [mesh, mat] of this.swapped) mesh.material = mat;
    this.swapped.clear();
    for (const overlay of this.overlays) {
      overlay.removeFromParent();
      overlay.geometry.dispose(); overlay.material.dispose();
    }
    this.overlays.length = 0;
    this.view = v;
    if (mark) this.sheet.querySelectorAll<HTMLElement>('.ws-x-views button').forEach((b) => { b.classList.toggle('on', b.dataset['v'] === v); });
    const e = this.current;
    if (!e || v === 'solid') return;
    if (v === 'tiers') { this.showTiers(e); return; }
    e.object().traverse((c) => {
      if (!isMesh(c)) return;
      const mat = c.material;
      if (v === 'wire') { this.swapped.set(c, mat); c.material = this.wire(); }
      else if (v === 'paint') { this.swapped.set(c, mat); c.material = Array.isArray(mat) ? mat.map((m) => this.paint(m)) : this.paint(mat); }
      else if (!(c instanceof THREE.SkinnedMesh)) { // facets: the solid model + its triangle edges on top
        const lines = new THREE.LineSegments(new THREE.WireframeGeometry(c.geometry), new THREE.LineBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.35, fog: false, toneMapped: false }));
        lines.matrixAutoUpdate = false; lines.matrix.identity();
        c.add(lines); this.overlays.push(lines);
      }
    });
  }

  // ── creatures (X8): watch clips on a treadmill, variants, skeleton, the lineup ──
  private markClip(): void { this.sheet.querySelectorAll<HTMLElement>('.ws-x-clips button').forEach((b) => { b.classList.toggle('on', b.dataset['c'] === this.clip); }); }

  private playClip(c: Clip): void {
    const e = this.current, a = e?.animal;
    if (!e || !a) return;
    if (!a.alive) { const p = this.pin.get(a); e.rebuild?.(); this.adopt(e, p); } // DIE is undone by a fresh rig
    const live = e.animal;
    if (!live) return;
    const away = new THREE.Vector3().subVectors(live.position, this.world.game.camera.position).setY(0).normalize();
    if (c === 'hit') live.stagger(away, 1);
    else if (c === 'die') live.applyDamage(live.hp + 1, live.position.clone().setY(live.position.y + 0.6), away);
    this.clip = c === 'hit' ? 'idle' : c;
    this.markClip();
  }

  /** a rebuilt rig takes over the old one's pin, the studio and the skeleton */
  private adopt(e: CatalogEntry, p: { x: number; z: number } | undefined): void {
    const a = e.animal;
    if (!a) return;
    if (p) this.pin.set(a, p);
    if (this.skeleton) this.setSkeleton(true);
  }

  private renderVariants(e: CatalogEntry): void {
    const box = this.sheet.querySelector('.ws-x-variants');
    if (!box) return;
    box.replaceChildren();
    for (const v of e.variants ?? []) {
      const b = words('button', '', v.label);
      (b as HTMLButtonElement).type = 'button';
      listenDom(this.uiScope, b, 'click', () => {
        const p = e.animal ? this.pin.get(e.animal) : undefined;
        const view = this.view;
        if (e.release !== undefined) {
          this.setView('solid', false); this.tierBuilds.delete(e.id);
          for (const material of this.paintMats.values()) material.dispose();
          this.paintMats.clear();
        }
        e.rebuild?.(v.id); this.adopt(e, p);
        if (e.release !== undefined) this.setView(view, false);
        if (!e.animal) {
          const m = measure(e.object());
          const set = (key: string, value: string): void => { const el = this.sheet.querySelector<HTMLElement>(`.ws-x-stats b[data-s="${key}"]`); if (el) el.textContent = value; };
          set('tris', m.tris.toLocaleString()); set('calls', String(m.calls)); set('build', `${e.buildMs.toFixed(1)} ms`);
          this.budget(m.tris, m.calls);
        }
        box.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); });
      });
      box.append(b);
    }
    box.firstElementChild?.classList.add('on');
  }

  private setSkeleton(on: boolean, remember = true): void {
    if (remember) { this.skeleton = on; this.sheet.querySelector('.ws-x-skel')?.classList.toggle('on', on); }
    this.skelHelper?.removeFromParent(); this.skelHelper = null;
    const a = this.current?.animal;
    if (!on || !a) return;
    const h = new THREE.SkeletonHelper(a.mesh);
    const m = h.material as THREE.LineBasicMaterial;
    m.depthTest = false; m.transparent = true; m.opacity = 0.95; m.color.set(0x8fe3ff); m.toneMapped = false; m.fog = false;
    h.renderOrder = 999;
    this.studio.add(h);
    this.skelHelper = h;
  }

  /** LINEUP: every creature on one long disc, sorted by height, facing the camera, with 0.5 m height lines */
  private openLineup(): void {
    this.closeModel();
    const creatures = this.entries.filter((e) => e.category === 'creatures');
    const group = new THREE.Group();
    const labels: { a: Animal; el: HTMLElement }[] = [];
    const rows = creatures.map((e) => { e.object(); const a = e.animal; return { e, a, h: a ? new THREE.Box3().setFromObject(a.mesh).getSize(new THREE.Vector3()) : new THREE.Vector3() }; })
      .filter((r): r is { e: CatalogEntry; a: Animal; h: THREE.Vector3 } => r.a !== undefined)
      .sort((p, q) => p.h.y - q.h.y);
    const first = rows[0]?.a;
    if (!first) return;
    const z0 = first.position.z;
    let x = first.position.x, base = Infinity;
    rows.forEach((r, i) => {
      const w = Math.max(r.h.x, r.h.z);
      if (i > 0) x += w * 0.5 + 0.7;
      r.a.place(x, z0, 0.55);
      r.a.sampleTerrain();
      this.pin.set(r.a, { x, z: z0 });
      x += w * 0.5;
      group.add(r.e.object());
      base = Math.min(base, r.a.position.y);
      const m = measure(r.a.mesh);
      const el = html('div', `ws-x-tierlabel ws-x-lineuplabel${i % 2 === 1 ? ' low' : ''}`);
      el.append(words('b', '', r.e.name.replace('Coconut ', '').replace('Drowned ', '').replace('Reef ', '')), words('small', '', `${r.h.y.toFixed(1)} m · ${m.tris.toLocaleString()}`));
      this.sheet.append(el);
      labels.push({ a: r.a, el });
    });
    // height lines every 0.5 m across the row
    const x0 = first.position.x - 1.5, x1 = x + 1.5, pts: number[] = [];
    for (let hgt = 0.5; hgt <= 2.51; hgt += 0.5) pts.push(x0, base + hgt, z0 - 0.8, x1, base + hgt, z0 - 0.8);
    const ruler = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineDashedMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.45, dashSize: 0.18, gapSize: 0.12, fog: false, toneMapped: false }));
    ruler.computeLineDistances();
    group.add(ruler);
    const marks: HTMLElement[] = [];
    for (let hgt = 0.5; hgt <= 2.51; hgt += 0.5) { const el = words('div', 'ws-x-rulemark', `${hgt.toFixed(1)} m`); this.sheet.append(el); marks.push(el); }
    this.studio.add(group);
    const lineup = { group, labels, ruler, marks, base };
    const entry: CatalogEntry = {
      id: 'lineup', name: 'Creature lineup', category: 'creatures', file: 'src/engine/*/entities/species/', live: false, buildMs: 0,
      pipeline: ['code'], copies: rows.length, drawnAs: 'skinned', object: () => group,
      tick: (dt, t) => { for (const r of rows) r.a.update(dt, t, true); },
    };
    this.openModel(entry); // (openModel closes whatever was open first — the lineup is only registered after it)
    this.lineup = lineup;
    this.sheet.classList.remove('creature'); this.sheet.classList.add('lineup');
    // frame the row itself (skinned bounds are loose): its span across the width, the tallest up the height
    const span = x - first.position.x + 1.2, tall = rows.reduce((m, r) => Math.max(m, r.h.y), 0);
    this.yaw = 0.18; this.pitch = 0.14;
    this.framed.set(new THREE.Vector3(first.position.x - 0.6, base, z0 - 1), new THREE.Vector3(x + 0.6, base + tall, z0 + 1));
    this.framed.getCenter(this.target);
    this.floor.position.set(this.target.x, base, z0); this.floor.scale.setScalar(span * 0.62);
    this.refit(true); // (the row, from this one side: it doesn't turn)
  }

  private closeLineup(): void {
    const l = this.lineup;
    if (!l) return;
    this.lineup = null;
    for (const { el } of l.labels) el.remove();
    for (const el of l.marks) el.remove();
    l.ruler.removeFromParent();
    l.group.removeFromParent();
    const kids = l.group.children.slice(); // a copy: add() moves each child out of the array being walked
    for (const c of kids) this.studio.add(c); // the creatures' own groups go back to the studio
  }

  /** DETAIL TIERS: batch members are rebuilt at each tier (withTier) and stood side by side; a live model has one build */
  private showTiers(e: CatalogEntry): void {
    const o = e.object();
    const build = e.buildAt;
    if (!build) { this.explore.toast(engineString('s_ada8c98a5332', [e.name])); return; }
    let byTier = this.tierBuilds.get(e.id);
    if (!byTier) { byTier = new Map(); this.tierBuilds.set(e.id, byTier); }
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
    const gap = Math.max(size.x, size.z) * 0.55 + 0.4; // centre to centre / 2: the two stand shoulder to shoulder on the disc
    o.visible = false;
    TIERS.forEach((tier, i) => {
      let t = byTier.get(tier);
      if (!t) { t = build(tier); byTier.set(tier, t); }
      const k = (i - (TIERS.length - 1) / 2) * gap * 2; // along the camera's right axis, so the two never stand one behind the other
      t.position.set(Math.cos(this.yaw) * k, 0, -Math.sin(this.yaw) * k); // batch members are built in world space: offset from where the one on show stands
      this.studio.add(t);
      const m = measure(t);
      const label = html('div', 'ws-x-tierlabel'); label.append(words('b', '', tier), words('small', '', `${m.tris.toLocaleString()} tris`));
      this.sheet.append(label);
      this.tierShown.push({ tier, o: t, label });
    });
    this.dist *= 1.6;
    this.floor.scale.multiplyScalar(1.7);
  }

  private clearTiers(): void {
    if (this.tierShown.length === 0) return;
    for (const t of this.tierShown) { t.o.removeFromParent(); t.label.remove(); }
    this.tierShown = [];
    if (this.current) { this.current.object().visible = true; this.dist /= 1.6; this.floor.scale.divideScalar(1.7); }
  }

  private wire(): THREE.MeshBasicMaterial { return (this.wireMat ??= new THREE.MeshBasicMaterial({ color: 0xbfefff, wireframe: true, fog: false, toneMapped: false })); }

  /** the model's own colours, unlit: what the vertex paint + baked AO look like without the sun */
  private paint(m: THREE.Material): THREE.MeshBasicMaterial {
    let p = this.paintMats.get(m);
    if (!p) {
      const src = m as THREE.MeshStandardMaterial;
      p = new THREE.MeshBasicMaterial({ vertexColors: src.vertexColors, color: src.color instanceof THREE.Color ? src.color : 0xffffff, map: src.map ?? null, side: src.side, fog: false });
      this.paintMats.set(m, p);
    }
    return p;
  }

  private setLight(i: number): void {
    this.light = i;
    this.sheet.querySelectorAll<HTMLElement>('.ws-x-lights button').forEach((b) => { b.classList.toggle('on', Number(b.dataset['l']) === i); });
    const preset = LIGHTS[i]?.[1];
    if (preset !== undefined) this.clock()?.pin(preset);
  }

  private restoreLight(): void {
    this.clock()?.pin(null);
    this.light = -1;
  }

  // ── input: drag orbit, wheel / pinch zoom (only while a model is on the turntable) ──
  private get onTurntable(): boolean { return this.current !== null && this.el.classList.contains('show'); }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.onTurntable) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    else { this.drag = null; this.pinch = this.spread(); }
    this.idle = 0;
  };

  private spread(): number { const [a, b] = [...this.pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.onTurntable || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom(this.pinch / s);
      this.pinch = s;
      return;
    }
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    this.yaw -= dx * 0.008;
    this.pitch = Math.max(-0.15, Math.min(1.45, this.pitch + dy * 0.006));
    this.idle = 0;
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.drag?.id === e.pointerId) this.drag = null;
    if (this.pointers.size < 2) this.pinch = 0;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.onTurntable) return;
    e.preventDefault();
    this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    this.idle = 0;
  };

  private zoom(k: number): void { this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * k)); }

  update(dt: number): void {
    const { camera } = this.world.game;
    const e = this.current;
    if (e) {
      this.lens();
      this.fitShadows();
      this.idle += dt;
      if (this.idle > 2.5 && !this.drag && this.tierShown.length === 0 && this.lineup === null) { // the turntable turns while you look (not while comparing tiers / the lineup)
        if (this.front === null) this.yaw += dt * 0.22;
        else { // a flat piece sways round its front (the shorter way back to it after a drag)
          this.swayT += (dt * 0.22) / SWAY;
          const d = this.front + SWAY * Math.sin(this.swayT + SWAY_PHASE) - this.yaw;
          this.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, dt * 2);
        }
      }
      const cp = Math.cos(this.pitch);
      camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
      camera.lookAt(this.target);
      if (this.checkFit > 0 && --this.checkFit === 0) this.el.dataset['clip'] = this.clipped() ? 'clip' : 'ok';
      const a = e.animal;
      if (a?.alive === true) a.setMotion(a.yaw, GAIT[this.clip]);
      e.tick?.((this.slow ? 0.5 : 1) * dt, performance.now() / 1000);
      if (this.rigFrames > 0) this.sampleRig(e);
      // the treadmill: whatever the gait, the animal stays on the disc
      for (const [an, p] of this.pin) { an.position.x = p.x; an.position.z = p.z; an.mesh.position.x = p.x; an.mesh.position.z = p.z; }
      const l = this.lineup;
      if (l) {
        for (const { a: an, el } of l.labels) {
          const b = new THREE.Box3().setFromObject(an.mesh), q = b.getCenter(new THREE.Vector3()); q.y = b.max.y;
          q.project(camera);
          el.style.transform = `translate(${Math.round((q.x * 0.5 + 0.5) * innerWidth)}px, ${Math.round((-q.y * 0.5 + 0.5) * innerHeight) - 40}px) translateX(-50%)`;
        }
        l.marks.forEach((el, i) => {
          const pos = l.ruler.geometry.getAttribute('position');
          const q = new THREE.Vector3(pos.getX(i * 2 + 1), pos.getY(i * 2 + 1), pos.getZ(i * 2 + 1)).project(camera); // the right-hand end
          el.style.transform = `translate(${Math.min(innerWidth - 44, Math.round((q.x * 0.5 + 0.5) * innerWidth) - 40)}px, ${Math.round((-q.y * 0.5 + 0.5) * innerHeight) - 13}px)`;
        });
      }
      for (const t of this.tierShown) {
        const b = new THREE.Box3().setFromObject(t.o), p = b.getCenter(new THREE.Vector3()); p.y = b.max.y;
        p.project(camera);
        t.label.style.transform = `translate(${Math.round((p.x * 0.5 + 0.5) * innerWidth)}px, ${Math.round((-p.y * 0.5 + 0.5) * innerHeight) - 34}px) translateX(-50%)`;
      }
      const preset = LIGHTS[this.light]?.[1];
      if (preset !== undefined) this.clock()?.pin(preset); // held while you look
      return;
    }
    // the catalog floats over a slow orbit of the island, like the hub
    this.catalogT += dt * 0.03;
    camera.position.set(Math.sin(this.catalogT + 2) * CHUNK_HALF * 0.92, CHUNK_HALF * 0.42, Math.cos(this.catalogT + 2) * -CHUNK_HALF * 0.92);
    camera.lookAt(0, 4, 0);
    this.frame++;
    if (this.thumbQueue.length > 0 && this.frame % 2 === 0) this.thumbnail();
  }

  /**
   * Render one catalog card through the game's composer. A card whose model throws is reported once and left blank: the
   * throw never reaches the update loop (whose throw switch would stop the whole Explorer), and the card is not queued
   * again until its model is ready again (`ws:model-ready`).
   */
  private thumbnail(): void {
    if (this.pendingThumb !== null) return;
    const e = this.thumbQueue.shift();
    if (!e) return;
    if (e.ready !== undefined) {
      try {
        const root = e.object(); this.pendingThumb = e;
        void this.prepareThumbnail(e, root, this.thumbnailVersion);
      } catch (error) { this.failedThumbs.add(e.id); e.release?.(); console.error(`[explorer] ${e.id}: specimen preparation failed`, error); }
      return;
    }
    this.captureThumbnail(e);
  }

  private async prepareThumbnail(e: CatalogEntry, root: THREE.Object3D, version: number): Promise<void> {
    const host = this.grid.querySelector<HTMLElement>(`.ws-x-model[data-id="${e.id}"] .ws-x-model-thumb`) ?? this.grid;
    const progress = new LoadProgress(host), forget = this.uiScope.capture('disposers', () => { progress.dispose(); });
    let failed = false;
    try {
      await progress.watch(e.name, [e.ready?.() ?? Promise.resolve()]);
      if (version === this.thumbnailVersion && this.el.classList.contains('show') && this.el.dataset['view'] === 'catalog') this.captureThumbnail(e);
    } catch (error) { failed = true; console.error(`[explorer] ${e.id}: thumbnail preparation failed`, error); }
    finally {
      forget(); if (!failed) progress.dispose(); // A failed card keeps its status until the catalogue is closed or rebuilt.
      if (this.current !== e) { this.fresh.delete(root); e.release?.(); }
      if (this.pendingThumb === e) this.pendingThumb = null;
    }
  }

  private captureThumbnail(e: CatalogEntry): void {
    const cam = this.world.game.camera;
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    try {
      this.drawThumbnail(e);
    } catch (error) {
      this.failedThumbs.add(e.id);
      this.unisolate();
      console.error(`[explorer] the card ${e.id} did not build; left blank`, error);
    } finally {
      cam.position.copy(pos); cam.quaternion.copy(quat);
    }
  }

  /** isolate the card's model, frame, draw, copy the canvas, put everything back but the camera */
  private drawThumbnail(e: CatalogEntry): void {
    const { game } = this.world;
    const cam = game.camera;
    const o = e.object();
    if (!e.live && o.parent !== this.studio) { this.studio.add(o); this.fresh.add(o); }
    this.isolate(o);
    this.frameModel(o);
    const cp = Math.cos(this.pitch);
    // the card is a 4:3 centre crop: the model's own box fitted into it, width and height, with a margin
    const bb = new THREE.Box3().setFromObject(o);
    bb.getCenter(this.target);
    const src = game.canvas, k = Math.min(src.width / THUMB_W, src.height / THUMB_H);
    const sw = THUMB_W * k, sh = THUMB_H * k;
    this.scratch.copy(cam); this.scratch.clearViewOffset();
    const d = fitOrbit(bb, this.scratch, this.pitch, { x0: -(sw / src.width) * 0.84, x1: (sw / src.width) * 0.84, y0: -(sh / src.height) * 0.8, y1: (sh / src.height) * 0.8 }, 1, this.yaw, 0);
    cam.position.set(this.target.x + Math.sin(this.yaw) * cp * d, this.target.y + Math.sin(this.pitch) * d, this.target.z + Math.cos(this.yaw) * cp * d);
    cam.lookAt(this.target);
    game.shardFrame(); // the shard's per-frame uniforms for this eye (Nine Dragon's fog), not the last frame's
    game.composer.render(0);
    const c = document.createElement('canvas'); c.width = THUMB_W; c.height = THUMB_H;
    const g = c.getContext('2d');
    if (g) {
      g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, THUMB_W, THUMB_H);
      // the frame is premultiplied and not always opaque: Nine Dragon's materials keep the view depth in alpha for its
      // post chain, so a copy kept those pixels translucent and they came out white once exported (E289). The screen
      // shows the frame over black: flatten it the same way
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#000'; g.fillRect(0, 0, THUMB_W, THUMB_H);
      g.globalCompositeOperation = 'source-over';
    }
    this.thumbs.set(e.id, c);
    this.unisolate();
    if (!e.live) o.removeFromParent();
    const slot = this.grid.querySelector(`.ws-x-model[data-id="${e.id}"] .ws-x-model-thumb`);
    if (slot !== null && slot.querySelector('canvas') === null) slot.append(c);
    const small = this.grid.querySelector(`.ws-x-model[data-id="${e.id}"] small:last-of-type`); // (the first is how it's made)
    if (small && !e.live) small.textContent = engineString('s_4ecdc2db1bc2', [trisLabel(measure(o).tris), e.copies > 1 ? engineString('s_1312908d3788') : '']);
  }
}

/**
 * The box of what a model draws: its visible meshes only (a card's other weapons, a rig's hidden parts don't widen it —
 * Nine Dragon's arms read small on a disc sized for all of them), from their vertices up to 200 k of them (a rig's
 * as posed now), else their geometry's box.
 */
function visibleBox(o: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3(), part = new THREE.Box3(), v = new THREE.Vector3();
  o.updateWorldMatrix(true, true);
  o.traverseVisible((c) => {
    if (!isMesh(c)) return;
    const im = c as Partial<THREE.InstancedMesh & THREE.BatchedMesh>;
    if (im.isBatchedMesh === true) { // (its geometry holds every batched shape in its own frame: the batch's box)
      const m = c as THREE.BatchedMesh;
      m.computeBoundingBox();
      if (m.boundingBox) box.union(part.copy(m.boundingBox).applyMatrix4(c.matrixWorld));
      return;
    }
    if (im.isInstancedMesh === true) {
      const m = c as THREE.InstancedMesh;
      if (m.count === 0) return;
      m.computeBoundingBox();
      if (m.boundingBox) box.union(part.copy(m.boundingBox).applyMatrix4(c.matrixWorld));
      return;
    }
    const pos = c.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (pos === undefined) return;
    // a rig as posed now: its bone matrices are only made at its first render (a fresh creature's vertices collapsed to
    // the world's origin and the camera framed an empty disc), so they are brought up to date here first
    if ((c as Partial<THREE.SkinnedMesh>).isSkinnedMesh === true) {
      const sm = c as THREE.SkinnedMesh, sw = sm.geometry.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      sm.skeleton.update();
      // (three refreshes an attached rig's bindMatrixInverse in updateMatrixWorld, not updateWorldMatrix: without it the
      // posed vertices come back in world space and the box landed a creature's distance from the origin away)
      if (sm.bindMode === THREE.AttachedBindMode) sm.bindMatrixInverse.copy(sm.matrixWorld).invert();
      // (a vertex no bone weighs lands on the world's origin, hundreds of metres from the rig: left out)
      for (let i = 0, step = Math.max(1, Math.floor(pos.count / 40_000)); i < pos.count; i += step) {
        if (sw !== undefined && sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i) < 0.5) continue;
        box.expandByPoint(sm.getVertexPosition(i, v).applyMatrix4(c.matrixWorld));
      }
      return;
    }
    if (pos.count <= 200_000) { for (let i = 0; i < pos.count; i++) box.expandByPoint(c.getVertexPosition(i, v).applyMatrix4(c.matrixWorld)); return; }
    if (c.geometry.boundingBox === null) c.geometry.computeBoundingBox();
    if (c.geometry.boundingBox) box.union(part.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld));
  });
  return box.isEmpty() ? box.setFromObject(o) : box;
}

/**
 * Which way a piece drawn from one side faces (world xz, unit), or null. Its triangles' area vectors are summed: a closed
 * shape's cancel out, a one-sided panel's (a sign board, a shutter, a couplet) add up to its face; a double-sided
 * material's count as area only (they are seen from both sides). A piece counts when that sum's level part is over
 * ONE_SIDED of all its area; a big mesh (over 60 000 triangles) is taken as closed.
 */
function oneSided(o: THREE.Object3D): THREE.Vector3 | null {
  const sum = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Matrix4();
  const meshes: THREE.Mesh[] = [];
  o.updateWorldMatrix(true, true);
  o.traverseVisible((m) => { if (isMesh(m) && (m as Partial<THREE.SkinnedMesh>).isSkinnedMesh !== true && (m as Partial<THREE.BatchedMesh>).isBatchedMesh !== true) meshes.push(m); });
  let area = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined, idx = m.geometry.index;
    if (pos === undefined) continue;
    const tris = Math.floor((idx ? idx.count : pos.count) / 3);
    if (tris > 60_000) return null;
    w.copy(m.matrixWorld);
    if (m instanceof THREE.InstancedMesh) { m.getMatrixAt(0, w); w.premultiply(m.matrixWorld); } // (a specimen's one copy)
    const mats = m.material as THREE.Material | THREE.Material[], mat = Array.isArray(mats) ? mats[0] : mats;
    const side = mat === undefined || mat.side === THREE.DoubleSide ? 0 : mat.side === THREE.BackSide ? -1 : 1;
    for (let t = 0; t < tris; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(w); b.fromBufferAttribute(pos, i1).applyMatrix4(w); c.fromBufferAttribute(pos, i2).applyMatrix4(w);
      n.subVectors(b, a).cross(c.sub(a));
      sum.addScaledVector(n, side); area += n.length();
    }
  }
  sum.y = 0;
  return area <= 0 || sum.length() < ONE_SIDED * area ? null : sum.normalize();
}

/** the studio's backdrop: deep blue at the horizon line, near-black above and below (a canvas the renderer stretches to the screen) */
let backdrop: THREE.CanvasTexture | null = null;
export function studioBackdrop(): THREE.CanvasTexture {
  if (backdrop) return backdrop;
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  if (g) {
    const v = g.createLinearGradient(0, 0, 0, 512);
    v.addColorStop(0, '#04080f'); v.addColorStop(0.42, '#0d2236'); v.addColorStop(0.58, '#123049'); v.addColorStop(1, '#03060b');
    g.fillStyle = v; g.fillRect(0, 0, 256, 512);
    // a soft spotlight behind where the model stands (the midway mockup's studio glow)
    const r = g.createRadialGradient(128, 205, 0, 128, 205, 150);
    r.addColorStop(0, 'rgba(110, 190, 240, 0.34)'); r.addColorStop(0.5, 'rgba(70, 140, 200, 0.12)'); r.addColorStop(1, 'rgba(40, 90, 150, 0)');
    g.fillStyle = r; g.fillRect(0, 0, 256, 512);
  }
  backdrop = new THREE.CanvasTexture(c); backdrop.colorSpace = THREE.SRGBColorSpace;
  return backdrop;
}

/** a cyan grid on the studio floor that fades out radially into the dark */
function fadingGrid(): THREE.CanvasTexture {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  if (g) {
    g.strokeStyle = 'rgba(110, 190, 230, 0.35)'; g.lineWidth = 1;
    const step = n / 20;
    g.beginPath();
    for (let i = 0; i <= 20; i++) { const p = Math.round(i * step) + 0.5; g.moveTo(p, 0); g.lineTo(p, n); g.moveTo(0, p); g.lineTo(n, p); }
    g.stroke();
    g.globalCompositeOperation = 'destination-in';
    const r = g.createRadialGradient(n / 2, n / 2, n * 0.08, n / 2, n / 2, n * 0.5);
    r.addColorStop(0, 'rgba(0,0,0,0.8)'); r.addColorStop(0.4, 'rgba(0,0,0,0.25)'); r.addColorStop(0.75, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** a soft halo just outside the disc's rim */
function rimGlow(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 4;
  const g = c.getContext('2d');
  if (g) {
    const v = g.createLinearGradient(0, 0, 256, 0);
    v.addColorStop(0, 'rgba(143, 227, 255, 0.32)'); v.addColorStop(0.35, 'rgba(143, 227, 255, 0.08)'); v.addColorStop(1, 'rgba(143, 227, 255, 0)');
    g.fillStyle = v; g.fillRect(0, 0, 256, 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a radial dark blob: the soft contact shadow under the model (the sun's CSM shadow lands on the disc too) */
function contactShadow(): THREE.CanvasTexture {
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    r.addColorStop(0, 'rgba(0, 4, 10, 0.85)'); r.addColorStop(0.5, 'rgba(0, 4, 10, 0.45)'); r.addColorStop(1, 'rgba(0, 4, 10, 0)');
    g.fillStyle = r; g.fillRect(0, 0, n, n);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
