import { capturePointer } from '../input/dom';
import { app } from '../app/runtime';
import type { UiHandle } from './layers';
import type { Scope } from '../../../shared/engine/app/scope';
import { uiScope, mountUi } from './ownership';
import { currentOwner } from '../../../shared/engine/app/ownership';
import { engineString } from '../../../shared/engine/strings';
/**
 * The full map — the MAP tab of the in-game menu (src/client/engine/ui/Menu.ts): tap the minimap or press M.
 *
 * The whole 500 m chunk, north-up, drawn from the Minimap's own ground layer — the shard's map baked from the world (SF66,
 * `MinimapSpec.image`), else the painted terrain (hillshade, pond, trails, crowns, cabin roofs) — with the same fog of war;
 * points of interest named (the shard's own list, else its manifest's places, else the cabins and the pond); your arrow. No
 * animal markers — the map is for finding your way, not for finding prey.
 * Zoomed in, a painted ground is repainted sharp: TILE_PX tiles at the screen's own px/m (Minimap.paintTile), a few per
 * frame over the stretched layer, cached (E97: the 2 px/m layer alone went to mush at 4–6×). A baked map is drawn as it is.
 * Around the chunk, `setExtras` lays out more ground as data (the grid: every cell's baked map at its cell, the road network
 * and each shard's name; SF66), and the view then spans all of it.
 * Drag to pan, pinch or wheel to zoom (1× = the chunk fitted to the frame, up to 6×). The world
 * keeps running underneath; the canvas swallows touch so the pads don't move you.
 *
 *   const fullMap = new FullMap(minimap);   // builds the canvas only
 *   fullMap.mount(frame)                    // the menu puts it in its map frame (Menu.ts); show()/hide() are the menu's
 *   fullMap.setZoom(2) / fullMap.zoom / fullMap.onZoom / fullMap.fit()
 *   fullMap.setPois(() => MapPoi[])        // a shard's own points of interest (Driftwood: its places with discovery + the
 *                                          // quest's markers, src/shards/driftwood-isle/quest/Places.ts); unset = the cabins / pond as before
 *   fullMap.setPois(src, { tally: true })  // + "PLACES n / N" (found / all places) in the frame's bottom-left corner (E309 A)
 *   (the minimap's marks, Minimap.setMarks — Driftwood's sea chart — are drawn here too: small ringed beads, no label)
 *   fullMap.setQuest(() => MapQuest|null)  // the quest in full — title, objective, sub-steps — for the MAP tab's card (E51)
 *   fullMap.setZones(MapZone[])            // the shard's zone names under the pins (Pine Hollow, PH-C9)
 *   fullMap.setFeatures({ trees, roofs })  // the shard's real trees + extra roofs on the ground layer (Minimap.setFeatures)
 *
 * Labels (E130 C): a quest marker is labelled with its short name behind a small cyan ◆ (the glyph says "a shard / goal waits
 * here" instead of the word); a marker at a place of the same name puts its ◆ on that place's label (an undiscovered one then
 * shows the marker's name, not "?"). An undiscovered place is a dashed cyan ring with a "?" inside (E309 A: the dim "?" read
 * as noise on the phone). Every label is laid out against the others, the markers and your arrow: it tries below,
 * above, right, left, then a line further, and takes the first spot that is free.
 */
import { CHUNK_HALF, CHUNK_SIZE } from '../../../shared/engine/core/config';
import { CABIN_SITES, POND, hasPond } from '../../../shared/engine/world/Heightfield';
import { activeLevel } from '../../../shared/engine/level/selection';
import type { MapExtras, MapFeatures, Minimap } from './Minimap';
import { MapPainter } from './mapPainter';

/** a point on the full map: a discovered place (named), an undiscovered one ("?"), or a live quest marker (pulsing diamond);
 *  `short` = a quest marker's short name ("SEA CAVE" for "SEA CAVE SHARD") — the map labels it with that */
export interface MapPoi { x: number; z: number; label: string; kind: 'place' | 'unknown' | 'quest'; short?: string }
/** the quest in full for the MAP tab's quest card (the HUD only shows its short chip, E51): chapter title, objective, sub-steps */
export interface MapQuest { title: string; objective: string; hint: string }
/** a zone's name on the full map (setZones) */
export interface MapZone { x: number; z: number; label: string }

/** 1× fits everything the map spans; the closest zoom shows as much ground as 6× of one chunk */
const ZOOM_MIN = 1, ZOOM_CHUNK_MAX = 6;
const CYAN = '#8fe3ff';
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => { const ctx = c.getContext('2d'); if (!ctx) throw new Error('FullMap: no 2d context'); return ctx; };

