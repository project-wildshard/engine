import { CHUNK_HALF, CHUNK_SIZE } from '../../../shared/engine/core/config';
import { engineString } from '../../../shared/engine/strings';
import { LAYER_PPM, type MapExtras, type Minimap } from './Minimap';
import { ROOM_BG, fitRoom, paintRoom } from './roomMap';
import { fitMapLabel } from './mapLabel';
import type { MapPoi, MapZone } from './Map';

type Pin = MapPoi & { color?: string };
const FOG_BRIGHTNESS = 0.3, TILE_PX = 256, TILE_CACHE = 64, TILE_BUDGET_MS = 6;
const CYAN = '#8fe3ff', MERGE_M = 30;
const NO_DASH: number[] = [];
const FNV_SEED = 2166136261;
const fold = (h: number, v: number): number => Math.imul(h ^ (v | 0), 16777619);
/** a headless DOM (tests) has no FontFaceSet */
const fontsLoaded = (): boolean => 'fonts' in document && document.fonts.status === 'loaded';

/** State and caller-owned sources remain in FullMap. The painter reads them
 * directly without re-registering or snapshotting callbacks. */
export interface MapPaintView {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly minimap: Minimap;
  readonly open: () => boolean;
  readonly _zoom: () => number;
  readonly cx: () => number;
  readonly cz: () => number;
  readonly dpr: () => number;
  readonly dash: () => number[];
  readonly pose: { readonly x: number; readonly z: number; readonly yaw: number };
  readonly zones: () => readonly MapZone[];
  readonly pois: () => MapPoi[] | null;
  readonly fallbackPois: () => MapPoi[];
  readonly poiSources: ReadonlySet<() => MapPoi[]>;
  readonly extras: () => MapExtras | null;
  readonly tally: () => boolean;
  readonly ppm: () => number;
  readonly now: () => number;
}

