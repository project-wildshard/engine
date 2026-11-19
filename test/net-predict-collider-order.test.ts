// NET-LAG NL13b3 (meta docs/plans/NET-LAG-PLAN.md): the page's world and the room's never add their colliders in the same order
// (the page streams terrain, draws others, owns its capsule first or last), so a step that depends on that order corrects the owner
// even with nothing lost on the link. Staging v0.1.34 corrected Sky Reach 8.5 to 43.6 times a minute (B2 allows 2): its decks were
// six overlapping rotated strips, and a capsule crossing one strip's edges buried in another took whichever edge the world's
// tree gave it first. Same command, same state, different feet: 0.1 mm on the deck at once, 6.7 mm in four seconds, then 2 to
// 5 cm against the windmill. A deck shard's walkable ground must give the same walk in any collider order.
// NL13b4: rev 4's prism decks fixed the open deck, and staging still corrected Chromium 8.5 to 18.4 a minute at the windmill,
// whose tower box (corners at r 3.25) poked out of its sixteen-sided drum (r 3): a capsule against that corner touched two
// overlapping convex shapes. A walk hugging every piece that stands on a deck must not depend on the order either.
// oxlint-disable-next-line import/no-nodejs-modules -- reads the pinned shard's physics plan and the shipped Rapier
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { addBakedPieces } from '../src/server/game/plugin/simulation';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

interface Piece { readonly id: string; readonly category?: string; readonly colliders: readonly { readonly x?: number; readonly y?: number; readonly z?: number; readonly hx?: number; readonly hy?: number; readonly hz?: number }[] }
const pieces = (slug: string): Piece[] => (JSON.parse(readFileSync(`out/${slug}/sections/sim/runtime-plan.json`, 'utf8')) as { baked: { pieces: Piece[] } })
  .baked.pieces;
const ground = (slug: string): Piece[] => pieces(slug).filter(piece => piece.category === 'ground');

type Step = (feet: { x: number; y: number; z: number }, tick: number) => { x: number; y: number; z: number };
/** Across a deck through its middle for four seconds, weaving. */
const weave: Step = (_feet, tick) => ({ x: tick % 90 > 60 && tick % 90 < 70 ? -2 / 60 : 0, y: -22 / 3600, z: -4.3 / 60 });

/** `steps` from `start` for four seconds in a world whose other colliders came first or last. */
function walk(pieces: readonly Piece[], start: { x: number; y: number; z: number }, othersFirst: boolean, step: Step = weave): number[] {
  const centre = start;
  const physics = new Physics(R), others = (): void => { for (let i = 0; i < 3; i++) physics.world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(centre.x + 400 + i * 5, 0, centre.z)); };
  if (othersFirst) others();
  const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  addBakedPieces(physics, pieces);
  if (!othersFirst) others();
  const feet = { ...start }, path: number[] = [];
  try {
    for (let tick = 0; tick < 240; tick++) {
      physics.step();
      motor.move(feet, step(feet, tick));
      path.push(feet.x, feet.y, feet.z);
    }
  } finally { motor.dispose(); physics.dispose(); }
  return path;
}

test.each(['far-reach'])('%s: every deck walks the same in any collider order', (slug) => {
  const decks = ground(slug);
  expect(decks.length).toBeGreaterThan(0);
  for (const deck of decks) {
    const c = deck.colliders[0], centre = { x: c?.x ?? 0, y: (c?.y ?? 0) + (c?.hy ?? 1), z: c?.z ?? 0 };
    const start = { x: centre.x - 1.6, y: centre.y + 0.02, z: centre.z + 9 };
    const a = walk([deck], start, true), b = walk([deck], start, false);
    const worst = a.reduce((most, value, i) => Math.max(most, Math.abs(value - (b[i] ?? Number.NaN))), 0);
    expect(worst, `${deck.id}: the walk parts by ${worst.toExponential(2)} m with the colliders' order`).toBe(0);
  }
});

/**
 * NL13b4: rev 4's prism decks fixed the open deck; staging still corrected Chromium 8.5 to 18.4 a minute at the windmill.
 * The cause was not the windmill's shape. A grounded capsule leaning on any wall met the floor and the wall at time 0 (both
 * within the controller's skin) and Rapier kept whichever its query tree visited first, so the order the world was built in
 * picked the slide: before the motor's lifted sideways rest this walk parted by up to 20 cm. A plain box wall on a box floor
 * off its centre parted too, and one convex windmill hull, or a drum that held the tower's corners, parted as often.
 */
