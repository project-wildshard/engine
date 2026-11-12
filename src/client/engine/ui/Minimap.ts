import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import type { MapPoi as MapPoiRow } from '@wildshard/format/minimap';
/**
 * Minimap — the circular top-down map top-right of the HUD (mockup B, art/minimap/round-1/minimap-k1-B-terrain.png).
 *
 *   const minimap = new Minimap();                                    // mounts into #hud
 *   minimap.update(player.position, player.yaw, animals.animals);     // every frame
 *   minimap.setVisible(false);
 *
 * North-up (+Z is north, −X is east — the compass band's convention: heading = 180 − yaw°), the
 * player arrow rotates with the yaw, the map scrolls under it. The view covers ±VIEW_RADIUS metres.
 *
 * Layers, back to front:
 *   1. terrain — drawn ONCE into an offscreen canvas covering the whole chunk at LAYER_PPM px/m:
 *      hillshaded ground (heightAt), pond (POND), dirt trails (TRAILS), pine crowns stippled from the
 *      same density noise Forest.ts thins its candidates with, cabin roofs (CABIN_SITES);
 *   2. fog of war — a low-res coverage canvas (COVER_PPM px/m) the player's visited positions stamp a
 *      feathered disc into; unexplored ground shows at FOG_BRIGHTNESS;
 *   3. animal dots — yellow = passive (deer), red = can turn on you (boar, bear: `aggressive`, else the
 *      species registry's flag); a red dot that is charging / stalking / alert (or, without a public state,
 *      wounded) pulses;
 *   3b. marks (`setMarks`): small glass-coloured diamonds a shard asks for — Driftwood's sea chart (E314 stage 2): every
 *      unfound beach sea glass piece; the full map draws the same list;
 *   3c. other players (REMOTE-PLAYERS RP3, `net/othersOnMap.ts`): a magenta teardrop each, nosed the way they face, for every other
 *      live player in the radius; filled by the online world's bodies, empty in single player;
 *   4. the player arrow, a rim vignette. The cyan rim, 45° ticks and "N" are CSS. (The heading readout under the circle is
 *      gone, E51: the arrow already says where you face.)
 *
 * The baked map (SF66, G246 / G247, `MinimapSpec.image`): a level that names its map baked from the world (scripts/bake-maps.mjs
 * renders the shard straight down; a stale one fails test/baked-maps.test.ts) draws that image as layer 1 in place of the
 * painted terrain, on the minimap and the full map alike. It is fetched and decoded into one ImageBitmap the first time the map
 * draws, never painted into a second canvas, and closed when the minimap is disposed or its level changes. Everything drawn over
 * it (fog, animals, marks, the full map's places and quest markers) stays listed data.
 *
 * Nothing is allocated per frame: every canvas, gradient and sprite is built at construction or on resize.
 *
 * A level's own map look (`ChunkMapDef.palette`, MinimapPalette): its ground colours by height / slope / forest mask,
 * its overlay over the ground (in place of the trails, crowns and roofs) and its named places — the full map's pins
 * (main.ts `fullMap.setPois`: named once explored, "?" before). A wolf lying hidden in long grass (`mem.hidden`, Pack.ts)
 * is not on it (the stealth rule).
 */
import { CHUNK_HALF, CHUNK_SIZE, SEED } from '../../../shared/engine/core/config';
import { heightAt, trailDistance, TRAILS, CABIN_SITES, POND, hasPond, pondMask, waterLevel, streamAt } from '../../../shared/engine/world/Heightfield';
import { Noise2D, smoothstep } from '../../../shared/engine/core/noise';
import { Rng } from '../../../shared/engine/core/rng';
import { activeLevel, onLevelChange } from '../../../shared/engine/level/selection';
import { hasSpecies, speciesDef } from '../../../shared/engine/entities/species/registry';
import { app } from '../app/runtime';
import { onOwnerDispose } from '../../../shared/engine/app/ownership';
import { ROOM_BG, arenaMap, fitRoom, paintRoom, type RoomMap } from './roomMap';
import { drawOther, othersOnMap, type OtherMark } from '../net/othersOnMap';

/** the level's baked map while it loads (`image` null) and once decoded; `closed` once released */
interface BakedGround { url: string; image: ImageBitmap | null; closed: boolean; ready: Promise<void> }

/** a point the map marks with a small diamond (Minimap.setMarks) */
export interface MapMark { x: number; z: number; color: string }
const NO_MARKS: readonly MapMark[] = [];

export interface MinimapAnimal {
  kind: string;
  /** charges the player (red dot); default: the species registry's `aggressive` flag for `kind` */
  aggressive?: boolean;
  /** 'rare' / 'legendary' animals get a thin white ring */
  rarity?: string;
  position: { x: number; z: number };
  alive?: boolean;
  hp?: number;
  maxHp?: number;
  state?: string;
  /** Animal.mem — a wolf with `hidden` 1 (lying still in long grass, Pack.ts) is off the map */
  mem?: Record<string, number>;
}

/** a shard's own map features (Minimap.setFeatures) */
export interface MapFeatures {
  trees?: readonly { x: number; z: number; height: number }[];
  /** `rot`: the site's yaw (Ry); `w` × `d` metres (default the cabins' 9 × 7) */
  roofs?: readonly { x: number; z: number; rot: number; w?: number; d?: number }[];
}

/**
 * Extra map content a level supplies each frame (`Minimap.setExtras`), data only, in the same metres as `update`'s
 * position: flat rectangles, square images and text labels around the level's own terrain layer. Its ground is never
 * fogged (the fog of war stays the level's own chunk). Images use the terrain layer's orientation: the image's top edge
 * is +Z (north) and its left edge is +X (west, since −X is east).
 */
export interface MapExtras {
  /** the fill past everything (default the level's `minimap.outside`) */
  readonly outside?: string;
  /** the level's own terrain layer's opacity (default 1; 0 hides it and its fog) */
  readonly baseAlpha?: number;
  readonly rects: readonly MapExtraRect[];
  readonly images: readonly MapExtraImage[];
  readonly labels: readonly MapExtraLabel[];
}
/** an axis-aligned rectangle: its centre and half extents (m) */
export interface MapExtraRect { readonly x: number; readonly z: number; readonly hx: number; readonly hz: number; readonly color: string }
/** a square image: its centre, its side (m) and its opacity */
export interface MapExtraImage { readonly image: CanvasImageSource; readonly x: number; readonly z: number; readonly size: number; readonly alpha: number;
  /** Optional source-pixel rectangle for a tile in a shared image. */
  readonly crop?: readonly [number, number, number, number] }
/** a text label at a point; one past the rim is pinned just inside it, in its direction */
export interface MapExtraLabel { readonly x: number; readonly z: number; readonly text: string; readonly color: string;
  /** Optional cell-local label box in metres, with a shorter overview name. */
  readonly width?: number; readonly height?: number; readonly short?: string }

