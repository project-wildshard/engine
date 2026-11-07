import './format-hook.mjs';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { roadLayout } from '../src/shared/game/grid/roadLayout';

const { CHUNK_HALF } = await import('../src/shared/engine/core/config');

/** One actual world-space camera and target; light is an existing Debug time pick. */
export interface AerialHeroPose {
  readonly id: string;
  readonly name: string;
  readonly mode: 'grid';
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly downDegrees: number;
  readonly timePick: 'midday' | 'golden' | 'sunset';
}

/** Fifteen G332 round-2 views, derived from the shipping layout, never a staged scene. */
export function aerialHeroPlan(): { junction: string; surrounding: readonly string[]; poses: AerialHeroPose[] } {
  const grid = new GridAssembly({ developer: true, devserver: false });
  const template = grid.cells.find(cell => cell.slug === '_template');
  if (template === undefined) throw new Error('Aerial shoot requires the real template cell');
  const layout = roadLayout(grid, slug => slug);
  const candidates = layout.junctions.filter(junction => junction.roundabout);
  candidates.sort((a, b) => Math.hypot(a.centre.x - template.origin.x, a.centre.z - template.origin.z)
    - Math.hypot(b.centre.x - template.origin.x, b.centre.z - template.origin.z));
  const junction = candidates.at(0);
  if (junction === undefined) throw new Error('No central roundabout');
  const target = { ...junction.centre, y: 0 };
  const poses: AerialHeroPose[] = [];
  const add = (id: string, name: string, eye: AerialHeroPose['eye'], timePick: AerialHeroPose['timePick'], sweep = 0): void => {
    // The sweep is a small real aim change, not a moved shard or altered lens.
    const dx = target.x - eye.x, dz = target.z - eye.z;
    const look = { x: eye.x + dx * Math.cos(sweep) - dz * Math.sin(sweep), y: target.y,
      z: eye.z + dx * Math.sin(sweep) + dz * Math.cos(sweep) };
    poses.push({ id, name, mode: 'grid', eye, target: look, timePick,
      downDegrees: Math.atan2(eye.y - look.y, Math.hypot(eye.x - look.x, eye.z - look.z)) * 180 / Math.PI });
  };
  for (const [id, height, down, heading, time] of [
    ['A', 30, 45, 45, 'golden'], ['B', 60, 55, 135, 'golden'],
    ['C', 90, 60, 225, 'midday'], ['D', 120, 65, 315, 'sunset'],
    ['E', 150, 70, 45, 'golden'], ['F', 100, 50, 100, 'sunset'],
  ] as const) {
    const radius = height / Math.tan(down * Math.PI / 180), angle = heading * Math.PI / 180;
    add(id, 'Free aerial', { x: target.x + radius * Math.sin(angle), y: height, z: target.z + radius * Math.cos(angle) }, time);
  }
  const centre = template.origin;
  const corner = { x: centre.x + Math.sign(target.x - centre.x) * CHUNK_HALF,
    z: centre.z + Math.sign(target.z - centre.z) * CHUNK_HALF };
  const midpoint = { x: (corner.x + centre.x) / 2, z: (corner.z + centre.z) / 2 };
  for (const [group, label, at, heights] of [
    ['E2', 'Template corner', corner, [45, 75, 100]],
    ['M', 'Corner-centre midpoint', midpoint, [70, 110, 150]],
    ['T', 'Template centre', centre, [80, 115, 150]],
  ] as const) {
    for (const [index, height] of heights.entries()) {
      add(`${group}-${String.fromCodePoint(97 + index)}`, label, { x: at.x, y: height, z: at.z },
        index === 1 ? 'midday' : index === 2 ? 'sunset' : 'golden', (index - 1) * 3 * Math.PI / 180);
    }
  }
  return { junction: junction.id, surrounding: grid.cells.filter(cell =>
    Math.abs(cell.origin.x - target.x) < grid.pitch && Math.abs(cell.origin.z - target.z) < grid.pitch).map(cell => cell.instance), poses };
}