export class MapPainter {
  /** the quest pins' pulse rings of the last paint (device px): FullMap animates them over the canvas (FC4), so the pulse
   *  never repaints the map */
  readonly pulses: { x: number; y: number; r: number }[] = [];
  private paintedHash = Number.NaN;
  private tilesPending = false;
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;
  private readonly fog = document.createElement('canvas');
  private readonly fc: CanvasRenderingContext2D;
  private readonly view: MapPaintView;
  constructor(view: MapPaintView) {
    this.view = view;
    const context = this.fog.getContext('2d');
    if (context === null) throw new Error('FullMap: no 2d context');
    this.fc = context;
  }
  /** FC4 (G909): paints only when something the map shows changed (the view, you, the layers, the pins, the marks, the
   *  extras, a zoom tile still to cut); returns whether it painted */
  draw(): boolean {
    if (!this.view.open()) return false;
    const list = this.pinList(), hash = this.signature(list);
    if (hash === this.paintedHash && !this.tilesPending) return false;
    this.paintedHash = hash; this.tilesPending = false; this.pulses.length = 0;
    this.paint(list);
    return true;
  }
  /** the next draw paints whatever the digest says (a resized canvas comes back cleared) */
  invalidate(): void { this.paintedHash = Number.NaN; }
  private pinList(): Pin[] {
    const own = this.view.pois(), list: Pin[] = own === null ? this.view.fallbackPois() : [...own];
    if (this.view.poiSources.size > 0) list.push(...[...this.view.poiSources].flatMap((source) => source()));
    return list;
  }
  private id(o: object | null): number {
    if (o === null) return 0;
    let v = this.ids.get(o);
    if (v === undefined) { v = this.nextId++; this.ids.set(o, v); }
    return v;
  }
  private text(seed: number, t: string): number { let h = seed; for (const c of t) h = fold(h, c.codePointAt(0) ?? 0); return fold(h, t.length); }
  /** a digest of everything the paint reads that can change, positions in half device pixels */
  private signature(list: readonly Pin[]): number {
    const v = this.view, k = v.ppm() * 2, pose = v.pose, mm = v.minimap, extras = v.extras();
    let h = fold(fold(fold(FNV_SEED, Math.round(v.cx() * k)), Math.round(v.cz() * k)), Math.round(v._zoom() * 4096));
    h = fold(fold(fold(h, v.canvas.width), v.canvas.height), Math.round(v.dpr() * 100));
    h = fold(fold(fold(h, Math.round(pose.x * k)), Math.round(pose.z * k)), Math.round(pose.yaw * 1000));
    h = fold(fold(fold(fold(h, this.id(mm.room)), this.id(mm.layers.terrain)), this.id(mm.layers.cover)), mm.layerGen);
    h = fold(fold(h, mm.bakedGround ? 1 : 0), mm.marks.length);
    for (const m of mm.marks) h = this.text(fold(fold(h, Math.round(m.x * k)), Math.round(m.z * k)), m.color);
    h = fold(h, this.id(extras));
    if (extras !== null) {
      h = fold(fold(fold(h, extras.rects.length), extras.labels.length), Math.round((extras.baseAlpha ?? 1) * 100));
      for (const m of extras.images) h = fold(fold(h, this.id(m.image)), Math.round(m.alpha * 100));
    }
    h = fold(fold(fold(h, v.zones().length), v.tally() ? 1 : 0), fontsLoaded() ? 1 : 0); // a late web font repaints the labels
    for (const p of list) h = this.text(this.text(this.text(fold(fold(h, Math.round(p.x * k)), Math.round(p.z * k)), p.kind), p.label), p.short ?? '');
    return h;
  }
  private paint(list: Pin[]): void {
    const pos = this.view.pose, yaw = this.view.pose.yaw;
    const room = this.view.minimap.room;
    if (room !== null) {   // a practice room: its own layout, fitted to the frame (the zoom chips scale it), no shard, no pins
      const ctx = this.view.ctx, W = this.view.canvas.width, H = this.view.canvas.height, view = fitRoom(room, W, H, false);
      view.ppm *= this.view._zoom();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = ROOM_BG; ctx.fillRect(0, 0, W, H);
      paintRoom(ctx, room, view, pos, yaw, this.view.dpr(), { labels: true });
      return;
    }
    const { terrain, cover } = this.view.minimap.layers;
    const extras = this.view.extras();
    const ctx = this.view.ctx, W = this.view.canvas.width, H = this.view.canvas.height, ppm = this.view.ppm(), side = CHUNK_SIZE * ppm;
    const sx = (x: number) => W / 2 + (this.view.cx() - x) * ppm;   // −X is east (screen right)
    const sz = (z: number) => H / 2 + (this.view.cz() - z) * ppm;   // +Z is north (screen up)
    const ox = sx(CHUNK_HALF), oy = sz(CHUNK_HALF);           // the chunk's NE corner on screen

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    if (extras !== null) {   // the ground around the chunk (the grid's cells and roads), under it
      if (extras.outside !== undefined) { ctx.fillStyle = extras.outside; ctx.fillRect(0, 0, W, H); }
      for (const r of extras.rects) { ctx.fillStyle = r.color; ctx.fillRect(sx(r.x + r.hx), sz(r.z + r.hz), 2 * r.hx * ppm, 2 * r.hz * ppm); }
      for (const m of extras.images) {
        if (m.alpha <= 0) continue;
        ctx.globalAlpha = Math.min(1, m.alpha);
        const x = sx(m.x + m.size / 2), y = sz(m.z + m.size / 2);
        if (m.crop === undefined) ctx.drawImage(m.image, x, y, m.size * ppm, m.size * ppm);
        else ctx.drawImage(m.image, ...m.crop, x, y, m.size * ppm, m.size * ppm);
      }
      ctx.globalAlpha = 1;
    }
    const baseAlpha = extras?.baseAlpha ?? 1;
    if (terrain !== null && baseAlpha > 0) {
      ctx.globalAlpha = baseAlpha; ctx.drawImage(terrain, ox, oy, side, side); ctx.globalAlpha = 1;
      if (!this.view.minimap.bakedGround) this.drawTiles(ox, oy, ppm);
    }

    // fog of war, same rule as the minimap: unexplored ground at FOG_BRIGHTNESS (fog canvas at screen res, clipped to the view)
    if (this.fog.width !== W || this.fog.height !== H) { this.fog.width = W; this.fog.height = H; }
    const fc = this.fc;
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, W, H);
    fc.fillStyle = `rgba(0, 0, 0, ${1 - FOG_BRIGHTNESS})`;
    fc.fillRect(ox, oy, side, side);
    fc.globalCompositeOperation = 'destination-out';
    fc.drawImage(cover, ox, oy, side, side);
    ctx.drawImage(this.fog, 0, 0);

    // chunk edge
    ctx.strokeStyle = 'rgba(143, 227, 255, 0.55)'; ctx.lineWidth = 1.5 * this.view.dpr();
    ctx.strokeRect(ox, oy, side, side);

