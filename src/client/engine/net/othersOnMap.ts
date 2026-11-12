// REMOTE-PLAYERS RP3 (meta docs/plans/REMOTE-PLAYERS-PLAN.md; Jake, 2026-11-12 17:46: "we should show other players in the
// minimap. Like other human players that are live in the MMO, they should show on a minimap."). The other players' bodies
// (otherPlayers.ts, in the online bundle) and the minimap (ui/Minimap.ts, in the game's) meet here, as voiceNear.ts joins voice
// and bodies, so neither imports the other. One line in `OtherPlayers.frame()` hands over where every body stands and faces;
// the minimap reads the ones in its radius and draws each as a magenta teardrop pointing the way they face.
// Nothing is allocated per frame once the pool holds as many players as the room has.

/** A body as OtherPlayers keeps it: where its row puts it, and its figure's turn (three's `rotation.y`, facing +z at 0). */
export interface MapBody {
  readonly shown: { readonly x: number; readonly z: number };
  readonly group: { readonly rotation: { readonly y: number } };
}
/** One marker in minimap device pixels: its centre, and its nose's turn clockwise from screen up, in radians. */
export interface OtherMark { sx: number; sy: number; angle: number }

/** A minimap that reads this many times with no new update is on a page whose online world went away (its frame no longer
 *  runs): the marks draw nothing. Counted in reads (both run once a drawn frame), not time: the two bundles keep two clocks. */
const STALE_READS = 30;
/** The other players' colour: none of the minimap's own (the white arrow, yellow and red creature dots, a mark's glass). */
export const OTHER_FILL = '#f05cff';
const OUTLINE = 'rgba(6, 10, 18, 0.9)';

interface Spot { x: number; z: number; facing: number }
/** What both bundles share. The online shell is its own bundle (`online.js`) with its own copy of this module, so the state
 *  lives on the page under one key, not in a module variable. `seen` and `centre` are the last paint's, for proofs. */
interface Shared { spots: Spot[]; count: number; reads: number; seen: OtherMark[]; pool: OtherMark[]; centre: number }
const KEY = Symbol.for('wildshard.othersOnMap');
const shared = (): Shared => {
  const page = globalThis as { [KEY]?: Shared };
  page[KEY] ??= { spots: [], count: 0, reads: STALE_READS, seen: [], pool: [], centre: 0 };
  return page[KEY];
};

export const othersOnMap = {
  /** Every other body drawn this frame (OtherPlayers.frame): who isn't here has left. */
  update(bodies: Iterable<MapBody>): void {
    const state = shared();
    let count = 0;
    for (const { shown, group } of bodies) {
      const spot = state.spots[count] ??= { x: 0, z: 0, facing: 0 };
      spot.x = shown.x; spot.z = shown.z; spot.facing = group.rotation.y; count++;
    }
    state.count = count; state.reads = 0;
  },
  /**
   * The markers within `radius` metres of `pos`, the map centred at `centre` device px with `k` px per metre, north up
   * (+Z up, -X right: the minimap's convention). Empty once the bodies stop reporting.
   */
  inView(pos: { readonly x: number; readonly z: number }, centre: number, k: number, radius: number): readonly OtherMark[] {
    const state = shared(), { seen, pool } = state;
    seen.length = 0; state.centre = centre;
    if (++state.reads > STALE_READS) return seen;
    for (let i = 0; i < state.count; i++) {
      const spot = state.spots[i];
      if (spot === undefined) continue;
      const dx = spot.x - pos.x, dz = spot.z - pos.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const mark = pool[seen.length] ??= { sx: 0, sy: 0, angle: 0 };
      // a figure facing +z (north) points up; its turn is counter-clockwise from above, the screen's is clockwise
      mark.sx = centre - dx * k; mark.sy = centre - dz * k; mark.angle = -spot.facing;
      seen.push(mark);
    }
    return seen;
  },
  /** What the minimap last computed (before its repaint throttle), for proofs: the markers and the map's centre, in device px. */
  get seen(): readonly OtherMark[] { return shared().seen; },
  get centre(): number { return shared().centre; },
};

/** One other player: a magenta disc with a nose the way they face, dark-outlined, `s` device px per css px. Unlike the own
 *  arrow (white, straight-sided), a creature (a round dot) or a mark (a diamond). */
export function drawOther(ctx: CanvasRenderingContext2D, sx: number, sy: number, angle: number, s: number): void {
  const r = 3.4 * s, nose = 7.4 * s, half = Math.acos(r / nose), up = -Math.PI / 2;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, -nose); ctx.arc(0, 0, r, up + half, up - half + Math.PI * 2); ctx.closePath();
  ctx.fillStyle = OTHER_FILL; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.5 * s; ctx.lineJoin = 'round';
  ctx.stroke(); ctx.fill();
  ctx.restore();
}