test('far-reach: a walk glancing off the windmill is the same in any collider order', () => {
  const all = pieces('far-reach'), decks = all.filter(piece => piece.category === 'ground'), mill = all.filter(piece => piece.id === 'far.windmill');
  expect(mill).toHaveLength(1);
  const at = { x: mill[0]?.colliders[0]?.x ?? 0, z: mill[0]?.colliders[0]?.z ?? 0 };
  const glance = (start: number, lateral: number): Step => {
    const tx = at.x - lateral * Math.sin(start) - 6 * Math.cos(start), tz = lateral * Math.cos(start) - 6 * Math.sin(start), tl = Math.hypot(tx, tz);
    return () => ({ x: tx / tl * 4.3 / 60, y: -22 / 3600, z: tz / tl * 4.3 / 60 });
  };
  let worst = 0;
  for (let k = 0; k < 16; k++) {
    const start = k * Math.PI / 8 + 0.1, from = { x: at.x + 6 * Math.cos(start), y: 30.02, z: at.z + 6 * Math.sin(start) };
    const a = walk([...decks, ...mill], from, true, glance(start, 1.5)), b = walk([...mill, ...decks], from, false, glance(start, 1.5));
    worst = Math.max(worst, a.reduce((most, value, i) => Math.max(most, Math.abs(value - (b[i] ?? Number.NaN))), 0));
  }
  expect(worst, `a walk along the windmill parts by ${worst.toExponential(2)} m with the colliders' order`).toBe(0);
});

/**
 * Nine Dragon: staging v0.1.37 corrected a Chromium sprint 114 times a minute (worst 2.76 m) along the square's balustrade.
 * The drawn stone had no collider under the square's cap (it starts 1.12 m up), so the feet slid past the slab's edge and
 * hung on it under the cap, a capsule on an edge and a cap at once: the page and the room parted by up to a metre. Along the
 * street, with no cap, the walk went through the drawn stone into the Well. A walk pressed against either run keeps its feet
 * on the floor, inside the stone, and steps the same in any collider order.
 */
test('nine-dragon-stack: a walk pressed along the balustrade stays on the floor in any collider order', () => {
  interface Placed { readonly id: string; readonly name: string; readonly file: string; readonly category?: string; readonly surface: string; readonly colliderOwner?: string; readonly when?: { readonly variant?: string }; readonly colliders: readonly { readonly kind: string }[] }
  const scene = JSON.parse(readFileSync('out/nine-dragon-stack/sections/world/scenes.json', 'utf8')) as { entry: { blocks: { pieces: Placed[] } } };
  const nine = scene.entry.blocks.pieces.filter(piece => piece.when?.variant !== 'open').map(piece => ({ id: piece.id, name: piece.name, file: piece.file, active: true,
    ...(piece.category === undefined ? {} : { category: piece.category }), surface: piece.surface, ...(piece.colliderOwner === undefined ? {} : { owner: piece.colliderOwner }),
    colliders: piece.colliders.filter(collider => collider.kind === 'box') })) as unknown as Piece[];
  const pressed: Step = () => ({ x: -1 / 60, y: -22 / 3600, z: -7 / 60 });
  // the stone's inner face (squareParts WELL_RUNS: x = 0.2 by the square, 0.7 by the street, a 0.62 m plinth) plus the radius
  for (const [run, start, face] of [['square', { x: 0.95, y: 125.02, z: 7.5 }, 0.2 + 0.31], ['street', { x: 1.6, y: 125.02, z: -28 }, 0.7 + 0.31]] as const) {
    const a = walk(nine, start, true, pressed), b = walk([...nine].reverse(), start, false, pressed);
    const worst = a.reduce((most, value, i) => Math.max(most, Math.abs(value - (b[i] ?? Number.NaN))), 0);
    const west = Math.min(...a.filter((_, i) => i % 3 === 0)), low = Math.min(...a.filter((_, i) => i % 3 === 1));
    expect(west, `${run}: the feet reach x ${west.toFixed(3)}, past the stone's face`).toBeGreaterThan(face + PLAYER_CAPSULE.radius - 0.02);
    expect(low, `${run}: the feet drop to y ${low.toFixed(3)}`).toBeGreaterThan(124.9);
    expect(worst, `${run}: the walk parts by ${worst.toExponential(2)} m with the colliders' order`).toBe(0);
  }
});