export class FullMap {
  readonly scope: ReturnType<typeof uiScope> = uiScope('FullMap');
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: UiHandle | null = null;
  private openScope: Scope | null = null;
  private get open(): boolean { return this.layer?.active === true; }
  // view: world point at the frame centre + zoom
  private cx = 0; private cz = 0; private _zoom = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0; private pinchZoom = 1;
  onToggle?: (open: boolean) => void;
  private poiSource: (() => MapPoi[]) | null = null;
  private questSource: (() => MapQuest | null) | null = null;
  /** the zoom changed (pinch / wheel / setZoom) — the menu's zoom chips follow */
  onZoom?: (zoom: number) => void;

  private minimap: Minimap;
  constructor(minimap: Minimap) {
    this.minimap = minimap;
    this.scope.onDispose(() => { this.painter = null; });
    this.root = document.createElement('div');
    this.root.className = 'ws-gmenu-mapcanvas';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', display: 'none', pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', overflow: 'hidden' } as CSSStyleDeclaration);
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' } as CSSStyleDeclaration);
    this.ctx = ctx2d(this.canvas);
    this.root.append(this.canvas);

    // pan / pinch
    this.scope.listen(this.canvas, 'pointerdown', (e) => { capturePointer(this.canvas, e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pointers.size === 2) { this.pinchDist = this.dist(); this.pinchZoom = this.zoom; } });
    this.scope.listen(this.canvas, 'pointermove', (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (this.pointers.size === 1) { this.panBy(e.clientX - p.x, e.clientY - p.y); }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinchDist > 0) { const d = this.dist(); this.zoomTo(this.pinchZoom * (d / this.pinchDist), this.mid()); }
    });
    const end = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinchDist = 0; };
    this.scope.listen(this.canvas, 'pointerup', end); this.scope.listen(this.canvas, 'pointercancel', end);
    this.scope.listen(this.canvas, 'wheel', (e) => { e.preventDefault(); this.zoomTo(this._zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY }); }, { passive: false });
  }

  /** put the map in its frame (the menu's MAP tab); the frame is the map's viewport */
  mount(frame: HTMLElement): void { mountUi(this.root, this.scope, frame); }
  /** the minimap as a button: `onTap` (the menu opens on the Map tab) */
  bindMinimap(onTap: () => void): void {
    const m = this.minimap.root;
    m.style.pointerEvents = 'auto';
    m.style.cursor = 'pointer';
    app.ui.push('hud', { root: m, embedded: true, order: 6, back: () => undefined }, this.scope); // above the touch layer, with no overlay input owner
    this.scope.listen(m, 'pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    this.scope.listen(m, 'pointerup', (e) => { e.stopPropagation(); onTap(); });
  }

  get isOpen(): boolean { return this.open; }
  /** replace the default points of interest (cabins, pond) with the shard's own list, read every frame the map is open.
   *  (`declutter` is kept for its callers: every label is laid out apart now, E130 — NALATI-MERGE F11's elder included) */
  setPois(source: () => MapPoi[], opts: { declutter?: boolean; tally?: boolean } = {}): void {
    this.poiSource = source; this.tally = opts.tally === true;
    // SF57: a shard's list (and the world it closes over) goes with its owner — a resident's, through its ownedFacade —
    // and a replaced list's hold is dropped at once, so no owner keeps more than the latest
    this.forgetPois(); this.forgetPois = holdUntilOwnerDispose(() => { if (this.poiSource === source) { this.poiSource = null; this.tally = false; } });
  }
  private forgetPois = (): void => undefined;
  /** Quest overlays keep the base places and tally intact. */
  addPois(source: () => MapPoi[]): () => void {
    this.poiSources.add(source);
    return () => { this.poiSources.delete(source); };
  }
  private readonly poiSources = new Set<() => MapPoi[]>();
  private tally = false;
  private dash: number[] = [3, 2.5];
  /** the shard's zone names (Pine Hollow: THE RIDGE, THE OLD-GROWTH, …), big faint caps under the pins up to 2.5× */
  setZones(zones: readonly MapZone[]): void { this.zones = zones; }
  private zones: readonly MapZone[] = [];
  /** the shard's real trees + extra roofs for the ground layer (Minimap.setFeatures) */
  setFeatures(f: MapFeatures): void { this.minimap.setFeatures(f); }
  /** More ground around the chunk, read every frame the map is open (data only, in the same metres as `update`'s position):
   *  its rectangles and images under the chunk, its labels over them; the view spans them all. null clears it. */
  setExtras(source: (() => MapExtras | null) | null): void { this.extrasSource = source; }
  private extrasSource: (() => MapExtras | null) | null = null;
  /** the shard's quest, read by the menu each time the MAP tab shows (null = no quest card) */
  setQuest(source: () => MapQuest | null): void {
    this.questSource = source;
    this.forgetQuest(); this.forgetQuest = holdUntilOwnerDispose(() => { if (this.questSource === source) this.questSource = null; });
  }
  private forgetQuest = (): void => undefined;
  /** Scoped cards may retire in any order without resurrecting a disposed quest. */
  addQuest(source: () => MapQuest | null): () => void {
    this.questSources.push(source);
    return () => { const i = this.questSources.indexOf(source); if (i !== -1) this.questSources.splice(i, 1); };
  }
  private readonly questSources: (() => MapQuest | null)[] = [];
  get quest(): MapQuest | null { return this.minimap.room !== null ? null : (this.questSources.at(-1) ?? this.questSource)?.() ?? null; }
  /** a practice room's own map is up (the minimap's, E321): the MAP tab shows it — in the arena / a playground too */
  get hasRoom(): boolean { return this.minimap.room !== null; }
  get zoom(): number { return this._zoom; }
  /** zoom about the frame centre (the menu's 1× / 2× / 4× chips) */
  setZoom(z: number): void { const r = this.canvas.getBoundingClientRect(); this.zoomTo(z, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
  show(): void {
    if (this.open) return;
    this.openScope = this.scope.child('open');
    this.layer = app.ui.push('gameMenu', { root: this.root, embedded: true, order: 0, back: () => { this.hide(); } }, this.openScope);
    this.root.style.display = 'block';
    this.preparePainter();
    const b = this.bounds(this.extrasSource?.() ?? null);
    this.cx = (b.x0 + b.x1) / 2; this.cz = (b.z0 + b.z1) / 2; this._zoom = 1;
    this.fit();
    // E440: the map drives its own draw while open. The menu that shows it pauses the app (Menu.open), and a paused
    // app runs no update phase (Game.runPhase, E357 F8), so a draw driven from the play loop never came and the frame stayed black.
    // FC4 (G909): each frame only checks; the painter repaints when what it shows changed
    const scope = this.openScope;
    const frame = (): void => { if (this.painter?.draw() === true) this.syncPulses(); scope.raf(frame); };
    scope.raf(frame);
    this.onToggle?.(true);
    this.onZoom?.(1);
  }
  hide(): void { if (!this.open) return; this.layer?.dispose(); this.layer = null; this.openScope?.dispose(); this.openScope = null; this.root.style.display = 'none'; this.pointers.clear(); for (const ring of this.rings.splice(0)) ring.remove(); this.onToggle?.(false); }

  private dpr = 1;
  /** size the canvas to its frame (call after the frame resizes) */
  fit(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.dash = [3 * this.dpr, 2.5 * this.dpr];
    this.painter?.invalidate();
  }
  /** the world square the map spans (metres): the chunk, grown to hold every extra */
  private bounds(extras: MapExtras | null): { x0: number; x1: number; z0: number; z1: number; span: number } {
    let x0 = -CHUNK_HALF, x1 = CHUNK_HALF, z0 = -CHUNK_HALF, z1 = CHUNK_HALF;
    for (const r of extras?.rects ?? []) { x0 = Math.min(x0, r.x - r.hx); x1 = Math.max(x1, r.x + r.hx); z0 = Math.min(z0, r.z - r.hz); z1 = Math.max(z1, r.z + r.hz); }
    for (const m of extras?.images ?? []) { const h = m.size / 2; x0 = Math.min(x0, m.x - h); x1 = Math.max(x1, m.x + h); z0 = Math.min(z0, m.z - h); z1 = Math.max(z1, m.z + h); }
    return { x0, x1, z0, z1, span: Math.max(x1 - x0, z1 - z0) };
  }
  private span(): number { return this.bounds(this.extrasSource?.() ?? null).span; }
  private zoomMax(): number { return ZOOM_CHUNK_MAX * this.span() / CHUNK_SIZE; }
  /** screen px (device) per metre at the current zoom */
  private ppm() { return (Math.min(this.canvas.width, this.canvas.height) * 0.9 / this.span()) * this._zoom; }
  private pair(): [{ x: number; y: number }, { x: number; y: number }] { const [a, b] = [...this.pointers.values()]; if (!a || !b) throw new Error('FullMap: pinch needs two pointers'); return [a, b]; }
  private dist(): number { const [a, b] = this.pair(); return Math.hypot(a.x - b.x, a.y - b.y); }
  private mid(): { x: number; y: number } { const [a, b] = this.pair(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  private panBy(dxCss: number, dyCss: number) {
    const k = this.dpr / this.ppm();
    this.cx += dxCss * k;  // screen right = world −X (the minimap's convention: −X is east)
    this.cz += dyCss * k;  // screen down = world −Z
    this.clamp();
  }
  private zoomTo(z: number, aroundClient: { x: number; y: number }) {
    const nz = Math.min(this.zoomMax(), Math.max(ZOOM_MIN, z));
    // keep the world point under the finger fixed
    const before = this.toWorld(aroundClient);
    this._zoom = nz;
    const after = this.toWorld(aroundClient);
    this.cx += before.x - after.x; this.cz += before.z - after.z;
    this.clamp();
    this.onZoom?.(nz);
  }
  /** client (viewport) CSS px → world; the canvas may sit anywhere in the page */
  private toWorld(client: { x: number; y: number }) {
    const r = this.canvas.getBoundingClientRect();
    const ppm = this.ppm(), W = this.canvas.width, H = this.canvas.height;
    return { x: this.cx - ((client.x - r.left) * this.dpr - W / 2) / ppm, z: this.cz - ((client.y - r.top) * this.dpr - H / 2) / ppm };
  }
  private clamp() {
    const b = this.bounds(this.extrasSource?.() ?? null), m = (b.span / 2) * (1 - 0.5 / this._zoom), mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    this.cx = Math.max(mx - m, Math.min(mx + m, this.cx)); this.cz = Math.max(mz - m, Math.min(mz + m, this.cz));
  }

  private readonly pose = { x: 0, z: 0, yaw: 0 };
  /** Every frame of play: where you are. The map draws from it on its own frames while open (show), paused or not. */
  update(pos: { x: number; z: number }, yaw: number): void { this.pose.x = pos.x; this.pose.z = pos.z; this.pose.yaw = yaw; }

  private painter: MapPainter | null = null;
  private preparePainter(): void {
    if (this.painter !== null || this.scope.disposed) return;
    this.painter = new MapPainter({
      canvas: this.canvas, ctx: this.ctx, minimap: this.minimap, pose: this.pose, poiSources: this.poiSources,
      open: () => this.open, _zoom: () => this._zoom, cx: () => this.cx, cz: () => this.cz,
      dpr: () => this.dpr, dash: () => this.dash, zones: () => this.zones,
      pois: () => this.poiSource?.() ?? null, fallbackPois: levelPins, extras: () => this.extrasSource?.() ?? null,
      tally: () => this.tally, ppm: () => this.ppm(), now: () => performance.now(),
    });
  }

  // FC4: the quest pins' pulse, as rings the compositor animates over the canvas, so the pulse never repaints the map
  private readonly rings: HTMLElement[] = [];
  private syncPulses(): void {
    const pulses = this.painter?.pulses ?? [], d = this.dpr;
    while (this.rings.length > pulses.length) this.rings.pop()?.remove();
    for (const [i, p] of pulses.entries()) {
      let ring = this.rings[i];
      if (ring === undefined) {
        ring = document.createElement('div');
        Object.assign(ring.style, { position: 'absolute', boxSizing: 'border-box', borderRadius: '50%', border: '2px solid rgb(143, 227, 255)', pointerEvents: 'none' } as CSSStyleDeclaration);
        ring.animate([{ transform: 'scale(1)', opacity: 0.7 }, { transform: `scale(${2.8 / 1.2})`, opacity: 0 }], { duration: 1600, iterations: Infinity }); // the canvas ring's r x 1.2 -> x 2.8
        this.root.append(ring); this.rings.push(ring);
      }
      const r = (p.r * 1.2) / d + 1; // the canvas stroke sat on the radius; the border sits inside the box
      Object.assign(ring.style, { left: `${p.x / d - r}px`, top: `${p.y / d - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
    }
  }

}


/** a pin as the map draws it: a MapPoi, with a dot colour for the built-in cabins / pond */
type Pin = MapPoi & { color?: string };
/** the pins a level shows when its shard sets none (`setPois`): its listed places (LevelSpec.pois), else the cabins and the
 *  pond of its terrain (test/map-coverage.test.ts: every listed place is on the map) */
export function levelPins(): Pin[] {
  const pois = activeLevel().pois;
  if (pois !== undefined && pois.length > 0) return pois.map((p): Pin => ({ x: p.x, z: p.z, label: p.name.toUpperCase(), kind: 'place', color: CYAN }));
  return [
    ...CABIN_SITES.map((c, i): Pin => ({ x: c.x, z: c.z, label: engineString('s_a5912d0f68ef', [i + 1]), kind: 'place', color: '#8fe3ff' })),
    ...(hasPond() ? [{ x: POND.x, z: POND.z, label: engineString('s_5dddbb894d63'), kind: 'place', color: '#6fb8e8' } satisfies Pin] : []),
  ];
}
/** Run `release` when the current owner disposes; the returned function drops that hold early (a superseded source). */
function holdUntilOwnerDispose(release: () => void): () => void {
  return currentOwner()?.capture('disposers', release) ?? ((): void => undefined);
}
