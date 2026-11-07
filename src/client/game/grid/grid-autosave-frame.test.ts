import {expect, test} from 'vitest';
import {LiveGridSession} from './liveSession';
import {onFault, type Fault} from '@wildshard/engine/core/faults';

/** Exercise the actual phase methods with real staged iterators; no world,
 * renderer or fabricated persistence result is needed for their fault boundary. */
function session(factory: () => Generator<undefined, boolean>): LiveGridSession {
  const value: unknown = Object.create(LiveGridSession.prototype);
  if (!(value instanceof LiveGridSession)) throw new Error('Missing live session prototype');
  Reflect.set(value, 'autosave', null); Reflect.set(value, 'reportedAutosave', false);
  Reflect.set(value, 'checkpointSteps', factory);
  return value;
}
function phase(owner: LiveGridSession, name: 'stepAutosave' | 'captureAutosave'): void {
  const run: unknown = Reflect.get(owner, name);
  if (typeof run !== 'function') throw new Error('Missing native autosave phase');
  Reflect.apply(run, owner, []);
}

test('a refused staged save cannot abort the frame or claim persistence; a fresh save still completes', () => {
  const error = new Error('Regional durability was not admitted'), faults: Fault[] = [];
  let captures = 0, persisted = 0, cleaned = 0;
  function* bad(): Generator<undefined, boolean> {try {captures++; yield; throw error;} finally {cleaned++;}}
  function* good(): Generator<undefined, boolean> {captures++; yield; persisted++; return true;}
  const owner = session(good), off = onFault(fault => {faults.push(fault);});
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      Reflect.set(owner, 'autosave', bad()); phase(owner, 'stepAutosave');
      expect(() => phase(owner, 'stepAutosave')).not.toThrow();
      expect(Reflect.get(owner, 'autosave')).toBeNull(); expect(persisted).toBe(0);
    }
    expect(captures).toBe(2); expect(cleaned).toBe(2); expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({system: 'grid.autosave', verdict: 'retry', error});
    phase(owner, 'captureAutosave'); expect(captures).toBe(3); expect(persisted).toBe(0);
    expect(Reflect.get(owner, 'autosaveCaptured')).toBe(true);
    phase(owner, 'stepAutosave'); expect(persisted).toBe(1); expect(Reflect.get(owner, 'autosave')).toBeNull();
  } finally {off();}
});

test('a failed superseded iterator cleanup cannot block the next fixed-boundary capture', () => {
  const error = new Error('Save iterator cleanup failed'), faults: Fault[] = [];
  let captured = 0, persisted = 0, cleaned = 0;
  function refuseCleanup(): never {cleaned++; throw error;}
  function* previous(): Generator<undefined, boolean> {try {yield;} finally {refuseCleanup();}}
  function* next(): Generator<undefined, boolean> {captured++; yield; persisted++; return true;}
  const old = previous(); old.next();
  const owner = session(next), off = onFault(fault => {faults.push(fault);}); Reflect.set(owner, 'autosave', old);
  try {
    expect(() => phase(owner, 'captureAutosave')).not.toThrow();
    expect(cleaned).toBe(1); expect(captured).toBe(1); expect(persisted).toBe(0);
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'grid.autosave', verdict: 'retry', error});
    phase(owner, 'stepAutosave'); expect(persisted).toBe(1);
  } finally {off();}
});

test('an obsolete save failure cannot erase a newer staged job installed during that frame', () => {
  let persisted = 0;
  function* next(): Generator<undefined, boolean> {yield* []; persisted++; return true;}
  const owner = session(next), replacement = next();
  function* previous(): Generator<undefined, boolean> {yield* []; Reflect.set(owner, 'autosave', replacement); throw new Error('Old save left');}
  const faults: Fault[] = [], off = onFault(fault => {faults.push(fault);}); Reflect.set(owner, 'autosave', previous());
  try {
    expect(() => phase(owner, 'stepAutosave')).not.toThrow();
    expect(Reflect.get(owner, 'autosave')).toBe(replacement); expect(persisted).toBe(0);
    phase(owner, 'stepAutosave'); expect(persisted).toBe(1); expect(Reflect.get(owner, 'autosave')).toBeNull();
    expect(faults).toHaveLength(1);
  } finally {off();}
});

test('explicit checkpoints still propagate the original refusal rather than claim a durable save', () => {
  const error = new Error('Invalid native checkpoint'), faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  function* rejected(): Generator<undefined, boolean> {yield* []; throw error;}
  const owner = session(rejected);
  try {expect(() => owner.checkpoint()).toThrow(error); expect(faults).toEqual([]);} finally {off();}
});
