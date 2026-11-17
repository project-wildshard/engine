// NET-LAG NL13b3 (meta docs/plans/NET-LAG-PLAN.md): the page's world and the room's never add their colliders in the same order
// (the page streams terrain, draws others, owns its capsule first or last), so a step that depends on that order corrects the owner
// even with nothing lost on the link. Staging v0.1.34 corrected Sky Reach 8.5 to 43.6 times a minute (B2 allows 2): its decks were
// six overlapping rotated strips, and a capsule crossing one strip's edges buried in another took whichever edge the world's
// tree gave it first. Same command, same state, different feet: 0.1 mm on the deck at once, 6.7 mm in four seconds, then 2 to
// 5 cm against the windmill. A deck shard's walkable ground must give the same walk in any collider order.
// oxlint-disable-next-line import/no-nodejs-modules -- reads the pinned shard's physics plan and the shipped Rapier
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { addBakedPieces } from '../src/server/game/plugin/simulation';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';

let R: Rapier;
beforeAll(async () => { R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });

interface Piece { readonly id: string; readonly category?: string; readonly colliders: readonly { readonly x?: number; readonly y?: number; readonly z?: number; readonly hy?: number }[] }
const ground = (slug: string): Piece[] => (JSON.parse(readFileSync(`out/${slug}/sections/sim/runtime-plan.json`, 'utf8')) as { baked: { pieces: Piece[] } })
  .baked.pieces.filter(piece => piece.category === 'ground');

/** Across a deck through its middle for four seconds, weaving, in a world whose other colliders came first or last. */
function walk(pieces: readonly Piece[], centre: { x: number; y: number; z: number }, othersFirst: boolean): number[] {
  const physics = new Physics(R), others = (): void => { for (let i = 0; i < 3; i++) physics.world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(centre.x + 400 + i * 5, 0, centre.z)); };
  if (othersFirst) others();
  const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY });
  addBakedPieces(physics, pieces);
  if (!othersFirst) others();
  const feet = { x: centre.x - 1.6, y: centre.y + 0.02, z: centre.z + 9 }, path: number[] = [];
  try {
    for (let tick = 0; tick < 240; tick++) {
      physics.step();
      const side = tick % 90 > 60 && tick % 90 < 70 ? -2 / 60 : 0;
      motor.move(feet, { x: side, y: -22 / 3600, z: -4.3 / 60 });
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
    const a = walk([deck], centre, true), b = walk([deck], centre, false);
    const worst = a.reduce((most, value, i) => Math.max(most, Math.abs(value - (b[i] ?? Number.NaN))), 0);
    expect(worst, `${deck.id}: the walk parts by ${worst.toExponential(2)} m with the colliders' order`).toBe(0);
  }
});