/** One G332 round-3 desktop-landscape view: an actual eye aimed exactly at the roundabout, so it sits at frame centre. */
export interface LandscapeHeroPose {
  readonly id: string;
  readonly name: string;
  readonly mode: 'grid';
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly downDegrees: number;
  /** Compass of the eye around the roundabout; 45° is M-b's corner–centre diagonal over the template. */
  readonly headingDegrees: number;
  /** Where each surrounding cell's centre falls in frame: left / centre / right of the roundabout, nearer or farther. */
  readonly placement: readonly { readonly instance: string; readonly side: 'left' | 'centre' | 'right'; readonly depth: 'near' | 'far' }[];
  /** G344: a capture-time vertical field of view for this shot only (the game's CAMERA_FOV never changes); absent = the game's own */
  readonly fovDegrees?: number;
  /** G344: which frame the shot is for (the square portrait band, or the desktop landscape); absent = landscape (round 3) */
  readonly aspect?: 'square' | 'landscape';
  /** G343: the cell the eye stands over; the capture enters it first so it draws its own runtime, not a placeholder */
  readonly over?: { readonly instance: string; readonly slug: string; readonly stand: { readonly x: number; readonly z: number } };
  /** G536: a capture-time far plane for this shot only (the whole 5 × 5 lies farther than the game's own); absent = the game's */
  readonly farMetres?: number;
}

/** One shot aimed exactly at `target` from `headingDegrees` round it, `distance` metres away on the ground, `height` up. */
function aimedPose(target: LandscapeHeroPose['target'], cells: readonly { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }[],
  shot: { id: string; name: string; headingDegrees: number; height: number; distance: number; fovDegrees?: number; aspect?: 'square' | 'landscape' }): LandscapeHeroPose {
  const angle = shot.headingDegrees * Math.PI / 180;
  const eye = { x: target.x + shot.distance * Math.sin(angle), y: shot.height, z: target.z + shot.distance * Math.cos(angle) };
  // three.js right axis for a camera looking along f with +y up is (-f.z, 0, f.x).
  const fx = target.x - eye.x, fz = target.z - eye.z;
  const placement = cells.map(cell => {
    const dx = cell.origin.x - target.x, dz = cell.origin.z - target.z;
    const across = dx * -fz + dz * fx, along = dx * fx + dz * fz;
    // Within 20° of the line of sight reads as centre.
    const side = Math.abs(Math.atan2(across, along)) < Math.PI / 9 || Math.abs(Math.atan2(across, -along)) < Math.PI / 9
      ? 'centre' as const : across < 0 ? 'left' as const : 'right' as const;
    return { instance: cell.instance, side, depth: along > 0 ? 'far' as const : 'near' as const, across };
  }).sort((a, b) => a.across - b.across).map(({ instance, side, depth }) => ({ instance, side, depth }));
  return { id: shot.id, name: shot.name, mode: 'grid', eye, target, headingDegrees: shot.headingDegrees,
    downDegrees: Math.atan2(eye.y - target.y, Math.hypot(fx, fz)) * 180 / Math.PI, placement,
    ...(shot.fovDegrees === undefined ? {} : { fovDegrees: shot.fovDegrees }), ...(shot.aspect === undefined ? {} : { aspect: shot.aspect }) };
}

/** Round 3 (Jake on M-b: "we need to capture this on desktop landscape"): M-b's spot, a tilt down, and headings around it. */
export function landscapeHeroPlan(): { junction: string; surrounding: readonly string[]; poses: LandscapeHeroPose[] } {
  const round2 = aerialHeroPlan();
  const mb = round2.poses.find(pose => pose.id === 'M-b');
  if (mb === undefined) throw new Error('Round 3 starts from round 2 M-b');
  const grid = new GridAssembly({ developer: true, devserver: false });
  const cells = grid.cells.filter(cell => round2.surrounding.includes(cell.instance));
  const target = mb.target;
  const radius = Math.hypot(mb.eye.x - target.x, mb.eye.z - target.z);
  const poses: LandscapeHeroPose[] = [];
  const add = (id: string, name: string, headingDegrees: number, height: number, distance = radius): void => {
    poses.push(aimedPose(target, cells, { id, name, headingDegrees, height, distance }));
  };
  add('L-a', 'M-b spot, landscape', 45, mb.eye.y);
  add('L-b', 'M-b spot, tilted down', 45, 135);
  add('L-c', 'Swung toward Pine', 25, 120);
  add('L-d', 'Swung toward Nalati', 65, 120);
  add('L-e', 'Down the road, 2 × 2', 0, 120, 200);
  return { junction: round2.junction, surrounding: round2.surrounding, poses };
}

/** G344's phone-1x lens: about 70° across a 16:9 frame (43° vertical) and 62° each way for the square, a ~26 mm lens. */
export const HERO_1X_FOV = { landscape: 43, square: 62 } as const;

/**
 * G344 (Jake on L-b: "it looks like 0.5x zoom … too fisheye"): the interim L-b re-shot at a phone-1x field of view, as
 * a square for the portrait centre band (G341 B) and a landscape for desktop (A). Same roundabout, same 45° heading over
 * the template; the narrower lens steps the camera back along L-b's line (and lower in angle, so a strip of sky stays),
 * so Pine (left), Nalati (right), Driftwood (far) and template-2 (near) still fit. `slant` is the eye-to-roundabout
 * distance; each aspect has a pick and two neighbours (farther, steeper).
 */