/** a named place on the maps: the format's row (`@wildshard/format/minimap`); frozen legacy folders still name it here */
type MapPoi = MapPoiRow;
/** what a palette's overlay paints with: the terrain layer's context, world → layer px, px per metre, the trails */
interface MapOverlay {
  ctx: CanvasRenderingContext2D; toU: (x: number) => number; toV: (z: number) => number; ppm: number;
  trails: readonly (readonly [number, number])[][]; half: number;
  /** the chunk's forest mask (ChunkForest.mask), when it has one */
  forestMask: ((x: number, z: number) => number) | undefined;
}
/** a level's own map look (ChunkMapDef.palette, 07 §6.2 step 7): its ground colour at a sample (0..255 sRGB into `out`),
 *  its overlay over the ground (in place of the trails, crowns and roofs), its named places */
export interface MinimapPalette {
  ground: (x: number, z: number, h: number, slope: number, forest: number, out: [number, number, number]) => void;
  overlay?: (o: MapOverlay) => void;
  pois?: () => MapPoi[];
}


const VIEW_RADIUS = 110;          // metres from the player to the rim
/** BA-6: the minimap repaints at most this often, and only when what it shows changed */
const PAINT_HZ = 30;
/** FNV-1a over 32-bit ints: the minimap's view digest (BA-6), no allocation */
const FNV_SEED = 2166136261;
const fold = (h: number, v: number): number => Math.imul(h ^ (v | 0), 16777619);
export const LAYER_PPM = 2;       // terrain layer px per metre (1000 × 1000 for the 500 m chunk)
const HEIGHT_STEP = 2;            // metres between height samples for the ground shading
const COVER_PPM = 0.5;            // fog coverage px per metre (1 px per 2 m)
const REVEAL_RADIUS = 45;         // metres a visited position reveals
const STAMP_EVERY = 4;            // metres moved between coverage stamps
const FONT_ASK_PAINTS = 30;       // paints between two asks whether the label font has loaded (until it has)
const FOG_BRIGHTNESS = 0.3;       // unexplored ground brightness
const DESKTOP_SIZE = 144;         // css px, the fallback before layout (the stylesheet sets it: 144 px desktop, 27.2vw phone — E51, 80 % of 180 / 34vw)

// palette — the game's muted ground tones (see the mockup): olive grass, grey rock, khaki dirt, slate water
const GRASS_LO: RGB = [104, 118, 58], GRASS_HI: RGB = [150, 158, 84];   // olive meadow, lighter with altitude
const FLOOR: RGB = [72, 78, 44];                                            // forest floor under the canopy
const ROCK: RGB = [122, 118, 108];
const WATER = '#3b607c', WATER_EDGE = '#2a4458';
// still + running water drawn by depth (the pond's real shore, its islet, the creek): slate shallows → deep slate blue
const WATER_SHALLOW: RGB = [92, 132, 152], WATER_DEEP: RGB = [46, 80, 110];
const TRAIL_EDGE = 'rgba(80, 64, 44, 0.85)', TRAIL = '#a08a66';
const CROWN_DARK = '#2b4229', CROWN_MID = '#3c5a34', CROWN_LIGHT = '#66864a', CROWN_SHADOW = 'rgba(18, 34, 20, 0.5)';
const ROOF = '#74523a', ROOF_RIDGE = '#9a7a58', ROOF_SHADOW = 'rgba(0, 0, 0, 0.45)';
const VOID = '#0b1016';
const DOT_PASSIVE = '#ffe066', DOT_AGGRESSIVE = '#ff5a4a', DOT_OUTLINE = 'rgba(6, 10, 18, 0.9)';
const ARROW = '#ffffff';

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number, out: RGB) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };

function canvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D { const ctx = c.getContext('2d'); if (!ctx) throw new Error('Minimap: no 2d context'); return ctx; }
/**
 * drawImage of the source window (sx, sy, sw, sh) into (dx, dy, dw, dh), the window first cut to the source's bounds and the
 * destination cut to match. WebKit (Safari, playtest round 3) draws nothing at all when an ImageBitmap's source window runs
 * past its edge, where Chromium clips it: near a chunk edge the baked map's minimap window always does.
 */
function drawWindow(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement | ImageBitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(src.width, sx + sw), y1 = Math.min(src.height, sy + sh);
  if (x1 <= x0 || y1 <= y0) return;
  const kx = dw / sw, ky = dh / sh;
  ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
}

const SVG_SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><path d="M12 2.2v3M12 18.8v3M2.2 12h3M18.8 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const SVG_MOON = '<svg viewBox="0 0 24 24"><path d="M15.5 3.2a8.8 8.8 0 1 0 5.3 13.9A7.2 7.2 0 0 1 15.5 3.2z" fill="currentColor"/></svg>';

export class Minimap {
  readonly scope: ReturnType<typeof uiScope> = uiScope('Minimap');
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nLabel: HTMLSpanElement;

  /** the painted terrain layer, made only for a level with no baked map (the baked image is the layer then) */
  private painted: HTMLCanvasElement | null = null;
  private layerDirty = true;
  /** last paint time of the terrain layer, ms */
  paintMs = 0;
  /** the level's baked map (MinimapSpec.image): its URL, and the decoded image once it is ready */
  private baked: BakedGround | null = null;

  private cover = canvas(Math.ceil(CHUNK_SIZE * COVER_PPM), Math.ceil(CHUNK_SIZE * COVER_PPM));
  private coverCtx = ctx2d(this.cover);
  private stamp: HTMLCanvasElement;
  private lastStampX = Number.NaN; private lastStampZ = Number.NaN;

  private fog = canvas(1, 1);
  private fogCtx = ctx2d(this.fog);
  private vignette: CanvasGradient | null = null;

  private size = 0;      // device px, square
  private dpr = 1;
  /** each extra label's outlined text, rasterized once at the screen's density and font (re-made when either changes) */
  private readonly labelSprites = new Map<string, { readonly canvas: HTMLCanvasElement; readonly half: number }>();
  /** the label font once document.fonts has it, and the paints left before it is asked again while it has not */
  private readyFont = '';
  private fontAskIn = 0;
  private visible = true;
  /** a practice room's own map while one is up (the arena, a playground: src/client/engine/ui/roomMap.ts, E321) — the shard's is not drawn */
  private roomMap: RoomMap | null = null;
  private ro: ResizeObserver | null = null;

