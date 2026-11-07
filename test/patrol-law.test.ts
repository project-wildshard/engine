import { EncounterPatrolSchema, PatrolViewSchema } from '@wildshard/format/encounterRows';
import { afterEach, expect, test, vi } from 'vitest';
import { Bone, BoxGeometry, BufferGeometry, MeshBasicMaterial, PerspectiveCamera, Scene, Skeleton, SkinnedMesh, Vector3, type Vector2 } from 'three';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import { RngService } from '../src/shared/engine/core/rng';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { Forest } from '../src/client/engine/world/forest/Forest';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import { PatrolEncounterView } from '../src/client/game/boss/encounterView';
import { PatrolLaw } from '../src/shared/game/boss/patrolLaw';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import { withWeatherWitness } from './fixtures/weatherInlineWitness';

// The patrol's law (patrolLaw.ts) run bare, as a Node simulation runs it, beside the drawn PatrolEncounterView over twin
// bodies and twin random streams: every rider's law, steering memory, the kills and the roster must match step by step.
const night = withWeatherWitness(nightInput);
const view = v.parse(PatrolViewSchema, { looks: { scout: 'orchard-scout', warden: 'orchard-warden', hush: 'orchard-hush' }, quietLook: 'hush', quietScale: 2,
  figure: { bone: 'saddle' }, seat: [0, 1, 0], states: { fade: 'fade', dying: 'dying', dead: 'dead' },
  cues: { form: 'cue.orchard.form', tear: 'cue.orchard.tear', loose: 'cue.orchard.loose', hurt: 'cue.orchard.hurt', impact: 'cue.orchard.impact' },
  lift: { form: 0.5, loose: 0.2 }, trail: { cue: 'cue.orchard.trail', rate: 0, back: 1 }, aim: 'aim', damage: 7,
  targets: [{ at: [0, 1.5, 0], radius: 0.3, head: true }],
  arrow: { geometry: { data: new BufferGeometry().copy(new BoxGeometry(0.02, 0.02, 0.5)).toJSON().data }, colour: [1, 0.8, 0.3], renderOrder: 9, length: 0.5, gravity: 4, drag: 0, windCoupling: 0, bury: 0, recover: 0,
    maxFlying: 4, maxStuck: 0, stick: false, hitsAnimals: false, puffs: false, hurtsPlayer: { radius: 0.4, height: 1.8 } } });
const patrol = { ...v.parse(EncounterPatrolSchema, night.patrol), actors: { kind: 'orchard-watch', variant: 'scout', leader: 'warden', count: 2, herd: -2,
  player: { x: 'px', z: 'pz' }, target: { x: 'tx', z: 'tz' }, steering: { tx: 'tx', tz: 'tz', v: 'v', turn: 'turn' } } };
const ids = ['form', 'tear', 'loose', 'hurt', 'impact', 'trail'].map(id => `cue.orchard.${id}`);
function body(id: string, x: number, z: number, yaw: number, variant: string) {
  const saddle = new Bone(); saddle.name = 'saddle';
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial()); mesh.add(saddle); mesh.bind(new Skeleton([saddle]));
  return { entityId: id, kind: 'orchard-watch', position: new Vector3(x, 0, z), yaw, variant, herd: 0, alive: true, hidden: false, scale: 1, mesh,
    mem: {} as Record<string, number>, applyDamage: () => false, damageFor: () => 0 };
}
type Body = ReturnType<typeof body>;
let restore = (): void => undefined;
afterEach(() => { restore(); vi.restoreAllMocks(); });

