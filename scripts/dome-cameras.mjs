import * as v from 'valibot';

const finite = v.pipe(v.number(), v.finite());
const point = v.tuple([finite, finite, finite]);
const name = v.pipe(v.string(), v.nonEmpty());
const view = v.strictObject({
  n: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(9)), name,
  eye: point, look: point, yaw: finite, pitch: finite,
  hfov: v.pipe(finite, v.minValue(1), v.maxValue(179)),
});
const plan = v.strictObject({
  dome: name, type: v.picklist(['stand', 'look']), pair: name,
  mockup: name, layout: name, anchor: point, convention: name,
  views: v.pipe(v.array(view), v.length(9),
    v.check(rows => rows.every((row, index) => row.n === index + 1), 'Dome views must be ordered 1..9'),
    v.check(rows => rows.every(row => row.eye.some((word, index) => word !== row.look[index])), 'Dome view needs a direction')),
});

/** Admit the committed camera manifest; eye/look are authoritative, never the rounded yaw/pitch labels.
 * @param {unknown} value */
export function parseDomeCameras(value) {
  return v.parse(plan, value);
}

/** Convert a plot-local horizontal lens to a world-space portrait camera without changing its framing.
 * @param {import('./dome-cameras.mjs').DomeView} camera
 * @param {{x:number,z:number}} origin @param {number} aspect
 * @returns {{eye:[number,number,number],look:[number,number,number],fov:number}} */
export function domeWorldCamera(camera, origin, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(origin.x) || !Number.isFinite(origin.z)) {
    throw new Error('Invalid dome camera frame');
  }
  const row = v.parse(view, camera);
  return {
    eye: [row.eye[0] + origin.x, row.eye[1], row.eye[2] + origin.z],
    look: [row.look[0] + origin.x, row.look[1], row.look[2] + origin.z],
    fov: 2 * Math.atan(Math.tan(row.hfov * Math.PI / 360) / aspect) * 180 / Math.PI,
  };
}

/** Physical streaming follows the dome anchor's ground projection, not its detached aerial camera.
 * A 500 m plot can place an outside stand over a neighbouring cell; prepare that cell through normal entry first.
 * @param {import('./dome-cameras.mjs').DomeCameras} cameras
 * @param {Pick<import('./frame-floor-grid.mjs').FloorGridState,'pitch'|'cells'>} grid @param {string} instance
 */
export function domeGroundAnchor(cameras, grid, instance) {
  const admitted = parseDomeCameras(cameras), pitch = grid.pitch ?? 555;
  if (!Number.isFinite(pitch) || pitch <= 500) throw new Error('Invalid dome grid pitch');
  const market = grid.cells.find(cell => cell.instance === instance);
  if (market === undefined) throw new Error('Dome plot is not assembled');
  const x = market.cell[0] * pitch + admitted.anchor[0], z = market.cell[1] * pitch + admitted.anchor[2];
  const matches = grid.cells.filter(cell => Math.abs(x - cell.cell[0] * pitch) <= 250 && Math.abs(z - cell.cell[1] * pitch) <= 250);
  if (matches.length > 1) throw new Error('Dome anchor overlaps grid cells');
  return { x, z, instance: matches[0]?.instance ?? null };
}

/** A capture-time pose may refine an already entered cell; it must never bypass an unready entry or recovery wall.
 * @param {Pick<import('./frame-floor-grid.mjs').FloorGridState,'inside'|'live'>} grid
 * @param {import('./dome-cameras.mjs').DomeGroundAnchor} anchor */
export function assertDomeAnchorReady(grid, anchor) {
  const live = grid.live.live;
  if (!live.gameplayReady || live.current !== anchor.instance || grid.inside !== anchor.instance
    || grid.live.crossing.phase !== 'settled' || grid.live.crossing.issue !== null || (live.pending?.length ?? 0) > 0
    || (anchor.instance !== null && !live.residents.includes(anchor.instance))) {
    throw new Error('Dome anchor requires normal ready grid entry before posing');
  }
}

/** Normal background admission can start after entry, including while a camera samples.
 * Wait for it before accepting the image; never suppress it or change the anchor guard.
 * This pure predicate is also serialized into the browser's bounded readiness wait.
 * @param {import('./dome-cameras.mjs').DomeResidencyState} grid */
export function domeResidencySettled(grid) {
  return grid.live.live.gameplayReady && grid.live.live.pending.length === 0
    && grid.live.crossing.phase === 'settled' && grid.live.crossing.issue === null
    && grid.rings.inFlight === 0 && grid.rings.queued === 0;
}