  constructor(parent: HTMLElement | null = document.getElementById('hud')) {
    this.root = document.createElement('div');
    this.root.className = 'ws-minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ws-minimap-canvas';
    this.nLabel = document.createElement('span');
    this.nLabel.className = 'ws-minimap-n';
    this.nLabel.textContent = engineString('s_8ce86a6ae65d');
    this.root.append(this.canvas, this.nLabel);
    mountUi(this.root, this.scope, parent ?? document.body);
    this.ctx = ctx2d(this.canvas);

    this.stamp = this.buildStamp();
    this.layerDirty = true;
    // a dev page swapping its chunk in place: a new map. In the game several shards are resident (E155) and a change is a
    // switch between them — this map's shard, its drawn layer and its explored fog stay as they are
    onOwnerDispose(onLevelChange(() => { if (app.levelScope !== null) return; this.layerDirty = true; this.clearCoverage(); }));
    this.scope.onDispose(() => { this.releaseBaked(); this.releasePainted(); });

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(this.root);
      this.scope.onDispose(() => { this.ro?.disconnect(); });
    }
    this.fit();
  }

  /** The ground layer (the baked map, else the painted terrain; null while the baked map loads) and the fog coverage, for
   *  the full map (src/client/engine/ui/Map.ts). */
  get layers(): { terrain: HTMLCanvasElement | ImageBitmap | null; cover: HTMLCanvasElement } { return { terrain: this.ground(), cover: this.cover }; }
  /** is the ground the baked map? (the full map then draws it as it is: no painted zoom tiles) */
  get bakedGround(): boolean { if (this.layerDirty) this.ground(); return this.baked !== null; }
  /** the baked map's decoded bytes held now (RGBA), for the memory readouts */
  get bakedBytes(): number { const img = this.baked?.image; return img ? img.width * img.height * 4 : 0; }

  /**
   * A shard's own map features (Pine Hollow, C9) for the painted ground: its real trees and extra roofs. A level with a baked
   * map shows them from the world itself, so they only matter on the painted terrain.
   */
  setFeatures(f: MapFeatures): void { this.features = f; if (this.baked === null) this.layerDirty = true; }
  private features: MapFeatures = {};

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  /** Replace the shard terrain with the enclosed 100 m practice room while training (null: the shard's map again). */
  setPracticeArena(center: { x: number; z: number } | null): void { this.setRoom(center === null ? null : arenaMap(center)); }

  /** Replace the shard's map with a practice room's own (a playground's track / course, E321); null: the shard's again.
   *  `.practice` on the root hides what belongs to the shard's map (the day badge, the elite skulls: minimap.css). */
  setRoom(map: RoomMap | null): void {
    this.roomMap = map;
    this.root.classList.toggle('practice', map !== null);
  }
  /** the room whose map is up (the full map draws it too), or null on the shard */
  get room(): RoomMap | null { return this.roomMap; }

  /** small diamonds at world points, read every frame (Driftwood's sea chart: the unfound sea glass, E314); null clears.
   *  The full map (src/client/engine/ui/Map.ts) draws the same list. Not drawn over a practice room's map. */
  setMarks(source: (() => readonly MapMark[]) | null): void { this.markSource = source; }
  /** Additional scoped marks coexist with the base map source. */
  addMarks(source: () => readonly MapMark[]): () => void {
    this.markSources.add(source);
    return () => { this.markSources.delete(source); };
  }
  private readonly markSources = new Set<() => readonly MapMark[]>();
  get marks(): readonly MapMark[] {
    if (this.roomMap !== null) return NO_MARKS;
    const base = this.markSource?.() ?? NO_MARKS;
    return this.markSources.size === 0 ? base : [...base, ...[...this.markSources].flatMap((source) => source())];
  }
  private markSource: (() => readonly MapMark[]) | null = null;

  /** Extra content around the level's own terrain each frame (MapExtras, data only); null clears it. */
  setExtras(source: (() => MapExtras | null) | null): void { this.extrasSource = source; }
  private extrasSource: (() => MapExtras | null) | null = null;

  /** has the player been near (x, z)? — the fog-of-war coverage (a place on the full map is named once explored, else "?") */
  explored(x: number, z: number): boolean {
    const px = Math.floor((CHUNK_HALF - x) * COVER_PPM), pz = Math.floor((CHUNK_HALF - z) * COVER_PPM);
    if (px < 0 || pz < 0 || px >= this.cover.width || pz >= this.cover.height) return false;
    return (this.coverCtx.getImageData(px, pz, 1, 1).data[3] ?? 0) > 128;
  }

  /** Forget everything explored (a new chunk, a respawn to a fresh shard). */
  clearCoverage(): void {
    this.coverCtx.clearRect(0, 0, this.cover.width, this.cover.height);
    this.lastStampX = this.lastStampZ = Number.NaN;
  }

  dispose(): void { this.ro?.disconnect(); this.root.remove(); this.releaseBaked(); this.releasePainted(); }

  /** the ground now: the level's baked map once decoded (null while it loads), else the painted layer. The level is read
   *  only when the layer is dirty (construction, a dev page's level change), never per frame: a grid crossing keeps it */
  private ground(): HTMLCanvasElement | ImageBitmap | null {
    if (this.layerDirty) {
      const url = activeLevel().minimap.image;
      if (url === undefined) { this.releaseBaked(); this.paintLayer(); }
      else {
        this.layerDirty = false;
        if (this.baked?.url !== url) { this.releasePainted(); this.loadBaked(url); }
      }
    }
    return this.baked !== null ? this.baked.image : this.painted;
  }
  private loadBaked(url: string): void {
    this.releaseBaked();
    const entry: BakedGround = { url, image: null, closed: false, ready: Promise.resolve() };
    this.baked = entry;
    entry.ready = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const image = await createImageBitmap(await res.blob());
        if (entry.closed) { image.close(); return; }
        entry.image = image; this.layerGen++;
      } catch (error) { if (!entry.closed) console.warn(`[minimap] the baked map ${url} did not load:`, error); }
    })();
  }
  /** L15: start the level's map now and resolve once it can draw (the baked image decoded, or failed; a painted layer at
   *  once), so the loader hands over to a filled minimap rather than an empty ring for the decode's few hundred ms */
  prepare(): Promise<void> { this.ground(); return this.baked?.ready ?? Promise.resolve(); }
  private releaseBaked(): void {
    const b = this.baked; if (b === null) return;
    b.closed = true; b.image?.close(); b.image = null; this.baked = null; this.layerGen++;
  }
  private releasePainted(): void { if (this.painted !== null) { this.painted.width = this.painted.height = 0; this.painted = null; } }

  /**
   * The day badge (a shard's `ShardManifest.hud.dayBadge`; Nalati — N16 wave 6, the user's pick: no text): the sun or the moon
   * in a small glass notch on the rim at 4 o'clock, from the world clock (`activeClock()`), redrawn only on a change.
   */
  showDayBadge(): void {
    if (this.day !== null) return;
    const el = document.createElement('i');
    el.className = 'ws-minimap-day';
    this.root.append(el);
    this.day = { el, body: '', phase: '' };
  }
  private day: { el: HTMLElement; body: string; phase: string } | null = null;
  private paintDay(): void {
    const d = this.day, c = app.world.dayCycle;
    if (d === null || c === null) return;
    if (c.body !== d.body) { d.body = c.body; d.el.innerHTML = c.body === 'sun' ? SVG_SUN : SVG_MOON; d.el.classList.toggle('moon', c.body === 'moon'); }
    if (c.dayPhase !== d.phase) { d.phase = c.dayPhase; d.el.dataset['phase'] = c.dayPhase; }
  }

  // ── per frame ──
  update(pos: { x: number; z: number }, yaw: number, animals: readonly MinimapAnimal[]): void {
    if (!this.visible) return;
    if (this.size === 0) this.fit();
    if (this.size === 0) return;
    if (this.roomMap !== null) { this.paintRoom(pos, yaw, this.roomMap); return; }
    this.paintDay();
    const overlay = this.extrasSource?.() ?? null, baseAlpha = overlay?.baseAlpha ?? 1;
    // A replacement overlay can hide this base entirely. Keep its dirty layer lazy
    // until visible; painting an unseen terrain must not stall the live frame.
    const ground = baseAlpha > 0 ? this.ground() : null;

    // heading, for the player arrow — the compass band's convention (HUD.ts): +Z is north, turning left decreases it
    let deg = 180 - (yaw * 180) / Math.PI; deg = ((deg % 360) + 360) % 360;

    // fog of war: stamp the visited position every STAMP_EVERY metres
    if (Number.isNaN(this.lastStampX) || Math.hypot(pos.x - this.lastStampX, pos.z - this.lastStampZ) >= STAMP_EVERY) {
      this.lastStampX = pos.x; this.lastStampZ = pos.z;
      const r = this.stamp.width / 2;
      this.coverCtx.drawImage(this.stamp, (CHUNK_HALF - pos.x) * COVER_PPM - r, (CHUNK_HALF - pos.z) * COVER_PPM - r);
    }

    // BA-6 (MF7, battery): repaint only when what the map shows changed, at most PAINT_HZ; a hostile's pulsing ring animates
    const marks = this.marks, t = app.clock.real * 1000; // the engine clock (ms), not a raw timer
    const D = this.size, c = D / 2, k = D / (2 * VIEW_RADIUS); // device px per metre
    const others = othersOnMap.inView(pos, c, k, VIEW_RADIUS);
    const hash = this.signature(pos, deg, animals, marks, baseAlpha, others);
    const pulsing = this.hotInView;
    const same = hash === this.paintedHash && ground === this.paintedGround && overlay === this.paintedOverlay;
    if (same && !pulsing) return;
    if (t - this.paintedAt < 1000 / PAINT_HZ) return;
    this.paintedHash = hash; this.paintedGround = ground; this.paintedOverlay = overlay; this.paintedAt = t;

    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = overlay?.outside ?? activeLevel().minimap.outside ?? VOID; ctx.fillRect(0, 0, D, D); // the island's sea runs on past the chunk edge (the pier spawn looks off it)
    if (overlay !== null) this.paintExtraGround(overlay, pos, c, k);

    // 1. terrain (the baked map or the painted layer), the player centred, north up (layer u = (HALF − x) · ppm so east (−X)
    // is screen right); nothing while the baked map loads
    if (baseAlpha > 0) {
      if (ground !== null) {
        const gp = ground.width / CHUNK_SIZE, lr = VIEW_RADIUS * gp; // the ground's px per metre (2 for both today)
        ctx.globalAlpha = baseAlpha;
        drawWindow(ctx, ground, (CHUNK_HALF - pos.x) * gp - lr, (CHUNK_HALF - pos.z) * gp - lr, lr * 2, lr * 2, 0, 0, D, D);
        ctx.globalAlpha = 1;
      }

      // 2. fog: black at (1 − brightness), punched out where the coverage canvas is opaque (with an overlay: inside the chunk only)
      const fc = this.fogCtx, cr = VIEW_RADIUS * COVER_PPM;
      fc.globalCompositeOperation = 'copy'; // replaces last frame's fog rather than stacking on it
      fc.fillStyle = `rgba(0, 0, 0, ${(1 - FOG_BRIGHTNESS) * baseAlpha})`;
      fc.fillRect(0, 0, D, D);
      fc.globalCompositeOperation = 'destination-out';
      drawWindow(fc, this.cover, (CHUNK_HALF - pos.x) * COVER_PPM - cr, (CHUNK_HALF - pos.z) * COVER_PPM - cr, cr * 2, cr * 2, 0, 0, D, D);
      if (overlay === null) ctx.drawImage(this.fog, 0, 0);
      else {
        const x0 = c - (CHUNK_HALF - pos.x) * k, y0 = c - (CHUNK_HALF - pos.z) * k, side = CHUNK_SIZE * k;
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, side, side); ctx.clip(); ctx.drawImage(this.fog, 0, 0); ctx.restore();
      }
    }

    // 3. animals
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    const dot = 1.75 * this.dpr, outline = this.dpr;
    ctx.lineWidth = outline;
    for (const a of animals) {
      if (a.alive === false || (a.hp !== undefined && a.hp <= 0) || a.mem?.['hidden'] === 1) continue;
      const dx = a.position.x - pos.x, dz = a.position.z - pos.z;
      if (dx * dx + dz * dz > VIEW_RADIUS * VIEW_RADIUS) continue;
      const sx = c - dx * k, sy = c - dz * k;
      const aggressive = a.aggressive ?? (hasSpecies(a.kind) && speciesDef(a.kind).aggressive === true);
      const hot = aggressive && (a.state !== undefined ? (a.state === 'charge' || a.state === 'stalk' || a.state === 'alert') : (a.hp !== undefined && a.maxHp !== undefined && a.hp < a.maxHp));
      const r = hot ? dot * (1 + 0.5 * pulse) : dot;
      if (hot) {
        ctx.beginPath(); ctx.arc(sx, sy, r + 3 * this.dpr * (0.5 + pulse), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 90, 74, ${0.35 * (1 - pulse)})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = aggressive ? DOT_AGGRESSIVE : DOT_PASSIVE; ctx.fill();
      ctx.strokeStyle = DOT_OUTLINE; ctx.stroke();
      if (a.rarity === 'rare' || a.rarity === 'legendary') {   // a thin white ring marks the trophies
        ctx.beginPath(); ctx.arc(sx, sy, r + 2.2 * this.dpr, 0, Math.PI * 2);
        ctx.strokeStyle = a.rarity === 'legendary' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'; ctx.stroke();
        ctx.strokeStyle = DOT_OUTLINE;
      }
    }

    // 3b. marks (the sea chart's sea glass): a small diamond in the piece's colour, dark-outlined
    if (marks.length > 0) {
      const mr = 3.2 * this.dpr;
      ctx.lineWidth = 1.2 * this.dpr; ctx.strokeStyle = DOT_OUTLINE;
      for (const m of marks) {
        const dx = m.x - pos.x, dz = m.z - pos.z;
        if (dx * dx + dz * dz > VIEW_RADIUS * VIEW_RADIUS) continue;
        const sx = c - dx * k, sy = c - dz * k;
        ctx.beginPath(); ctx.moveTo(sx, sy - mr); ctx.lineTo(sx + mr, sy); ctx.lineTo(sx, sy + mr); ctx.lineTo(sx - mr, sy); ctx.closePath();
        ctx.fillStyle = m.color; ctx.fill(); ctx.stroke();
      }
    }

    if (overlay !== null && overlay.labels.length > 0) this.paintExtraLabels(overlay.labels, pos, c, k);

    // 3c. other players (RP3): over the creatures and marks, under the own arrow
    for (const other of others) drawOther(ctx, other.sx, other.sy, other.angle, this.dpr);

    // 4. the player arrow (heading is clockwise from north; canvas rotate() is clockwise on screen)
    ctx.translate(c, c); ctx.rotate((deg * Math.PI) / 180);
    const s = this.dpr;
    ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(5 * s, 6 * s); ctx.lineTo(0, 3 * s); ctx.lineTo(-5 * s, 6 * s); ctx.closePath();
    ctx.fillStyle = ARROW; ctx.strokeStyle = DOT_OUTLINE; ctx.lineWidth = 1.5 * s; ctx.lineJoin = 'round';
    ctx.stroke(); ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // rim vignette
    if (this.vignette) { ctx.fillStyle = this.vignette; ctx.fillRect(0, 0, D, D); }
    ctx.restore();
  }

  // BA-6: what the last paint showed (a numeric digest of the view, plus the layers by identity)
  private paintedHash = Number.NaN; private paintedAt = -Infinity;
  private paintedGround: HTMLCanvasElement | ImageBitmap | null = null; private paintedOverlay: MapExtras | null = null;
  private hotInView = false;
  /** A digest of everything the paint reads that can move, in device pixels: the player (half a pixel, 0.5 deg), the size and fade, each animal and
   *  mark and other player in view. Sets `hotInView` when a hostile's ring pulses (that animates, so it repaints at PAINT_HZ). */
  private signature(pos: { x: number; z: number }, deg: number, animals: readonly MinimapAnimal[], marks: readonly MapMark[], alpha: number, others: readonly OtherMark[]): number {
    // in device pixels: a dot or the terrain only repaints when it visibly moves (the player to half a pixel)
    const k = this.size / (2 * VIEW_RADIUS);
    let h = fold(fold(fold(fold(fold(FNV_SEED, Math.round(pos.x * k * 2)), Math.round(pos.z * k * 2)), Math.round(deg * 2)), this.size), Math.round(alpha * 100));
    let pulse = false;
    for (const a of animals) {
      if (a.alive === false || (a.hp !== undefined && a.hp <= 0) || a.mem?.['hidden'] === 1) continue;
      const dx = a.position.x - pos.x, dz = a.position.z - pos.z;
      if (dx * dx + dz * dz > VIEW_RADIUS * VIEW_RADIUS) continue;
      h = fold(fold(fold(h, Math.round(dx * k)), Math.round(dz * k)), a.rarity === 'legendary' ? 2 : a.rarity === 'rare' ? 1 : 0);
      const aggressive = a.aggressive ?? (hasSpecies(a.kind) && speciesDef(a.kind).aggressive === true);
      if (aggressive && (a.state !== undefined ? (a.state === 'charge' || a.state === 'stalk' || a.state === 'alert') : (a.hp !== undefined && a.maxHp !== undefined && a.hp < a.maxHp))) pulse = true;
    }
    h = fold(h, marks.length);
    for (const m of marks) h = fold(fold(fold(h, Math.round(m.x * k)), Math.round(m.z * k)), m.color.length);
    h = fold(h, others.length); // others are in device px already; their nose to 3 degrees
    for (const o of others) h = fold(fold(fold(h, Math.round(o.sx)), Math.round(o.sy)), Math.round((o.angle * 60) / Math.PI));
    this.hotInView = pulse;
    return h;
  }

  /** an overlay's rectangles and images, under the level's own terrain (screen x = c − (x − pos.x) · k, y = c − (z − pos.z) · k) */
  private paintExtraGround(o: MapExtras, pos: { x: number; z: number }, c: number, k: number): void {
    const ctx = this.ctx, reach = VIEW_RADIUS;
    for (const r of o.rects) {
      if (Math.abs(r.x - pos.x) > r.hx + reach || Math.abs(r.z - pos.z) > r.hz + reach) continue;
      ctx.fillStyle = r.color;
      ctx.fillRect(c - (r.x + r.hx - pos.x) * k, c - (r.z + r.hz - pos.z) * k, 2 * r.hx * k, 2 * r.hz * k);
    }
    for (const m of o.images) {
      const h = m.size / 2;
      if (m.alpha <= 0 || Math.abs(m.x - pos.x) > h + reach || Math.abs(m.z - pos.z) > h + reach) continue;
      ctx.globalAlpha = Math.min(1, m.alpha);
      const x = c - (m.x + h - pos.x) * k, y = c - (m.z + h - pos.z) * k;
      if (m.crop === undefined) ctx.drawImage(m.image, x, y, m.size * k, m.size * k);
      else ctx.drawImage(m.image, ...m.crop, x, y, m.size * k, m.size * k);
    }
    ctx.globalAlpha = 1;
  }

  /** the extras' labels, dark-outlined; one past the rim is pinned just inside it, and one toward the left or right
   *  rim turns to run along it (so a long name never crosses the arrow) */
  private paintExtraLabels(labels: readonly MapExtraLabel[], pos: { x: number; z: number }, c: number, k: number): void {
    const ctx = this.ctx, s = this.dpr, inner = VIEW_RADIUS - 9;
    const font = `700 ${Math.round(7.5 * s)}px Rajdhani, 'Bahnschrift', 'DIN Alternate', sans-serif`, loaded = this.fontLoaded(font);
    for (const l of labels) {
      let dx = l.x - pos.x, dz = l.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > inner) { dx *= inner / d; dz *= inner / d; }
      const sprite = this.labelSprite(l.text.toUpperCase(), l.color, font, loaded), half = sprite.half;
      let sx = c - dx * k, sy = c - dz * k, turn = 0;
      if (Math.abs(dx) > Math.abs(dz) && Math.abs(dx) * k > c * 0.5) {
        turn = sx < c ? -Math.PI / 2 : Math.PI / 2; // along the left / right rim
        const chord = Math.max(half, Math.sqrt(Math.max(0, c * c - (sx - c) ** 2)) - 6 * s);
        sy = Math.min(c + chord - half, Math.max(c - chord + half, sy));
      } else {
        const chord = Math.max(half, Math.sqrt(Math.max(0, c * c - (sy - c) ** 2)) - 6 * s); // the text stays inside the disc at its row
        sx = Math.min(c + chord - half, Math.max(c - chord + half, sx));
      }
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(turn);
      ctx.drawImage(sprite.canvas, -sprite.canvas.width / 2, -sprite.canvas.height / 2);
      ctx.restore();
    }
  }
  /**
   * Whether the label font has loaded: remembered once it has, and until then asked every FONT_ASK_PAINTS paints, not on
   * each (WebKit matches the whole font list on every `check`: 160 of 5980 samples of a steady Nalati Simulator profile).
   */
  private fontLoaded(font: string): boolean {
    if (font === this.readyFont) return true;
    if (this.fontAskIn > 0) { this.fontAskIn--; return false; }
    if (document.fonts.check(font)) { this.readyFont = font; return true; }
    this.fontAskIn = FONT_ASK_PAINTS; return false;
  }
  /** one label's dark-outlined text as drawn on the disc (centred), its half width for the rim placement */
  private labelSprite(text: string, color: string, font: string, loaded: boolean): { readonly canvas: HTMLCanvasElement; readonly half: number } {
    const key = `${font}\0${String(loaded)}\0${color}\0${text}`, had = this.labelSprites.get(key);
    if (had !== undefined) return had;
    if (this.labelSprites.size >= 128) this.labelSprites.clear();
    const s = this.dpr, surface = document.createElement('canvas'), sprite = ctx2d(surface);
    sprite.font = font; const half = sprite.measureText(text).width / 2, pad = Math.ceil(3 * s);
    surface.width = 2 * Math.ceil(half + pad); surface.height = 2 * Math.ceil(Math.round(7.5 * s) * 0.75 + pad);
    sprite.font = font; sprite.textAlign = 'center'; sprite.textBaseline = 'middle'; sprite.lineJoin = 'round'; sprite.lineWidth = 3 * s;
    sprite.strokeStyle = DOT_OUTLINE; sprite.strokeText(text, surface.width / 2, surface.height / 2);
    sprite.fillStyle = color; sprite.fillText(text, surface.width / 2, surface.height / 2);
    const made = { canvas: surface, half }; this.labelSprites.set(key, made); return made;
  }

  private paintRoom(pos: { x: number; z: number }, yaw: number, map: RoomMap): void {
    const D = this.size, c = D / 2, ctx = this.ctx;
    ctx.clearRect(0, 0, D, D);
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = ROOM_BG; ctx.fillRect(0, 0, D, D);
    paintRoom(ctx, map, fitRoom(map, D, D, true), pos, yaw, this.dpr);
    ctx.restore();
  }

  // ── sizing ──
  private fit(): void {
    const css = this.root.clientWidth || DESKTOP_SIZE;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const D = Math.round(css * dpr);
    if (D === this.size && dpr === this.dpr) return;
    this.size = D; this.dpr = dpr; this.labelSprites.clear();
    this.canvas.width = this.canvas.height = D;
    this.fog.width = this.fog.height = D;
    this.fogCtx = ctx2d(this.fog);
    const g = this.ctx.createRadialGradient(D / 2, D / 2, D * 0.3, D / 2, D / 2, D / 2);
    g.addColorStop(0, 'rgba(6, 10, 18, 0)'); g.addColorStop(1, 'rgba(6, 10, 18, 0.45)');
    this.vignette = g;
  }

  private buildStamp(): HTMLCanvasElement {
    const r = Math.ceil(REVEAL_RADIUS * COVER_PPM);
    const c = canvas(r * 2, r * 2), x = ctx2d(c);
    const g = x.createRadialGradient(r, r, r * 0.45, r, r, r);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2);
    return c;
  }

  // ── the terrain layer (once) ──
  private paintLayer(): void {
    const t0 = performance.now();
    this.layerDirty = false;
    this.crowns = null;
    this.layerGen++;
    this.painted ??= canvas(CHUNK_SIZE * LAYER_PPM, CHUNK_SIZE * LAYER_PPM);
    this.paintRegion(ctx2d(this.painted), 0, 0, CHUNK_SIZE, this.painted.width, HEIGHT_STEP);
    this.paintMs = performance.now() - t0;
  }

  /** bumps every time the terrain is redrawn (a new chunk): the full map's zoom tiles are stale then */
  layerGen = 0;
  /**
   * Paint a square of the map at any resolution — the full map's sharp tiles when zoomed in (src/client/engine/ui/Map.ts).
   * The square is in map metres from the chunk's NE corner (u = HALF − x, east → right; v = HALF − z, north → up),
   * `sizeM` metres a side into a `px` × `px` canvas, the ground sampled every ~2 px (at least 1/8 m).
   */
  paintTile(target: HTMLCanvasElement, u0: number, v0: number, sizeM: number, px: number): void {
    if (this.layerDirty) this.ground();
    if (target.width !== px || target.height !== px) { target.width = px; target.height = px; }
    const ctx = ctx2d(target);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    this.paintRegion(ctx, u0, v0, sizeM, px, Math.max(0.125, (2 * sizeM) / px));
  }

  /** the pine crowns as (u, v, r) metre triples — the same Rng walk every time, so a tile draws the crowns the layer does */
  private crowns: number[] | null = null;
  private crownList(): number[] {
    if (this.crowns) return this.crowns;
    const real = this.features.trees;
    if (real && real.length > 0) {
      const out: number[] = [];
      for (const t of real) if (Math.abs(t.x) < CHUNK_HALF && Math.abs(t.z) < CHUNK_HALF) out.push(CHUNK_HALF - t.x, CHUNK_HALF - t.z, Math.max(1.4, t.height * 0.15));
      this.crowns = out;
      return out;
    }
    const F = activeLevel().forest, density = new Noise2D(SEED + 5);
    if (!F) { this.crowns = []; return this.crowns; } // a treeless shard (no ShardManifest.forest): no crowns
    const rng = new Rng(SEED + 4242);
    const cell = 5, half = CHUNK_HALF - 6;
    const cabinR = 12;
    const crowns: number[] = [];
    for (let x = -half; x < half; x += cell) for (let z = -half; z < half; z += cell) {
      const cx = x + rng.range(-cell * 0.5, cell * 0.5), cz = z + rng.range(-cell * 0.5, cell * 0.5);
      const d = density.fbm(cx * F.densityFreq, cz * F.densityFreq, 3);
      const keep = smoothstep(F.clearings[0], F.clearings[1], d) * 0.92 + 0.08;
      if (rng.next() > keep * 0.9) continue;
      const roadEntry = (Math.abs(cx) < 16 && Math.abs(cz) > CHUNK_HALF - 95) || (Math.abs(cz) < 16 && Math.abs(cx) > CHUNK_HALF - 95);
      if (roadEntry) continue;
      if (trailDistance(cx, cz) < 8 + rng.range(0, 4)) continue;
      if (hasPond() && Math.hypot(cx - POND.x, cz - POND.z) < POND.r + 4) continue;
      let onPad = false;
      for (const c of CABIN_SITES) if (Math.hypot(cx - c.x, cz - c.z) < cabinR) { onPad = true; break; }
      if (onPad) continue;
      crowns.push(CHUNK_HALF - cx, CHUNK_HALF - cz, 3.4 + rng.range(0, 2.6));
    }
    this.crowns = crowns;
    return crowns;
  }

  /** the terrain over map square (u0, v0, sizeM metres) into `ctx` at px × px; ground sampled every `step` metres */
  private paintRegion(ctx: CanvasRenderingContext2D, u0: number, v0: number, sizeM: number, px: number, step: number): void {
    const ppm = px / sizeM, k = ppm / LAYER_PPM; // k: the layer's pixel-sized details (shadow offsets) scale with it
    const toU = (x: number): number => (CHUNK_HALF - x - u0) * ppm;   // east (−X) → right
    const toV = (z: number): number => (CHUNK_HALF - z - v0) * ppm;   // north (+Z) → up

    // ground: sample heights on a `step` grid (one sample of margin each side, so tiles shade seamlessly), hillshade from
    // the sampled slopes, upscale smoothly
    const N = Math.ceil(sizeM / step) + 1, M = N + 2;
    const h = step >= HEIGHT_STEP ? new Float32Array(M * M) : this.smoothHeights(u0, v0, step, M);
    if (step >= HEIGHT_STEP) for (let j = 0; j < M; j++) { const z = CHUNK_HALF - v0 - (j - 1) * step; for (let i = 0; i < M; i++) h[j * M + i] = heightAt(CHUNK_HALF - u0 - (i - 1) * step, z); }
    const [hMin, hMax] = this.heightRange();
    const img = new ImageData(N, N), data = img.data, col: RGB = [0, 0, 0];
    const lx = -0.55, ly = 0.65, lz = -0.52; // light from the upper-left of the map (north-west), fairly low
    const level = activeLevel();
    const F = level.forest;
    const ocean = level.minimap.openWater ?? null; // open-water shard: sea by depth, sand where the floor breaks the surface, no forest
    const SEA_DEEP: RGB = [22, 74, 128], SEA_SHALLOW: RGB = [78, 196, 214], SAND: RGB = [226, 206, 150];
    const palette = level.minimap.palette ?? null;   // a level's own map look: its ground colours, its overlay, no pines / cabins
    const forestMask = palette ? level.forest?.mask : undefined;
    const density = new Noise2D(SEED + 5);   // Forest.ts thins its tree candidates with this field: groves are dark floor, clearings meadow
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = CHUNK_HALF - u0 - i * step, wz = CHUNK_HALF - v0 - j * step;
      const c = (j + 1) * M + i + 1;
      const dhx = ((h[c + 1] ?? 0) - (h[c - 1] ?? 0)) / (2 * step);
      const dhy = ((h[c + M] ?? 0) - (h[c - M] ?? 0)) / (2 * step);
      const inv = 1 / Math.hypot(dhx, dhy, 1);
      const nx = -dhx * inv, ny = inv, nz = -dhy * inv;
      const shade = 0.6 + 0.4 * Math.max(0, nx * lx + ny * ly + nz * lz) / Math.hypot(lx, ly, lz);
      const slope = 1 - ny;
      const hij = h[c] ?? 0;
      const alt = (hij - hMin) / Math.max(1, hMax - hMin);
      let sh = shade;
      if (palette) {
        palette.ground(wx, wz, hij, slope, forestMask?.(wx, wz) ?? 0, col);
      } else if (ocean) {
        const depth = ocean.level - hij;
        if (depth > 0) { mix(SEA_SHALLOW, SEA_DEEP, smoothstep(0, ocean.deepDepth, depth), col); sh = 1; }
        else { mix(SAND, GRASS_HI, smoothstep(1.5, 8, -depth), col); mix(col, ROCK, smoothstep(0.14, 0.4, slope), col); }
      } else {
        const grove = F ? smoothstep(F.clearings[0], F.clearings[1], density.fbm(wx * F.densityFreq, wz * F.densityFreq, 3)) : 0;
        mix(GRASS_LO, GRASS_HI, alt, col);
        mix(col, FLOOR, grove * 0.8, col);
        mix(col, ROCK, smoothstep(0.14, 0.4, slope), col);
        // water by depth: the pond inside its basin (its real shore, the islet stays land), the creek's running surface
        const still = pondMask(wx, wz) > 0 ? waterLevel() - hij : -1;
        const run = streamAt(wx, wz), wd = Math.max(still, run === null ? -1 : run - hij);
        if (wd > 0.02) { mix(WATER_SHALLOW, WATER_DEEP, smoothstep(0.1, 2.5, wd), col); sh = 0.88 + 0.12 * shade; }
      }
      const o = (j * N + i) * 4;
      data[o] = col[0] * sh; data[o + 1] = col[1] * sh; data[o + 2] = col[2] * sh; data[o + 3] = 255;
    }
    const small = canvas(N, N); ctx2d(small).putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const cellPx = step * ppm; // sample i sits at u0 + i·step: centre each texel on its sample
    ctx.drawImage(small, 0, 0, N, N, -cellPx / 2, -cellPx / 2, N * cellPx, N * cellPx);

    // pond: a drawn disc only where the ground pass has no basin to paint by depth (the pond's real shore is above)
    if (hasPond() && (palette !== null || ocean !== null || pondMask(POND.x, POND.z) <= 0)) {
      const u = toU(POND.x), v = toV(POND.z), r = POND.r * ppm;
      ctx.beginPath(); ctx.arc(u, v, r * 1.12, 0, Math.PI * 2); ctx.fillStyle = WATER_EDGE; ctx.fill();
      const g = ctx.createRadialGradient(u - r * 0.3, v - r * 0.3, r * 0.1, u, v, r);
      g.addColorStop(0, '#4d7592'); g.addColorStop(1, WATER);
      ctx.beginPath(); ctx.arc(u, v, r * 0.98, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    }

    if (palette) { palette.overlay?.({ ctx, toU, toV, ppm, trails: TRAILS, half: CHUNK_HALF, forestMask }); return; }
    if (ocean) return; // an open-water level: the sea and its islands, no trails, crowns or roofs
    // trails: a dark bed with a lighter dirt centre
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (w: number, style: string): void => {
      ctx.lineWidth = w * ppm; ctx.strokeStyle = style; ctx.beginPath();
      for (const poly of TRAILS) { poly.forEach(([x, z], i) => (i ? ctx.lineTo(toU(x), toV(z)) : ctx.moveTo(toU(x), toV(z)))); }
      ctx.stroke();
    };
    stroke(8, TRAIL_EDGE); stroke(5, TRAIL);

    // pine crowns (shadows go under every crown, so two passes), only those that touch the square
    const crowns = this.crownList();
    const sprite = this.buildCrownSprite(Math.ceil(6 * ppm));
    const touches = (u: number, v: number, r: number): boolean => u + r > 0 && v + r > 0 && u - r < px && v - r < px;
    ctx.fillStyle = CROWN_SHADOW;
    for (let i = 0; i < crowns.length; i += 3) {
      const u = ((crowns[i] ?? 0) - u0) * ppm, v = ((crowns[i + 1] ?? 0) - v0) * ppm, r = (crowns[i + 2] ?? 0) * ppm;
      if (!touches(u, v, r * 1.6)) continue;
      ctx.beginPath(); ctx.arc(u + 1.5 * ppm, v + 1.5 * ppm, r * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < crowns.length; i += 3) {
      const u = ((crowns[i] ?? 0) - u0) * ppm, v = ((crowns[i + 1] ?? 0) - v0) * ppm, r = (crowns[i + 2] ?? 0) * ppm;
      if (touches(u, v, r)) ctx.drawImage(sprite, u - r, v - r, r * 2, r * 2);
    }

    // cabin roofs: a rotated rectangle with a ridge line and a soft shadow
    const roofs: readonly { x: number; z: number; rot: number; w?: number; d?: number }[] = [...CABIN_SITES, ...(this.features.roofs ?? [])];
    for (const c of roofs) {
      const w = (c.w ?? 9) * ppm, dpt = (c.d ?? 7) * ppm;
      ctx.save();
      ctx.translate(toU(c.x), toV(c.z));
      ctx.rotate(-c.rot); // Ry(rot) turns +x toward −z; on screen (u, v) = (−x, −z) that is anticlockwise, canvas rotate() is clockwise
      ctx.fillStyle = ROOF_SHADOW; ctx.fillRect(-w / 2 + 2 * k, -dpt / 2 + 3 * k, w, dpt);
      ctx.fillStyle = ROOF; ctx.fillRect(-w / 2, -dpt / 2, w, dpt);
      ctx.fillStyle = ROOF_RIDGE; ctx.fillRect(-w / 2, -k, w, 2 * k);
      ctx.restore();
    }
  }

  /**
   * Heights for a zoom tile finer than the ground's own ~2 m grid: sampled every HEIGHT_STEP, then Catmull-Rom
   * interpolated to the fine `step` grid (M × M, one sample of margin), so slopes stay smooth — sampling heightAt
   * directly shades its bilinear 2 m cells as stair-steps along every cliff and shore.
   */
  private smoothHeights(u0: number, v0: number, step: number, M: number): Float32Array {
    const HS = HEIGHT_STEP;
    const cu0 = Math.floor((u0 - 2 * step) / HS) * HS - HS, cv0 = Math.floor((v0 - 2 * step) / HS) * HS - HS;
    const C = Math.ceil((M * step + 4 * step) / HS) + 6;
    const g = new Float32Array(C * C);
    for (let b = 0; b < C; b++) { const z = CHUNK_HALF - (cv0 + b * HS); for (let a = 0; a < C; a++) g[b * C + a] = heightAt(CHUNK_HALF - (cu0 + a * HS), z); }
    // per axis: the first of the four coarse nodes and their Catmull-Rom weights, for each fine sample
    const axis = (origin: number, start: number): { idx: Int32Array; w: Float32Array } => {
      const idx = new Int32Array(M), w = new Float32Array(M * 4);
      for (let k = 0; k < M; k++) {
        const t = (start + (k - 1) * step - origin) / HS, ia = Math.floor(t), f = t - ia, f2 = f * f, f3 = f2 * f;
        idx[k] = Math.min(C - 4, Math.max(0, ia - 1));
        w[k * 4] = (-f + 2 * f2 - f3) / 2; w[k * 4 + 1] = (2 - 5 * f2 + 3 * f3) / 2; w[k * 4 + 2] = (f + 4 * f2 - 3 * f3) / 2; w[k * 4 + 3] = (f3 - f2) / 2;
      }
      return { idx, w };
    };
    const U = axis(cu0, u0), V = axis(cv0, v0);
    const h = new Float32Array(M * M);
    for (let j = 0; j < M; j++) {
      const vb = V.idx[j] ?? 0;
      for (let i = 0; i < M; i++) {
        const ua = U.idx[i] ?? 0;
        let sum = 0;
        for (let b = 0; b < 4; b++) {
          const row = (vb + b) * C + ua;
          const r = (g[row] ?? 0) * (U.w[i * 4] ?? 0) + (g[row + 1] ?? 0) * (U.w[i * 4 + 1] ?? 0) + (g[row + 2] ?? 0) * (U.w[i * 4 + 2] ?? 0) + (g[row + 3] ?? 0) * (U.w[i * 4 + 3] ?? 0);
          sum += r * (V.w[j * 4 + b] ?? 0);
        }
        h[j * M + i] = sum;
      }
    }
    return h;
  }

  /** the chunk's lowest and highest ground on the HEIGHT_STEP grid — the altitude tint is relative to it, the same in every tile */
  private hRange: [number, number] | null = null;
  private heightRange(): [number, number] {
    if (this.hRange && this.hRangeGen === this.layerGen) return this.hRange;
    let lo = Infinity, hi = -Infinity;
    for (let z = -CHUNK_HALF; z <= CHUNK_HALF; z += HEIGHT_STEP) for (let x = -CHUNK_HALF; x <= CHUNK_HALF; x += HEIGHT_STEP) {
      const v = heightAt(x, z); if (v < lo) lo = v; if (v > hi) hi = v;
    }
    this.hRange = [lo, hi]; this.hRangeGen = this.layerGen;
    return this.hRange;
  }
  private hRangeGen = -1;

  private crownSprites = new Map<number, HTMLCanvasElement>();
  private buildCrownSprite(r: number): HTMLCanvasElement {
    const hit = this.crownSprites.get(r); if (hit) return hit;
    const c = canvas(r * 2, r * 2), x = ctx2d(c);
    this.crownSprites.set(r, c);
    const g = x.createRadialGradient(r * 0.7, r * 0.7, 0, r, r, r);
    g.addColorStop(0, CROWN_LIGHT); g.addColorStop(0.4, CROWN_MID); g.addColorStop(1, CROWN_DARK);
    x.fillStyle = g; x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.fill();
    return c;
  }
}