export function squareHeroPlan(): { junction: string; surrounding: readonly string[]; poses: LandscapeHeroPose[] } {
  const round3 = landscapeHeroPlan();
  const lb = round3.poses.find(pose => pose.id === 'L-b');
  if (lb === undefined) throw new Error('G344 starts from round 3 L-b');
  const grid = new GridAssembly({ developer: true, devserver: false });
  const cells = grid.cells.filter(cell => round3.surrounding.includes(cell.instance));
  const poses: LandscapeHeroPose[] = [];
  for (const [id, name, aspect, slant, down] of [
    ['SQ-a', 'Square, L-b line stepped back', 'square', 600, 28],
    ['SQ-b', 'Square, farther back', 'square', 700, 28],
    ['SQ-c', 'Square, higher and steeper', 'square', 600, 34],
    ['LS-a', 'Landscape, L-b line stepped back', 'landscape', 520, 21],
    ['LS-b', 'Landscape, farther back', 'landscape', 600, 21],
    ['LS-c', 'Landscape, higher and steeper', 'landscape', 520, 26],
  ] as const) {
    const radians = down * Math.PI / 180;
    poses.push(aimedPose(lb.target, cells, { id, name, headingDegrees: lb.headingDegrees, aspect, fovDegrees: HERO_1X_FOV[aspect],
      height: Math.round(slant * Math.sin(radians)), distance: Math.round(slant * Math.cos(radians)) }));
  }
  return { junction: round3.junction, surrounding: round3.surrounding, poses };
}

/**
 * G343 hero round 4 (Jake: "standing above Driftwood looking the other way … above Nalati looking towards Pine … above
 * Pine looking towards Nalati"; never above the template, which would spend the frame's best detail on itself): the eye
 * over each of the three highest-quality shards, aimed across the roundabout at the others, with the near-placeholder
 * tier on (G342). Three poses a spot: over the cell's centre, nearer the roundabout and lower, and back over its outer
 * edge and higher; each as the square (G344's phone-1x 62°) and the landscape (43° vertical, ~70° across).
 */
export function round4HeroPlan(): { junction: string; surrounding: readonly string[]; poses: LandscapeHeroPose[] } {
  const round3 = landscapeHeroPlan();
  const grid = new GridAssembly({ developer: true, devserver: false });
  const cells = grid.cells.filter(cell => round3.surrounding.includes(cell.instance));
  const target = round3.poses.at(0)?.target;
  if (target === undefined) throw new Error('Round 4 aims at round 3’s roundabout');
  const poses: LandscapeHeroPose[] = [];
  for (const [code, slug, name] of [['DW', 'driftwood-isle', 'Driftwood'], ['NA', 'nalati-grasslands', 'Nalati'], ['PH', 'pine-hollow', 'Pine']] as const) {
    const cell = cells.find(c => c.slug === slug);
    if (cell === undefined) throw new Error(`Round 4 stands over ${slug}, which is not at the roundabout`);
    const headingDegrees = Math.atan2(cell.origin.x - target.x, cell.origin.z - target.z) * 180 / Math.PI;
    const centre = Math.hypot(cell.origin.x - target.x, cell.origin.z - target.z);
    // The player stands in the cell a third of the way from its centre to the roundabout: the part of the cell in frame
    // (from below the eye to the roundabout) then sits inside its L0 / L1 rings, whichever of the three poses shoots.
    const over = { instance: cell.instance, slug, stand: { x: Math.round(cell.origin.x + (target.x - cell.origin.x) / 3),
      z: Math.round(cell.origin.z + (target.z - cell.origin.z) / 3) } };
    for (const [variant, label, distance, height] of [
      ['a', 'over its centre', centre, 260], ['b', 'nearer and lower', centre - 90, 200], ['c', 'back over its edge, higher', centre + 110, 320],
    ] as const) {
      for (const aspect of ['square', 'landscape'] as const) {
        poses.push({ ...aimedPose(target, cells, { id: `${aspect === 'square' ? 'SQ' : 'LS'}-${code}-${variant}`, name: `Above ${name}, ${label}`,
          headingDegrees, height, distance: Math.round(distance), aspect, fovDegrees: HERO_1X_FOV[aspect] }), over });
      }
    }
  }
  return { junction: round3.junction, surrounding: round3.surrounding, poses };
}

