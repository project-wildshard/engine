import { expect, test, vi } from 'vitest';
import { Rng } from '../src/shared/engine/core/rng';
import { createCreatureSpawner } from '../src/server/game/plugin/brain';
import { ReturnGate } from '../src/shared/game/population/respawn';
import { manager as realManager, huntOf } from '@wildshard/engine/test/manager';
import {onFault,type Fault} from '../src/shared/engine/core/faults';
import { Scope } from '../src/shared/engine/app/scope';
import { overrideTerrain } from '@wildshard/engine/test/terrain';
import { installBoarWorldFixture } from './fixtures/boar-world';

await installBoarWorldFixture();

test('materializes ordered groups through the manager and retires only owned actors', () => {
  interface Actor { herd: number; kind: string; pose: number[]; roll: number }
  const herds: { members: Actor[] }[] = [{ members: [] }], actors: Actor[] = [], retired: Actor[] = [], order: string[] = [];
  const rng = new Rng(29), control = new Rng(29);
  const manager = {
    herds,
    addHerd: (kind: string, x: number, z: number): number => { order.push(`herd:${kind}:${x}:${z}`); herds.push({ members: [] }); return herds.length - 1; },
    spawn: (kind: string, x: number, z: number, yaw: number, variant?: string): Actor => {
      order.push(`spawn:${variant ?? kind}`); const actor = { herd: -1, kind, pose: [x, z, yaw], roll: rng.next() }; actors.push(actor); return actor;
    },
    retire: (actor: Actor): void => { retired.push(actor); },
  };
  const foreign = manager.spawn('foreign', 0, 0, 0), spawner = createCreatureSpawner(manager);
  control.next(); order.length = 0;
  const centres = [{ x: 3, z: 4 }, { x: 8, z: 9 }], kinds = ['crab', 'monkey'];
  const rows = [{ kind: 'monkey', x: 8, z: 9, yaw: .8, variant: null, herd: 1 },
    { kind: 'crab', x: 3, z: 4, yaw: .2, variant: 'small', herd: 0 },
    { kind: 'sailor', x: 0, z: 0, yaw: 1, variant: 'sailor', herd: -1 }];
  for (const invalid of [[{ ...rows[0], kind: 'monkey', x: 8, z: 9, yaw: .8, variant: null, herd: 9 }],
    [{ kind: 'crab', x: Infinity, z: 4, yaw: 0, variant: null, herd: 0 }]]) {
    expect(() => spawner.place(centres, kinds, invalid)).toThrow('placement'); expect(order).toEqual([]);
  }
  spawner.place(centres, kinds, rows, (actor, row) => {
    expect(herds[actor.herd]?.members).toContain(actor); expect(actor.pose).toEqual([row.x, row.z, row.yaw]);
    expect(actor.roll).toBe(control.next()); order.push(`join:${row.kind}`);
  }, kind => { order.push(`group:${kind}`); });
  expect(order).toEqual(['herd:crab:3:4', 'spawn:small', 'join:crab', 'group:crab', 'herd:monkey:8:9', 'spawn:monkey', 'join:monkey', 'group:monkey']);
  expect(actors.some(actor => actor.kind === 'sailor')).toBe(false);
  const sailor = spawner.spawn('sailor', 0, 0, 1, 'sailor'); expect(sailor.herd).toBe(-1); control.next();
  expect(rng.next()).toBe(control.next());
  spawner.dispose(); spawner.dispose();
  expect(retired).toEqual(actors.filter(actor => actor !== foreign));
  expect(() => spawner.spawn('crab', 0, 0, 0)).toThrow('disposed');
  expect(() => spawner.group('crab', { x: 0, z: 0 }, [])).toThrow();
});

test('native corpse gates keep the original fade clock while the player returns near', () => {
  const state = { dead: 0, fade: -1 }, row = { delay: 2, away: 5, fade: 1.5 };
  expect(ReturnGate.step(state, row, 1, true, 10)).toBe('none'); expect(state.dead).toBe(0);
  expect(ReturnGate.step(state, row, 2, false, 5)).toBe('fade'); expect(state).toEqual({ dead: 2, fade: 0 });
  expect(ReturnGate.step(state, row, 1.5, false, 4)).toBe('none'); expect(state.fade).toBe(1.5);
  expect(ReturnGate.step(state, row, 0, false, 5)).toBe('replace');
});


test('a sliced retirement retires one owned actor a step, then nothing more', () => {
  interface Actor { herd: number }
  const retired: Actor[] = [];
  const manager = { herds: [{ members: [] }], addHerd: (): number => 0, spawn: (): Actor => ({ herd: -1 }),
    retire: (actor: Actor): void => { retired.push(actor); } };
  const spawner = createCreatureSpawner(manager), actors = [spawner.spawn('a', 0, 0, 0), spawner.spawn('b', 0, 0, 0), spawner.spawn('c', 0, 0, 0)];
  const steps = spawner.retireSteps();
  expect(steps.next().done).toBe(false); expect(retired).toEqual(actors.slice(0, 1));
  expect(() => spawner.spawn('d', 0, 0, 0)).toThrow('disposed');
  expect(steps.next().done).toBe(false); expect(steps.next().done).toBe(false); expect(steps.next().done).toBe(true);
  expect(retired).toEqual(actors);
  spawner.dispose(); expect(spawner.retireSteps().next().done).toBe(true); expect(retired).toEqual(actors);
});

test('a refused manager decision reports once without stopping other animals or later frames',()=>{
  const restore=overrideTerrain({heightAt:()=>0,normalAt:()=>[0,1,0],waterLevel:()=>-100}),scope=new Scope('manager-frame-guard');
  const f=scope.run(()=>realManager()),animals=f.manager,hunt=huntOf(animals),faults:Fault[]=[];
  const first=scope.run(()=>animals.spawn('boar',3,4,0)),second=scope.run(()=>animals.spawn('boar',6,4,0));
  const thought=vi.spyOn(hunt,'think'),off=onFault(fault=>{faults.push(fault);});
  try{
    hunt.forget(first);
    expect(()=>f.advance(30)).not.toThrow();expect(f.game.dead).toBe(false);
    expect(faults).toHaveLength(1);expect(faults[0]).toMatchObject({system:'animals.think',verdict:'retry',error:expect.objectContaining({message:expect.stringContaining('has no brain')})});
    expect(thought.mock.calls.some(call=>call[0]===second)).toBe(true);expect(thought.mock.calls.some(call=>call[0]===first)).toBe(false);
    const accepted=thought.mock.calls.length;f.advance(12);expect(thought.mock.calls.length).toBeGreaterThan(accepted);expect(faults).toHaveLength(1);
    expect(()=>animals.spawn('boar',0,0,0,undefined,{y:Number.NaN})).toThrow('Creature spawn placement must be finite');
  }finally{off();thought.mockRestore();animals.retire(first);animals.retire(second);scope.dispose();restore();}
});
