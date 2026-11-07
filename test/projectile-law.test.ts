import { afterEach, expect, test } from 'vitest';
import { BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Vector2 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { Forest } from '../src/client/engine/world/forest/Forest';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { Projectiles } from '../src/client/engine/combat/view/projectile';
import { ProjectileLaw, segmentCapsule } from '../src/shared/engine/combat/projectileLaw';

// The projectile law (projectileLaw.ts) run bare, as a Node simulation runs it, beside the drawn Projectiles: an enemy
// arrow's flight, its glance-free stop and the player's body it strikes must match step by step.
let restore = (): void => undefined;
afterEach(() => { restore(); });
const kind = { length: 0.5, gravity: 4, drag: 0.02, windCoupling: 0, bury: 0, recover: 0, maxFlying: 4, maxStuck: 0, stick: false, hitsAnimals: false,
  puffs: false, hurtsPlayer: { radius: 0.4, height: 1.8 } };

test('the bare projectile law flies and strikes the player exactly as the drawn arrows do', () => {
  restore = bindFlatTerrain({ heightAt: () => 0 });
  const game = {} as Game;
  Object.defineProperties(game, { scene: { value: new Scene() }, camera: { value: new PerspectiveCamera(60) }, app: { value: app },
    renderer: { value: { getDrawingBufferSize: (out: Vector2) => out.set(800, 600) } } });
  const player = { position: new Vector3(0, 0, 30) } as Player;
  const drawn = new Projectiles({ game, sky: {} as SkyRig, player, forest: {} as Forest }, undefined,
    { ...kind, geometry: new BoxGeometry(0.02, 0.02, 0.5), material: new MeshBasicMaterial() });
  const drawnHits: number[][] = [], bareHits: number[][] = [];
  drawn.onPlayerHit = at => { drawnHits.push(at.toArray().map(n => Math.round(n * 1e6) / 1e6)); };
  const bare = new ProjectileLaw<{ id: number }, null>(kind, { feet: player.position, extent: 1e4, floorAt: () => 0, world: () => null, targets: () => null,
    wind: () => null, surface: () => 'ground', random: () => 0.5, canRecover: () => true, recover: () => undefined, flight: id => ({ id }), stuck: () => null,
    moved: () => undefined, ended: () => undefined, settled: () => undefined, changed: () => undefined, removed: () => undefined, impact: () => undefined,
    playerHit: at => { bareHits.push(at.toArray().map(n => Math.round(n * 1e6) / 1e6)); }, targetHit: () => undefined, hit: () => undefined });
  const shots = [[new Vector3(0, 1.6, 0), new Vector3(0, 1.2, 40)], [new Vector3(5, 1.2, 0), new Vector3(-5, 1, 30)], [new Vector3(-3, 1, 2), new Vector3(9, 6, 20)]] as const;
  for (const [from, velocity] of shots) { drawn.launch(from, velocity, { damageScale: 1 }); bare.launch(from, velocity, { damageScale: 1 }); }
  for (let i = 0; i < 600; i++) {
    drawn.update(1 / 60); bare.update(1 / 60);
    expect(bare.pool.slots.filter(f => f.active).length).toBe(drawn.inFlight); expect(bareHits).toEqual(drawnHits);
  }
  expect(bareHits).toEqual(drawnHits); expect(bareHits.length).toBeGreaterThan(0);
});

test('the body capsule: a segment through the player strikes at the first touch, past or over it misses', () => {
  const feet = new Vector3(0, 0, 10);
  expect(segmentCapsule(new Vector3(0, 1, 0), new Vector3(0, 0, 1), 20, feet, 0.4, 1.8)).toBeCloseTo(9.6, 6);
  expect(segmentCapsule(new Vector3(0, 3, 0), new Vector3(0, 0, 1), 20, feet, 0.4, 1.8)).toBe(-1);
  expect(segmentCapsule(new Vector3(2, 1, 0), new Vector3(0, 0, 1), 20, feet, 0.4, 1.8)).toBe(-1);
  expect(segmentCapsule(new Vector3(0, 1, 0), new Vector3(0, 0, 1), 5, feet, 0.4, 1.8)).toBe(-1);
});
