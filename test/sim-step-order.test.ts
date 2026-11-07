import { expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual shipped native physics owner.
import { readFileSync } from 'node:fs';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

test('a fixed step preserves live registration, retirement and insertion order', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  const original = SIM_LEVEL.entities[0]; if (original === undefined) throw new Error('Missing body recipe');
  const first = host.entities.get(original.id); if (first === undefined) throw new Error('Missing native body');
  const trace: string[] = [];
  const retiring = host.spawn({ ...original, id: 'retiring' });
  vi.spyOn(first, 'step').mockImplementation(() => { trace.push('step:first'); });
  vi.spyOn(retiring, 'step').mockImplementation(() => { trace.push('step:retired'); });
  let inserted = false, removeBefore = (): void => undefined, removeAfter = (): void => undefined;
  host.onStep('a', () => {
    trace.push('a'); removeBefore();
    if (!host.hasStep('c')) host.onStep('c', () => { trace.push('c'); });
  });
  removeBefore = host.onStep('b', () => { trace.push('b'); });
  host.useBodyStep({ before: id => {
    trace.push(id === original.id ? 'before:first' : `before:${id}`);
    if (!inserted) {
      inserted = true; expect(host.retire('retiring')).toBe(true);
      const added = host.spawn({ ...original, id: 'added' });
      vi.spyOn(added, 'step').mockImplementation(() => { trace.push('step:added'); });
    }
  }, after: id => { trace.push(id === original.id ? 'after:first' : `after:${id}`); } });
  host.onStep('d', () => {
    trace.push('d'); removeAfter();
    if (!host.hasStep('f')) host.onStep('f', () => { trace.push('f'); }, undefined, 'afterBodies');
  }, undefined, 'afterBodies');
  removeAfter = host.onStep('e', () => { trace.push('e'); }, undefined, 'afterBodies');
  try {
    for (let tick = 0; tick < 2; tick++) {
      trace.length = 0; host.step();
      expect(trace).toEqual(['a', 'c', 'before:first', 'step:first', 'after:first', 'before:added', 'step:added', 'after:added', 'd', 'f']);
    }
  } finally { host.dispose(); vi.restoreAllMocks(); }
});

test('nested and refused body turns retain the outer body hook and later steps', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  const actor = [...host.entities.values()][0]; if (actor === undefined) throw new Error('Missing native body');
  const trace: string[] = [];
  let nested = false, refuse = false;
  vi.spyOn(actor, 'step').mockImplementation(() => { trace.push('step'); });
  host.useBodyStep({ before: () => {
    trace.push('before');
    if (!nested) { nested = true; host.step(); }
    if (refuse) throw new Error('Refused original body turn');
  }, after: () => { trace.push('after'); } });
  try {
    host.step(); expect(trace).toEqual(['before', 'before', 'step', 'after', 'step', 'after']);
    trace.length = 0; refuse = true;
    expect(() => { host.step(); }).toThrow('Refused original body turn');
    expect(trace).toEqual(['before']);
    trace.length = 0; refuse = false; host.step();
    expect(trace).toEqual(['before', 'step', 'after']);
  } finally { host.dispose(); vi.restoreAllMocks(); }
});

test('a nested turn observes newly installed hooks without changing its outer turn', async () => {
  const host = createSimHost(SIM_LEVEL, { rapier: await rapier });
  const original = SIM_LEVEL.entities[0]; if (original === undefined) throw new Error('Missing body recipe');
  const first = host.entities.get(original.id); if (first === undefined) throw new Error('Missing native body');
  const second = host.spawn({ ...original, id: 'second' }), trace: string[] = [];
  let nested = false;
  vi.spyOn(first, 'step').mockImplementation(() => {
    trace.push(nested ? 'inner:first' : 'outer:first');
    if (!nested) {
      nested = true;
      host.useBodyStep({ before: id => { trace.push(`before:${id}`); }, after: id => { trace.push(`after:${id}`); } });
      host.step();
    }
  });
  vi.spyOn(second, 'step').mockImplementation(() => { trace.push('step:second'); });
  try {
    host.step();
    expect(trace).toEqual(['outer:first', `before:${original.id}`, 'inner:first', `after:${original.id}`,
      'before:second', 'step:second', 'after:second', 'step:second']);
  } finally { host.dispose(); vi.restoreAllMocks(); }
});
