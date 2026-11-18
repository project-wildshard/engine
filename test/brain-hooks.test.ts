import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test, vi } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { parseDecisionScripts, type DecisionScriptRow } from '@wildshard/format/decisionScripts';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_EVENTS as ON } from '@wildshard/format/scriptAbiV1';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { groundFixture } from './fixtures/plain-ground';
import { decisionGuest } from './fixtures/decisionHarness';

// ONE-FORMAT CC59: a script hooks a brain-owned creature. The brain keeps the body; the hook hears its hits (with the
// hit's tags as a mask), its broken parts and may replace the brain's next ability.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const ACTOR = 'fixture.actor', CLAW = 2;

async function hooked(body: string, row: Partial<DecisionScriptRow> = {}, scriptDisabled?: () => void) {
  const source = groundFixture(true);
  const species = source.rows.species[0], bite = source.rows.strikes[0], spawn = source.creatures.spawns[0];
  if (species?.temperament === undefined || bite === undefined || spawn === undefined) throw new Error('Missing layered fixture');
  spawn.strike = null; source.spawn.z = 7 - 12;
  species.temperament.brain = 'pursue';
  species.temperament.tuning = { speed: 0, turnRate: 8, thinkDivisor: 1, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 60 };
  species.senses = { notice: 25 };
  species.abilities = [{ use: 'fixture.bite', range: 2, cooldown: 3, weight: 1 }, { use: 'fixture.claw', range: 2, cooldown: 3, weight: 1 }];
  source.rows = parseRows({ ...source.rows, strikes: [{ ...bite, recover: 0.1 }, { ...bite, id: 'fixture.claw' }] });
  const wasm = await decisionGuest(body), hash = hashImmutableBytes(wasm);
  const scripts = parseDecisionScripts([{ id: 'hook', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/hook.as', binding: { brain: ACTOR },
    onFail: 'hold', on: ['hit', 'part.broken'], reads: [], commands: ['ability'], stateVersion: 1, state: [{ name: 'seen', type: 'f64', default: -1, scope: 'binding' }], params: {},
    actors: { self: ACTOR }, strikes: { claw: 'fixture.claw' }, tags: { fire: 'dmg.fire', ice: 'dmg.ice' }, ...row }]);
  const sim = createShardfileSim(source, new Map([[hash, wasm]]), { rapier: await rapier, sections: new Map([['sim/scripts', scripts]]), ...(scriptDisabled === undefined ? {} : { scriptDisabled }) });
  const actor = sim.host.entities.get(ACTOR), decisions = sim.decisions;
  if (actor === undefined || decisions === undefined) throw new Error('Missing hooked creature');
  const decide = (): void => { do sim.host.step(); while (sim.host.state.tick % 6 !== 0); sim.host.step(); };
  const hit = (tags: `${string}.${string}`[], amount = 1): void => { sim.host.combat.hit({ source: 'env', sourceTags: tags, target: actor.combatActor(), amount, point: actor.position.clone(), dir: new Vector3(0, 0, 1) }); };
  const close = (): void => { sim.host.focusedPlayer.resetPose({ x: actor.position.x, y: actor.position.y, z: actor.position.z - 1.5 }, 0); };
  return { sim, actor, decisions, decide, hit, close };
}
const swapBelowHalf = `for(let i=0;i<events();i++){if(ev(i,0)==${ON.hit}&&ev(i,4)<0.5)emit(${DO.ability},self(),${CLAW},0,0);}`;

test('a hook at 50% swaps the brain\'s next ability', async () => {
  const run = await hooked(swapBelowHalf);
  try {
    run.actor.hp = run.actor.maxHp * 0.45; run.hit(['dmg.melee']); run.decide();
    expect(run.actor.nextAbility).toBe('fixture.claw');
    run.close(); run.sim.host.step();
    expect(run.sim.host.strikes.get(ACTOR)?.spec?.id).toBe('fixture.claw');
    expect(run.actor.nextAbility).toBeNull();
  } finally { run.sim.dispose(); }
});

test('above 50% the brain keeps its own pick', async () => {
  const run = await hooked(swapBelowHalf);
  try {
    run.hit(['dmg.melee']); run.decide();
    expect(run.actor.nextAbility).toBeNull();
    run.close(); run.sim.host.step();
    expect(run.sim.host.strikes.get(ACTOR)?.spec?.id).toBe('fixture.bite');
  } finally { run.sim.dispose(); }
});

test('a hook reads fire on the last hit', async () => {
  const run = await hooked(`for(let i=0;i<events();i++){if(ev(i,0)==${ON.hit})setState(0,ev(i,5));}`);
  try {
    run.hit(['dmg.fire']); run.decide();
    expect(run.decisions.host.state(1)['seen']).toBe(1);
    run.hit(['dmg.melee', 'dmg.ice']); run.decide();
    expect(run.decisions.host.state(1)['seen']).toBe(2);
    run.hit(['dmg.melee']); run.decide();
    expect(run.decisions.host.state(1)['seen']).toBe(0);
  } finally { run.sim.dispose(); }
});

test('a hook hears its creature\'s broken part', async () => {
  const run = await hooked(`for(let i=0;i<events();i++){if(ev(i,0)==${ON['part.broken']}&&ev(i,1)==self())setState(0,ev(i,2));}`);
  try {
    run.sim.host.events.emit('creature.part-broken', { actor: run.actor.combatActor(), part: 'plate', index: 3 });
    run.decide();
    expect(run.decisions.host.state(1)['seen']).toBe(3);
  } finally { run.sim.dispose(); }
});

test('an over-fuel hook is stopped and reported while its brain fights on', async () => {
  const disabled = vi.fn();
  const run = await hooked('let n:i32=0;while(n>=0){n++;}', { on: ['hit'] }, disabled);
  try {
    for (let call = 0; call < 3; call++) { run.hit(['dmg.melee']); run.decide(); }
    expect(run.decisions.host.metrics()[0]).toMatchObject({ refusals: 3, disabled: true });
    expect(disabled).toHaveBeenCalledTimes(1);
    run.close(); run.sim.host.step();
    expect(run.sim.host.strikes.get(ACTOR)?.spec?.id).toBe('fixture.bite');
  } finally { run.sim.dispose(); }
});

test('a brain hook may not take a creature no brain drives', async () => {
  const source = groundFixture(false);
  const wasm = await decisionGuest(swapBelowHalf), hash = hashImmutableBytes(wasm);
  const spawn = source.creatures.spawns[0]; if (spawn === undefined) throw new Error('Missing spawn');
  spawn.brain = null;
  const scripts = parseDecisionScripts([{ id: 'hook', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/hook.as', binding: { brain: ACTOR },
    onFail: 'hold', on: ['hit'], reads: [], commands: ['ability'], stateVersion: 1, state: [{ name: 'seen', type: 'f64', default: -1, scope: 'binding' }], params: {},
    actors: { self: ACTOR }, strikes: { claw: 'fixture.bite' } }]);
  const physics = await rapier;
  expect(() => createShardfileSim(source, new Map([[hash, wasm]]), { rapier: physics, sections: new Map([['sim/scripts', scripts]]) })).toThrow('brain-owned');
});
