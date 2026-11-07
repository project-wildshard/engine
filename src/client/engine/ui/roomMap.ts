/**
 * A practice room's own map (E321, Jake: "the minimap needs to be for this new custom map for the horse racing test, not
 * for the real game"). The Practice arena and every feature playground (src/playgrounds/) hang over the shard, so while
 * one is up the minimap and the full map draw ITS layout instead of the shard's terrain: no POIs, no quest pins, no elite
 * skulls, no fog of war.
 *
 *   const map: RoomMap = { bounds, shapes: [...], markers: () => [{ x, z }] };   // the room says what moves in it
 *   minimap.setRoom(map)          // main.ts, on entering it (setPracticeArena(null) / setRoom(null) on leaving)
 *   paintRoom(ctx, map, view, pos, yaw, dpr)   // Minimap.ts (fitted in its circle) and Map.ts (fitted in the MAP tab)
 *
 * World x / z throughout, the minimap's convention: north (+Z) up, −X east (screen right). Widths are metres (they scale
 * with the view), dot radii CSS px (they stay legible on the small circle).
 */

export type RoomShape =
  /** a box: the field, a pad, a column */
  | { kind: 'rect'; x0: number; z0: number; x1: number; z1: number; fill?: string; stroke?: string }
  /** a band along points (metres wide): the track, a line across it, a rail */
  | { kind: 'path'; pts: readonly (readonly [number, number])[]; width: number; color: string; closed?: boolean }
  /** a marker dot, `r` CSS px */
  | { kind: 'dot'; x: number; z: number; r: number; color: string }
  /** faint grid lines every `step` metres inside a box */
  | { kind: 'grid'; x0: number; z0: number; x1: number; z1: number; step: number; color: string }
  /** a floor label, drawn only on the full map (the minimap's circle is too small to read it) */
  | { kind: 'label'; x: number; z: number; text: string; color: string };

/** something that moves, read every frame (a playground's mount); `color` defaults to amber */
export interface RoomMarker { x: number; z: number; color?: string }

export interface RoomMap {
  /** the box the views fit: the room's walls */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  shapes: readonly RoomShape[];
  markers?: () => readonly RoomMarker[];
}

/** where the map sits on the canvas: the bounds' centre at (cx, cy) device px, `ppm` device px per metre */
export interface RoomView { cx: number; cy: number; ppm: number }

export const ROOM_BG = '#07101d';
const ARROW = '#ffffff', OUTLINE = 'rgba(6, 10, 18, 0.9)', MARKER = '#ffb547';

/** the view that fits the room's bounds in a `w` × `h` canvas: in a circle (the minimap) its diagonal fits the diameter */
export function fitRoom(map: RoomMap, w: number, h: number, circle: boolean): RoomView {
  const b = map.bounds, bw = Math.abs(b.x1 - b.x0), bh = Math.abs(b.z1 - b.z0);
  const ppm = circle ? (Math.min(w, h) * 0.94) / Math.hypot(bw, bh) : Math.min((w * 0.9) / bw, (h * 0.86) / bh);
  return { cx: w / 2, cy: h / 2, ppm };
}

/** paint the room, the markers and the player's arrow (the caller clears / clips the canvas first) */
export function paintRoom(ctx: CanvasRenderingContext2D, map: RoomMap, view: RoomView, pos: { x: number; z: number }, yaw: number, dpr: number, opts: { labels?: boolean } = {}): void {
  const b = map.bounds, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2, k = view.ppm;
  const sx = (x: number): number => view.cx - (x - mx) * k;   // −X is east: screen right
  const sy = (z: number): number => view.cy - (z - mz) * k;   // +Z is north: screen up
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of map.shapes) {
    if (s.kind === 'rect') {
      const x = Math.min(sx(s.x0), sx(s.x1)), y = Math.min(sy(s.z0), sy(s.z1)), w = Math.abs(sx(s.x1) - sx(s.x0)), h = Math.abs(sy(s.z1) - sy(s.z0));
      if (s.fill !== undefined) { ctx.fillStyle = s.fill; ctx.fillRect(x, y, w, h); }
      if (s.stroke !== undefined) { ctx.strokeStyle = s.stroke; ctx.lineWidth = Math.max(1, dpr * 1.1); ctx.strokeRect(x, y, w, h); }
    } else if (s.kind === 'path') {
      ctx.beginPath();
      s.pts.forEach(([x, z], i) => { if (i === 0) ctx.moveTo(sx(x), sy(z)); else ctx.lineTo(sx(x), sy(z)); });
      if (s.closed === true) ctx.closePath();
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(dpr, s.width * k); ctx.stroke();
    } else if (s.kind === 'dot') {
      ctx.beginPath(); ctx.arc(sx(s.x), sy(s.z), Math.max(1, s.r * dpr), 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
    } else if (s.kind === 'grid') {
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, dpr * 0.6);
      ctx.beginPath();
      for (let x = Math.min(s.x0, s.x1) + s.step; x < Math.max(s.x0, s.x1) - 0.01; x += s.step) { ctx.moveTo(sx(x), sy(s.z0)); ctx.lineTo(sx(x), sy(s.z1)); }
      for (let z = Math.min(s.z0, s.z1) + s.step; z < Math.max(s.z0, s.z1) - 0.01; z += s.step) { ctx.moveTo(sx(s.x0), sy(z)); ctx.lineTo(sx(s.x1), sy(z)); }
      ctx.stroke();
    } else if (opts.labels === true) {
      ctx.font = `700 ${Math.round(10 * dpr)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = OUTLINE; ctx.strokeText(s.text, sx(s.x), sy(s.z));
      ctx.fillStyle = s.color; ctx.fillText(s.text, sx(s.x), sy(s.z));
    }
  }
  // the markers: amber with a dark rim (under your arrow once you ride one)
  for (const m of map.markers?.() ?? []) {
    ctx.beginPath(); ctx.arc(sx(m.x), sy(m.z), 3.2 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = m.color ?? MARKER; ctx.fill();
    ctx.lineWidth = 1.2 * dpr; ctx.strokeStyle = OUTLINE; ctx.stroke();
  }
  // you: the arrow, heading clockwise from north (the compass band's convention, heading = 180° − yaw)
  ctx.save();
  ctx.translate(sx(pos.x), sy(pos.z)); ctx.rotate(Math.PI - yaw);
  const s = dpr * (opts.labels === true ? 1.5 : 1);
  ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(5 * s, 6 * s); ctx.lineTo(0, 3 * s); ctx.lineTo(-5 * s, 6 * s); ctx.closePath();
  ctx.fillStyle = ARROW; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5 * s; ctx.stroke(); ctx.fill();
  ctx.restore();
}

/** the Practice arena's map: its enclosed 100 m room, a 10 m grid, the three dummies (src/client/engine/practice/TrainingArena.ts) */
export function arenaMap(center: { x: number; z: number }): RoomMap {
  const { x, z } = center, h = 50;
  const box = { x0: x - h, z0: z - h, x1: x + h, z1: z + h };
  return {
    bounds: box,
    shapes: [
      { kind: 'grid', ...box, step: 10, color: 'rgba(117, 217, 255, 0.25)' },
      { kind: 'rect', ...box, stroke: '#75d9ff' },
      ...([[-6, -13], [0, -7], [6, -13]] as const).map(([dx, dz]): RoomShape => ({ kind: 'dot', x: x + dx, z: z + dz, r: 1.8, color: '#ffb547' })),
    ],
  };
}