/**
 * G372 hero round 5 (Jake: "above the center of Nalati, looking at Driftwood, so that we can see far more of the 3x3
 * grid … when you're above Nalati looking at Pine, you just see a small fraction of the 3x3 and the infinite void
 * beyond"): the eye over Nalati's centre, aimed west across the grid at Driftwood, the near tier on (G371: the cells
 * nearest the eye, diagonals included). Three heights / tilts: `a` 260 m at Driftwood's centre (round 4's NA-a height),
 * `b` 420 m steeper at the same point, `c` 340 m aimed past Driftwood at the far roundabout row; each square (62°) and
 * landscape (43° vertical). The player stands in Nalati a third of the way toward Driftwood (entered, its own runtime).
 */
export function round5HeroPlan(): { junction: string; surrounding: readonly string[]; road: LandscapeHeroPose['target']; poses: LandscapeHeroPose[] } {
  const round3 = landscapeHeroPlan(), road = round3.poses.at(0)?.target;
  if (road === undefined) throw new Error('Round 5 starts from round 3’s roundabout');
  const grid = new GridAssembly({ developer: true, devserver: false });
  const nalati = grid.cells.find(c => c.slug === 'nalati-grasslands'), driftwood = grid.cells.find(c => c.slug === 'driftwood-isle');
  if (nalati === undefined || driftwood === undefined) throw new Error('Round 5 stands over Nalati looking at Driftwood');
  const placed = grid.cells.filter(cell => Math.abs(cell.origin.x - nalati.origin.x) <= 2 * grid.pitch && Math.abs(cell.origin.z - nalati.origin.z) <= 2 * grid.pitch);
  const over = { instance: nalati.instance, slug: nalati.slug, stand: { x: Math.round(nalati.origin.x + (driftwood.origin.x - nalati.origin.x) / 3),
    z: Math.round(nalati.origin.z + (driftwood.origin.z - nalati.origin.z) / 3) } };
  const toward = { x: driftwood.origin.x - nalati.origin.x, z: driftwood.origin.z - nalati.origin.z }, span = Math.hypot(toward.x, toward.z);
  const poses: LandscapeHeroPose[] = [];
  for (const [variant, label, height, reach] of [
    ['a', 'over its centre, at Driftwood', 260, 1], ['b', 'over its centre, higher and steeper', 420, 1], ['c', 'over its centre, aimed past Driftwood', 340, 1.5],
  ] as const) {
    const target = { x: nalati.origin.x + toward.x * reach, y: 0, z: nalati.origin.z + toward.z * reach };
    const headingDegrees = Math.atan2(nalati.origin.x - target.x, nalati.origin.z - target.z) * 180 / Math.PI;
    for (const aspect of ['square', 'landscape'] as const) {
      poses.push({ ...aimedPose(target, placed, { id: `${aspect === 'square' ? 'SQ' : 'LS'}-NW-${variant}`, name: `Above Nalati toward Driftwood, ${label}`,
        headingDegrees, height, distance: Math.round(span * reach), aspect, fovDegrees: HERO_1X_FOV[aspect] }), over });
    }
  }
  return { junction: round3.junction, surrounding: round3.surrounding, road, poses };
}

/**
 * G379 / G380 hero round 6 (Jake: "in the center of the edge of Nalati so we can see all of Nalati, Driftwood and a bit
 * more of the other shards"): the eye over the midpoint of Nalati's edge on the side away from Driftwood, aimed across
 * Nalati at Driftwood, at three heights and tilts; square and landscape at the phone-1x lens.
 */
export function round6HeroPlan(): ReturnType<typeof round5HeroPlan> {
  const round5 = round5HeroPlan(), grid = new GridAssembly({ developer: true, devserver: false });
  const nalati = grid.cells.find(c => c.slug === 'nalati-grasslands'), driftwood = grid.cells.find(c => c.slug === 'driftwood-isle');
  if (nalati === undefined || driftwood === undefined) throw new Error('Round 6 stands over Nalati\'s far edge looking at Driftwood');
  const placed = grid.cells.filter(cell => Math.abs(cell.origin.x - nalati.origin.x) <= 2 * grid.pitch && Math.abs(cell.origin.z - nalati.origin.z) <= 2 * grid.pitch);
  const toward = { x: driftwood.origin.x - nalati.origin.x, z: driftwood.origin.z - nalati.origin.z }, span = Math.hypot(toward.x, toward.z), half = 250;
  const over = { instance: nalati.instance, slug: nalati.slug, stand: { x: Math.round(nalati.origin.x - toward.x / span * (half - 40)), z: Math.round(nalati.origin.z - toward.z / span * (half - 40)) } };
  const poses: LandscapeHeroPose[] = [];
  for (const [variant, label, height, reach] of [
    ['a', 'over its far edge, at Driftwood', 320, 1], ['b', 'over its far edge, higher and steeper', 520, 1], ['c', 'over its far edge, aimed past Driftwood', 420, 1.35],
  ] as const) {
    const target = { x: nalati.origin.x + toward.x * reach, y: 0, z: nalati.origin.z + toward.z * reach };
    const headingDegrees = Math.atan2(nalati.origin.x - target.x, nalati.origin.z - target.z) * 180 / Math.PI;
    for (const aspect of ['square', 'landscape'] as const) {
      poses.push({ ...aimedPose(target, placed, { id: `${aspect === 'square' ? 'SQ' : 'LS'}-NE-${variant}`, name: `Above Nalati's far edge toward Driftwood, ${label}`,
        headingDegrees, height, distance: Math.round(span * reach + half), aspect, fovDegrees: HERO_1X_FOV[aspect] }), over });
    }
  }
  return { ...round5, poses };
}