test('the bare patrol law runs the drawn patrol exactly: lines, laws, steering, kills, dawn, retire', () => {
  restore = bindFlatTerrain({ heightAt: () => 2 });
  app.rng.seed(4242); const twin = new RngService(); twin.seed(4242);
  const scope = new Scope('orchard-watch'), game = {} as Game;
  lendLooks(scope, { materials: new Map(['orchard-scout', 'orchard-warden', 'orchard-hush'].map(id => [id, new MeshBasicMaterial()])), setParam: () => undefined,
    setTexture: () => undefined, bindMeshMap: () => new MeshBasicMaterial(), instance: () => ({ material: new MeshBasicMaterial(), setParam: () => undefined }) });
  Object.defineProperties(game, { levelScope: { value: scope }, app: { value: app }, scene: { value: new Scene() }, camera: { value: new PerspectiveCamera(60) },
    renderer: { value: { getDrawingBufferSize: (out: Vector2) => out.set(800, 600) } } });
  const player = { position: new Vector3(0, 2, 30) } as Player, cues = new CueDirector(game, { version: 1, fields: [], rows: ids.map(id => ({ id, vfx: [] })) });
  vi.spyOn(cues, 'cue').mockImplementation(() => undefined);
  const figure = new BoxGeometry(0.4, 1, 0.4), drawnBodies: Body[] = [], bareBodies: Body[] = [];
  const drawn = new PatrolEncounterView<Body>({ patrol, motion: night.motion, view }, ReturnProgram.page(night.program),
    { game, sky: {} as SkyRig, player, forest: {} as Forest, cues, figures: { scout: figure, warden: figure, hush: figure } });
  drawn.attachActors({ factory: { model: () => undefined }, spawn: (_k, x, z, yaw, variant) => { const b = body(String(drawnBodies.length), x, z, yaw, variant); drawnBodies.push(b); return b; }, retire: a => { a.hidden = true; } });
  const bare = new PatrolLaw<Body, null>(patrol, night.motion, ReturnProgram.page(night.program), { player, random: twin.stream('ai'), aimRandom: () => twin.stream('ai'), present: () => null });
  bare.attachActors({ factory: { model: () => undefined }, spawn: (_k, x, z, yaw, variant) => { const b = body(String(bareBodies.length), x, z, yaw, variant); bareBodies.push(b); return b; }, retire: a => { a.hidden = true; } });
  // the page's own order after a step: retire in reverse, skip the dead or hidden, aim each shot from the rider's seat
  const bareStep = (dt: number, frame: Readonly<Record<string, number>>): void => {
    const effects = bare.step(dt, frame);
    for (let i = bare.riders.length - 1; i >= 0; i--) {
      const r = bare.riders[i]; if (r === undefined) continue;
      const effect = effects.get(r);
      if (effect?.['retire'] === 1) { bare.retire(i); continue; }
      if (r.law.state['dead'] === 1 || r.a.hidden) continue;
      twin.stream('cosmetic').next();
      if (effect?.['shoot'] === 1) { const bone = r.a.mesh.skeleton.getBoneByName('saddle'); if (bone === undefined) throw new Error('saddle');
        const from = new Vector3(...view.seat).applyMatrix4(bone.matrixWorld); from.y += view.lift.loose * r.a.scale; bare.aim(view.aim, from); }
    }
  };
  const same = (): void => {
    expect(bare.killsTonight).toBe(drawn.killsTonight);
    expect(bare.riders.map(r => ({ id: r.a.entityId, variant: r.a.variant, hidden: r.a.hidden, law: { ...r.law.state }, mem: { ...r.a.mem }, slot: r.slot })))
      .toEqual(drawn.riders.map(r => ({ id: r.a.entityId, variant: r.a.variant, hidden: r.a.hidden, law: { ...r.law.state }, mem: { ...r.a.mem }, slot: r.slot })));
  };
  let shots = 0;
  const frame = (dt: number, t: number, f: Readonly<Record<string, number>>): void => {
    const hits = drawn.update(dt, t, f); bareStep(dt, f); same(); shots += hits.length;
    drawn.arrows.clearStuck();
  };
  for (let i = 0; i < 40; i++) frame(0.1, i * 0.1, { hold: 0, night: 1 });
  expect(drawn.riders.length).toBeGreaterThan(0);
  // a rider falls in both worlds, then the player walks in among them, then dawn dissolves the line and it retires
  const victim = drawn.riders[0], twinVictim = bare.riders[0];
  if (victim === undefined || twinVictim === undefined) throw new Error('Missing rider');
  victim.a.alive = false; twinVictim.a.alive = false;
  for (let i = 0; i < 40; i++) frame(0.1, 4 + i * 0.1, { hold: 1, night: 1 });
  player.position.set(2, 2, 4);
  for (let i = 0; i < 60; i++) frame(0.1, 8 + i * 0.1, { hold: 1, night: 1 });
  for (let i = 0; i < 120; i++) frame(0.1, 14 + i * 0.1, { hold: 0, night: 0 });
  expect(drawnBodies.length).toBe(bareBodies.length); expect(drawnBodies.length).toBeGreaterThan(1);
  expect(shots).toBeGreaterThanOrEqual(0);
});
