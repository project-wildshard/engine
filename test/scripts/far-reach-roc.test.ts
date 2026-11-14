import { beforeAll, expect, test } from 'vitest';
import { builtFolder } from '../fixtures/builtFolder';
import { scenario as diskScenario,type DiskScriptScenario } from '../../src/sharddev/test/scriptScenario';

let prepared:readonly [DiskScriptScenario,DiskScriptScenario]|undefined;

beforeAll(async () => {
  const directory = builtFolder('far-reach');
  // Disk admission and independent host allocation are fixture preparation.
  // The unchanged two-second body measures every gameplay/save/restore step.
  const create = () => diskScenario('far-reach', 'far.roc.decision', { folderDirectory: directory, seed: 6417,
    actors: [{ id: 'roc', at: [13, 55, -196] }], players: [{ id: 101, at: [0, 44, -196] }],
  });
  prepared=[await create(),await create()];
}, 120_000);

test('Roc published guest chooses three phases and resumes without replaying gameplay', () => {
  if(prepared===undefined)throw new Error('Missing admitted Roc fixtures');
  const [roc,resumed]=prepared;
  roc.send('start'); expect(roc.commands()).toEqual([['move', 'roc', 'takeoff', 101]]);
  roc.send('start'); expect(roc.commands()).toEqual([]);
  roc.send('move.done', 'roc', 'takeoff', true);
  expect(roc.commands(), JSON.stringify({ state: roc.state(), trace: roc.trace().slice(-3) })).toEqual([['move', 'roc', 'orbitHigh'], ['timer', 'beat', 0.5]]);
  roc.advance(0.5); expect(roc.commands()).toEqual([['move', 'roc', 'stalkHigh', 101]]);
  roc.send('move.done', 'roc', 'stalkHigh', true);
  expect(roc.commands()).toEqual([['strike', 'roc', 'stoop', 101], ['timer', 'beat', 1.2]]);
  roc.advance(1.2); expect(roc.commands()).toEqual([['move', 'roc', 'dive', 101]]);
  roc.send('strike.done', 'roc', 'stoop', true);
  expect(roc.commands()).toEqual([['move', 'roc', 'orbitHigh'], ['timer', 'beat', 2.4]]);
  roc.send('threshold', 'roc', 1); expect(roc.commands()).toEqual([['move', 'roc', 'orbitWall']]);
  roc.send('threshold', 'roc', 1); expect(roc.commands()).toEqual([]);
  roc.advance(2.4); expect(roc.commands()).toEqual([['move', 'roc', 'stalkWall', 101]]);
  roc.send('move.done', 'roc', 'stalkWall', true); expect(roc.commands()).toEqual([['strike', 'roc', 'galeWall', 101]]);
  roc.send('threshold', 'roc', 2); expect(roc.commands()).toEqual([]);
  roc.send('strike.done', 'roc', 'galeWall', false);
  expect(roc.commands()).toEqual([['move', 'roc', 'orbitLow'], ['timer', 'beat', 1.2]]);
  roc.advance(1.2); expect(roc.commands()).toEqual([['move', 'roc', 'stalkLow', 101]]);
  roc.send('move.done', 'roc', 'stalkLow', true); expect(roc.commands()).toEqual([['strike', 'roc', 'sweep', 101]]);
  const saved = roc.save(); resumed.restore(structuredClone(saved));
  expect(resumed.host.metrics()[0]?.calls).toBe(0);
  for (const owner of [roc, resumed]) { owner.send('strike.done', 'roc', 'sweep', true); owner.advance(1.2); }
  expect(resumed.commands()).toEqual(roc.commands()); expect(resumed.state()).toEqual(roc.state()); expect(resumed.save()).toEqual(roc.save());
  resumed.send('death', 'roc'); expect(resumed.commands()).toEqual([['stop', 'roc'], ['timer', 'beat', 0]]);
  resumed.send('death', 'roc'); expect(resumed.commands()).toEqual([]);
  resumed.advance(4); expect(resumed.commands()).toEqual([]);
  resumed.send('stop'); expect(resumed.commands()).toEqual([['stop', 'roc'], ['timer', 'beat', 0], ['move', 'roc', 'perch']]);
  expect(resumed.state()).toEqual({ step: 0 });
  resumed.advance(4); expect(resumed.commands()).toEqual([]);
  resumed.send('start'); expect(resumed.commands()).toEqual([['move', 'roc', 'takeoff', 101]]);
  expect(roc.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });
  expect(resumed.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });
  expect(roc.maxFuel()).toBeGreaterThan(0); expect(roc.maxFuel()).toBeLessThan(400_000);
}, 2_000);
