import {expect, test} from 'vitest';
import {QuestStepRunner} from '../../../shared/game/quest/steps';
import {onFault, type Fault} from '@wildshard/engine/core/faults';

test.each(['position', 'inventory'])('missing %s facts cannot publish partial quest commands or consume wait time', missing => {
  const rows = {version: 1, guards: [], steps: [
    {id: 'delay', kind: 'wait', seconds: 1, once: 'waited', effects: [{kind: 'flag', flag: 'opened'}]},
    {id: 'arrive', kind: 'go-to', at: {x: 0, z: 0}, radius: 2, once: 'arrived', effects: [{kind: 'item', item: 'seed', count: 1}]},
  ]};
  const runner = new QuestStepRunner(rows), control = new QuestStepRunner(rows), before = runner.snapshot();
  const flags: string[] = [], inventory = {}, position = {x: 0, z: 0}, healthy = {flags, inventory, position};
  const faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  try {
    const source = missing === 'position' ? {flags, inventory} : {flags, position};
    for (let i = 0; i < 2; i++) expect(runner.update(1, source)).toEqual([]);
    expect(runner.snapshot()).toEqual(before); expect(flags).toEqual([]); expect(inventory).toEqual({});
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'quest.steps', verdict: 'retry', error: expect.objectContaining({message: missing === 'position' ? 'Quest go-to requires position facts' : 'Quest item effects require inventory facts'})});
    for (const dt of [.25, .25, .5]) {
      expect(runner.update(dt, healthy)).toEqual(control.update(dt, healthy));
      expect(runner.snapshot()).toEqual(control.snapshot());
    }
    expect(runner.snapshot()['delay']).toBe(1);
  } finally {off();}
});

test('invalid timed quest input skips while direct source and signal contracts stay strict', () => {
  const rows = {version: 1, guards: [], steps: [
    {id: 'deliver', kind: 'deliver', target: 'gardener', item: 'seed', count: 1, effects: [{kind: 'flag', flag: 'done'}]},
  ]};
  const runner = new QuestStepRunner(rows), before = runner.snapshot(), faults: Fault[] = [];
  const off = onFault(fault => {faults.push(fault);});
  try {
    for (const dt of [Number.NaN, -1, Number.POSITIVE_INFINITY]) expect(runner.update(dt, {flags: []})).toEqual([]);
    expect(runner.snapshot()).toEqual(before); expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({verdict: 'retry', error: expect.objectContaining({message: 'Invalid quest step delta'})});
    expect(() => runner.signal({kind: 'deliver', target: 'gardener'}, {flags: []})).toThrow('Quest delivery requires inventory facts');
    expect(() => runner.guard('missing', {flags: []})).toThrow('Unknown quest guard');
    expect(() => runner.restore({unexpected: 1})).toThrow('Invalid quest wait continuation');
    expect(() => new QuestStepRunner({...rows, steps: [...rows.steps, ...rows.steps]})).toThrow('Quest step identities must be unique');
  } finally {off();}
});