/**
 * G575 / G576 round 36 (far variants): the three views the far haze and hologram fade are judged from: round 6's shipped
 * hero (SQ-NE-b), the whole 5 × 5 overview (grid5x5HeroPlan's A) and one outer road, the eye 22 m over the road between
 * the first and second rings east of Driftwood, looking north along it past the outer band's plots. The player keeps
 * round 5's roundabout for all three (the far ring covers the whole sightline).
 */
export function farVariantPlan(): ReturnType<typeof round5HeroPlan> {
  const round6 = round6HeroPlan(), overview = grid5x5HeroPlan(), grid = new GridAssembly({ developer: true, devserver: false });
  const driftwood = grid.cells.find(c => c.slug === 'driftwood-isle'), hero = round6.poses.find(p => p.id === 'SQ-NE-b'), whole = overview.poses.find(p => p.id === 'A');
  if (driftwood === undefined || hero === undefined || whole === undefined) throw new Error('Round 36 needs Driftwood, SQ-NE-b and the 5 × 5 pose A');
  const x = driftwood.origin.x + 1.5 * grid.pitch, z = driftwood.origin.z, target = { x, y: 0, z: z + 2 * grid.pitch };
  const road = aimedPose(target, grid.cells, { id: 'OUTER-ROAD', name: 'The outer road east of Driftwood, looking north past the outer band',
    headingDegrees: 180, height: 22, distance: 2 * grid.pitch, aspect: 'square', fovDegrees: HERO_1X_FOV.square });
  return { ...round6, poses: [hero, { ...whole, id: '5x5-A' }, { ...road, farMetres: Math.ceil(3 * grid.pitch) }] };
}

/**
 * G536 (Jake: "If the 5x5 grid is live, we have to retake this hero image in the game"): the whole 5 × 5 (the eleven
 * shard cells and the fourteen billboard plots, ±2 pitches round Driftwood) in the portrait centre band, at the phone-1x
 * square lens. Three candidates aimed at Driftwood's centre: `A` round 6's side (east, over Nalati and Ink-cel), an
 * oblique that keeps a strip of sky; `B` from Pine's side, steep and map-like; `C` low over template-2's
 * corner, the grid receding to the horizon. The player stays on round 5's road; every cell keeps its shipped tier.
 * The eye has to stand 1.5–3 km from the cells to hold all 25 at 62°, so the engine's distance fog pales them.
 */
export function grid5x5HeroPlan(): ReturnType<typeof round5HeroPlan> {
  const round5 = round5HeroPlan(), grid = new GridAssembly({ developer: true, devserver: false });
  const driftwood = grid.cells.find(c => c.slug === 'driftwood-isle');
  if (driftwood === undefined) throw new Error('The 5 × 5 hero is aimed at Driftwood');
  const target = { x: driftwood.origin.x, y: 0, z: driftwood.origin.z };
  const poses: LandscapeHeroPose[] = [];
  for (const [id, label, headingDegrees, height, distance] of [
    ['A', 'from the east over Nalati and Ink-cel, oblique with sky', 70, 1350, 2600],
    ['B', 'from Pine’s side, steep and map-like', 0, 2300, 1500],
    ['C', 'low over the template-2 corner, receding', 45, 600, 2600],
  ] as const) {
    const pose = aimedPose(target, grid.cells, { id, name: `The whole 5 × 5, ${label}`, headingDegrees, height, distance, aspect: 'square', fovDegrees: HERO_1X_FOV.square });
    poses.push({ ...pose, farMetres: Math.ceil(Math.hypot(height, distance) + 3 * grid.pitch) });
  }
  return { ...round5, poses };
}