    // the extras' labels (the grid: each cell's shard name), under the pins
    const held: Box[] = [];
    if (extras !== null && extras.labels.length > 0) {
      ctx.font = `700 ${Math.max(12 * this.view.dpr(), 0.05 * CHUNK_SIZE * ppm)}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 3 * this.view.dpr(); ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)';
      const lh = Math.max(12 * this.view.dpr(), 0.05 * CHUNK_SIZE * ppm);
      for (const l of extras.labels) {
        if (l.width !== undefined && l.height !== undefined) {
          const text = (this.view._zoom() < 2 ? l.short ?? l.text : l.text).toUpperCase();
          const width = l.width * ppm - 4 * this.view.dpr(), height = l.height * ppm;
          const label = fitMapLabel(text, width, height, 11 * this.view.dpr(), 8 * this.view.dpr(), (line, font) => {
            ctx.font = `700 ${font}px Rajdhani, sans-serif`; return ctx.measureText(line).width;
          });
          const x = sx(l.x), y = sz(l.z), lineHeight = label.font * 1.15;
          ctx.font = `700 ${label.font}px Rajdhani, sans-serif`; ctx.fillStyle = l.color;
          for (const [i, line] of label.lines.entries()) {
            const at = y + (i - (label.lines.length - 1) / 2) * lineHeight;
            ctx.strokeText(line, x, at); ctx.fillText(line, x, at);
          }
          if (label.lines.length > 0) held.push({ x0: x - width / 2, x1: x + width / 2, y0: y - height / 2, y1: y + height / 2 });
          continue;
        }
        ctx.font = `700 ${lh}px Rajdhani, sans-serif`;
        const t = l.text.toUpperCase(), x = sx(l.x), y = sz(l.z), hw = ctx.measureText(t).width / 2;
        ctx.strokeText(t, x, y); ctx.fillStyle = l.color; ctx.fillText(t, x, y);
        held.push({ x0: x - hw, y0: y - lh / 2, x1: x + hw, y1: y + lh / 2 }); // the pins' labels lay out clear of it (playtest round 3)
      }
      ctx.textAlign = 'left';
    }

    // points of interest (their labels laid out clear of each other, the markers and your arrow)
    const fs = Math.max(11 * this.view.dpr(), side * 0.022 / this.view._zoom());
    const px = sx(pos.x), py = sz(pos.z), r = Math.max(7 * this.view.dpr(), fs * 0.6);
    const tally = this.view.tally() ? this.layTally(list, ox, oy + side) : null;
    if (tally !== null) held.push(tally);
    // the minimap's marks (Driftwood's sea chart: every unfound sea glass piece, E314) — under the pins, no labels, not
    // tallied; a bead in the piece's colour inside a white ring (a quest marker is a cyan diamond, a place a white dot)
    const marks = this.view.minimap.marks;
    if (marks.length > 0) {
      const mr = Math.max(3.5 * this.view.dpr(), fs * 0.3);
      for (const m of marks) {
        ctx.beginPath(); ctx.arc(sx(m.x), sz(m.z), mr, 0, Math.PI * 2);
        ctx.fillStyle = m.color; ctx.fill();
        ctx.lineWidth = 3 * this.view.dpr(); ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)'; ctx.stroke();
        ctx.lineWidth = 1.2 * this.view.dpr(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.stroke();
      }
    }
    this.drawPois(list, sx, sz, fs, { x: px, y: py, r: r * 2.2 }, held);
    if (tally) this.drawTally(tally);

    // you
    const deg = 180 - (yaw * 180) / Math.PI;
    ctx.save();
    ctx.translate(px, py); ctx.rotate((deg * Math.PI) / 180);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(6, 10, 18, 0.9)'; ctx.lineWidth = 2 * this.view.dpr();
    ctx.beginPath(); ctx.moveTo(0, -r * 1.4); ctx.lineTo(r * 0.9, r); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r * 0.9, r); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = this.view.dpr();
    ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, Math.PI * 2); ctx.stroke();

    // N marker at the top edge of the chunk
    ctx.fillStyle = '#8fe3ff'; ctx.font = `700 ${Math.max(12 * this.view.dpr(), fs * 1.3)}px Rajdhani, sans-serif`; ctx.textBaseline = 'bottom';
    ctx.fillText(engineString('s_8ce86a6ae65d'), ox + side / 2, oy - 4 * this.view.dpr());
  }

  // ── zoom tiles: the ground at the screen's own resolution, level ℓ = LAYER_PPM · 2^ℓ px/m ──
  private tiles = new Map<string, HTMLCanvasElement>();
  private tilesGen = -1;
  private drawTiles(ox: number, oy: number, ppm: number): void {
    if (this.tilesGen !== this.view.minimap.layerGen) { this.tiles.clear(); this.tilesGen = this.view.minimap.layerGen; }
    if (ppm <= LAYER_PPM * 1.25) return;
    const level = Math.min(4, Math.ceil(Math.log2(ppm / LAYER_PPM)));
    const W = this.view.canvas.width, H = this.view.canvas.height, t0 = this.view.now(), side = CHUNK_SIZE * ppm;
    this.view.ctx.save();
    this.view.ctx.beginPath(); this.view.ctx.rect(ox, oy, side, side); this.view.ctx.clip(); // the chunk's last tiles run past its edge
    // the level below first (cached tiles only), so crossing a level mid-pinch never drops back to the stretched layer
    for (const l of level > 1 ? [level - 1, level] : [level]) {
      const tm = TILE_PX / (LAYER_PPM * 2 ** l), n = Math.ceil(CHUNK_SIZE / tm); // tile side in metres, tiles per chunk side
      const clampI = (v: number) => Math.max(0, Math.min(n - 1, v));
      const i0 = clampI(Math.floor(-ox / ppm / tm)), i1 = clampI(Math.floor((W - ox) / ppm / tm));
      const j0 = clampI(Math.floor(-oy / ppm / tm)), j1 = clampI(Math.floor((H - oy) / ppm / tm));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const key = `${l}:${i}:${j}`;
        let tile = this.tiles.get(key);
        if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); } // most recently used last
        else if (l === level && this.view.now() - t0 >= TILE_BUDGET_MS) this.tilesPending = true; // cut on the next frame
        else if (l === level) {
          tile = document.createElement('canvas');
          this.view.minimap.paintTile(tile, i * tm, j * tm, tm, TILE_PX);
          this.tiles.set(key, tile);
          if (this.tiles.size > TILE_CACHE) { const oldest = this.tiles.keys().next().value; if (oldest !== undefined) this.tiles.delete(oldest); }
        }
        if (!tile) continue;
        // snap to whole device px so neighbouring tiles meet without a hairline seam
        const x0 = Math.round(ox + i * tm * ppm), x1 = Math.round(ox + (i + 1) * tm * ppm);
        const y0 = Math.round(oy + j * tm * ppm), y1 = Math.round(oy + (j + 1) * tm * ppm);
        this.view.ctx.drawImage(tile, x0, y0, x1 - x0, y1 - y0);
      }
    }
    this.view.ctx.restore();
  }

  /** the points of interest: places (named dots), undiscovered places (dim "?"), quest markers (pulsing cyan diamonds, on top);
   *  then every label, placed where it covers no other label, marker or your arrow (`you`) */
  private drawPois(list: Pin[], sx: (x: number) => number, sz: (z: number) => number, fs: number, you: { x: number; y: number; r: number }, avoid: readonly Box[]): void {
    const ctx = this.view.ctx, d = this.view.dpr();
    // the shard's zone names (setZones — Pine Hollow's THE RIDGE, THE OLD-GROWTH, …): big faint caps under everything, up to 2.5×
    if (this.view._zoom() <= 2.5 && this.view.zones().length > 0) {
      const zfs = fs * 1.15;
      ctx.font = `600 ${zfs}px Rajdhani, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(230, 242, 248, 0.5)'; ctx.strokeStyle = 'rgba(6, 10, 18, 0.55)'; ctx.lineWidth = 3 * d;
      for (const zn of this.view.zones()) { ctx.strokeText(zn.label, sx(zn.x), sz(zn.z)); ctx.fillText(zn.label, sx(zn.x), sz(zn.z)); }
    }
    ctx.font = `${fs}px JetBrains Mono, Menlo, monospace`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const pins = list.map((p) => {
      const r = p.kind === 'quest' ? Math.max(6 * d, fs * 0.55) : p.kind === 'place' ? Math.max(4 * d, fs * 0.35) : Math.max(10 * d, fs * 0.85);
      return { p, x: sx(p.x), y: sz(p.z), r, text: p.kind === 'unknown' ? engineString('s_8a8de823d5ed') : p.kind === 'quest' ? (p.short ?? p.label) : p.label, glyph: p.kind === 'quest', own: true };
    });
    // two unfound rings that would overlap (the sea cave by the wreck, at 1×) are pushed apart along the line between them
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i], b = pins[j];
      if (a === undefined || b === undefined || a.p.kind !== 'unknown' || b.p.kind !== 'unknown') continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      const dd = Math.hypot(dx, dy), want = a.r + b.r + 2 * d;
      if (dd >= want) continue;
      if (dd < 1e-3) { dx = 1; dy = 0; } else { dx /= dd; dy /= dd; }
      const push = (want - dd) / 2;
      a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
    }
    // a quest marker at a place of its own name (LOOKOUT at THE LOOKOUT) puts its ◆ on that place's label, one marker a place
    for (const q of pins) {
      if (q.p.kind !== 'quest') continue;
      const name = q.text.toUpperCase();
      let best: (typeof pins)[number] | null = null, bestD = MERGE_M * MERGE_M;
      for (const o of pins) {
        if (o.p.kind === 'quest' || o.glyph) continue;
        const real = o.p.label.toUpperCase(), dd = (o.p.x - q.p.x) ** 2 + (o.p.z - q.p.z) ** 2;
        if (dd < bestD && (real.includes(name) || name.includes(real))) { best = o; bestD = dd; }
      }
      if (best) { best.glyph = true; if (best.p.kind === 'unknown') best.text = q.text; q.own = false; }
    }
    // markers: places (dots) + unfound places (a dashed cyan ring, "?" inside: E309 A) under the quest diamonds
    for (const m of pins) {
      if (m.p.kind === 'quest') continue;
      if (m.p.kind === 'unknown') {
        ctx.fillStyle = 'rgba(8, 20, 30, 0.72)';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(6, 10, 18, 0.8)'; ctx.lineWidth = 3.5 * d; ctx.stroke();
        ctx.setLineDash(this.view.dash()); ctx.strokeStyle = CYAN; ctx.lineWidth = 1.6 * d; ctx.stroke(); ctx.setLineDash(NO_DASH);
        ctx.save();
        ctx.font = `700 ${Math.round(m.r * 1.25)}px JetBrains Mono, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = CYAN; ctx.fillText(engineString('s_8a8de823d5ed'), m.x, m.y + m.r * 0.06);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = m.p.color ?? '#e6f2f8';
      ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)'; ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const m of pins) {
      if (m.p.kind !== 'quest') continue;
      this.pulses.push({ x: m.x, y: m.y, r: m.r });
      ctx.fillStyle = CYAN; ctx.strokeStyle = 'rgba(6, 10, 18, 0.9)'; ctx.lineWidth = 2 * d;
      diamond(ctx, m.x, m.y, m.r); ctx.fill(); ctx.stroke();
    }
    // labels: ◆-tagged first, then places, then "?"; each takes the first candidate spot that is free (else the least covered)
    const taken: Box[] = [{ x0: you.x - you.r, y0: you.y - you.r, x1: you.x + you.r, y1: you.y + you.r }];
    for (const m of pins) taken.push({ x0: m.x - m.r, y0: m.y - m.r, x1: m.x + m.r, y1: m.y + m.r });
    taken.push(...avoid);   // the PLACES tally (E309 A) and the extras' labels (the grid's shard names)
    // off the canvas counts as taken, so a pin at the chunk's edge (a road portal) labels inward instead of cut off (SF66)
    const cw = ctx.canvas.width, ch = ctx.canvas.height, far = Math.max(cw, ch);
    taken.push({ x0: -far, y0: -far, x1: 0, y1: ch + far }, { x0: cw, y0: -far, x1: cw + far, y1: ch + far }, { x0: -far, y0: -far, x1: cw + far, y1: 0 }, { x0: -far, y0: ch, x1: cw + far, y1: ch + far });
    const rank = (m: (typeof pins)[number]): number => (m.glyph ? 0 : m.p.kind === 'place' ? 1 : 2);
    const gw = fs * 0.62, gap = fs * 0.3, pad = 2 * d;
    // (an unfound place's "?" is inside its ring: it carries no label unless a quest marker named it)
    for (const m of pins.filter((q) => q.own && (q.glyph || q.p.kind !== 'unknown')).sort((a, b) => rank(a) - rank(b))) {
      const w = ctx.measureText(m.text).width + (m.glyph ? gw + gap : 0), h = fs, o = m.r + 3 * d;
      const spots: [number, number][] = [
        [m.x - w / 2, m.y + o], [m.x - w / 2, m.y - o - h], [m.x + o + d, m.y - h / 2], [m.x - o - d - w, m.y - h / 2],
        [m.x - w / 2, m.y + o + h + pad], [m.x - w / 2, m.y - o - 2 * h - pad], [m.x + o + d, m.y + h / 2 + pad], [m.x - o - d - w, m.y + h / 2 + pad],
        [m.x + o + d, m.y - 1.5 * h - pad], [m.x - o - d - w, m.y - 1.5 * h - pad],
      ];
      let pick: Box | null = null, least = Infinity;
      for (const [x0, y0] of spots) {
        const b = { x0: x0 - pad, y0: y0 - pad, x1: x0 + w + pad, y1: y0 + h + pad };
        let hit = 0;
        for (const t of taken) hit += Math.max(0, Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0)) * Math.max(0, Math.min(b.y1, t.y1) - Math.max(b.y0, t.y0));
        if (hit < least) { least = hit; pick = b; }
        if (hit === 0) break;
      }
      if (!pick) continue;
      taken.push(pick);
      let x = pick.x0 + pad;
      const y = pick.y0 + pad;
      if (m.glyph) {
        ctx.fillStyle = CYAN; ctx.strokeStyle = 'rgba(6, 10, 18, 0.9)'; ctx.lineWidth = 1.5 * d;
        diamond(ctx, x + gw / 2, y + h * 0.48, gw / 2); ctx.fill(); ctx.stroke();
        x += gw + gap;
      }
      ctx.fillStyle = m.p.kind === 'unknown' && !m.glyph ? 'rgba(230, 242, 248, 0.7)' : m.p.kind === 'quest' ? CYAN : 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = 'rgba(6, 10, 18, 0.85)'; ctx.lineWidth = 3 * d;
      ctx.strokeText(m.text, x, y); ctx.fillText(m.text, x, y);
    }
    ctx.textAlign = 'center';
  }

  /** E309 A: "PLACES n / N" (found / all places) on a navy glass plate in the bottom-left corner, fixed while you pan: inside
   *  the chunk's corner while it is on screen (1×), else the frame's. Laid out first, so the place labels keep clear of it */
  private layTally(list: readonly Pin[], chunkLeft: number, chunkBottom: number): Tally | null {
    let found = 0, all = 0;
    for (const p of list) { if (p.kind === 'place') { found++; all++; } else if (p.kind === 'unknown') all++; }
    if (all === 0) return null;
    const ctx = this.view.ctx, d = this.view.dpr(), fs = 11 * d, sp = fs * 0.2, text = `PLACES ${found} / ${all}`;
    ctx.font = `600 ${fs}px JetBrains Mono, Menlo, monospace`;
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + sp;
    w -= sp;
    const padX = 8 * d, h = fs + 10 * d, x0 = Math.max(10 * d, chunkLeft + 8 * d), y0 = Math.min(this.view.canvas.height - 10 * d, chunkBottom - 8 * d) - h;
    return { x0, y0, x1: x0 + w + padX * 2, y1: y0 + h, text, fs, sp, padX };
  }

  private drawTally(t: Tally): void {
    const ctx = this.view.ctx, d = this.view.dpr(), h = t.y1 - t.y0;
    ctx.save();
    ctx.font = `600 ${t.fs}px JetBrains Mono, Menlo, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(13, 27, 38, 0.8)'; ctx.fillRect(t.x0, t.y0, t.x1 - t.x0, h);
    ctx.strokeStyle = 'rgba(143, 227, 255, 0.55)'; ctx.lineWidth = d; ctx.strokeRect(t.x0 + d / 2, t.y0 + d / 2, t.x1 - t.x0 - d, h - d);
    ctx.fillStyle = CYAN;
    let x = t.x0 + t.padX;
    for (const ch of t.text) { ctx.fillText(ch, x, t.y0 + h / 2); x += ctx.measureText(ch).width + t.sp; }
    ctx.restore();
  }
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
}

interface Box { x0: number; y0: number; x1: number; y1: number }
/** the PLACES tally's plate (a Box) and how its letter-spaced text is set */
interface Tally extends Box { text: string; fs: number; sp: number; padX: number }
