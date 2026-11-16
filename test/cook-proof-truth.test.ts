import {describe, expect, it} from 'vitest';
import {indexProof} from '../src/cook/game/cookWorker';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {emptyShardfile} from '../src/shared/host/author';

// Meta TEST-COVERAGE TC31, J370 (4) (Jake, 2026-11-16: "Unmeasured, sure. Proof, sure."): the cook's proof tells the
// truth. One test per rule: `unmeasured` passes; a walk of 0 lanes (or 0 ticks or steps) is never `proved`; only a full
// walk is. The real cook through a child process is cook-worker.test.ts; the check's other verdicts are
// shardfile-full-check.test.ts.
const source = () => emptyShardfile({slug: 'proof-truth', name: 'Proof truth', author: 'Test', revision: 1, seed: 1});
const walked = {ticks: 240, lanes: 4, steps: 16};
const observed = (counts: {ticks: number; lanes: number; steps: number}) => ({...counts,
  scripts: {p95Micros: 2, maxMicros: 3, samples: 180}, fuel: {p95: 10, max: 20, samples: 240}});

describe('cook proof truth (J370 (4))', () => {
  it('rule 1: an unmeasured proof passes the check, and the index records it as unmeasured', async () => {
    const report = await checkShardfile(source(), new Map(), {validate: () => Promise.resolve(observed({...walked, lanes: 0}))});
    expect(report).toMatchObject({pass: true, proof: 'unmeasured', failures: []});
    expect(indexProof('unmeasured')).toBe('unmeasured');
  });

  it.each([
    ['0 lanes', {...walked, lanes: 0}],
    ['0 ticks', {...walked, ticks: 0}],
    ['0 steps', {...walked, steps: 0}],
  ])('rule 2: a walk of %s is never proved, in the check or in the cook index', async (_name, counts) => {
    const report = await checkShardfile(source(), new Map(), {validate: () => Promise.resolve(observed(counts))});
    expect(report.proof).toBe('unmeasured');
    // The report crosses the job's process boundary as JSON: an object that claims an empty walk is still unmeasured.
    expect(indexProof(counts)).toBe('unmeasured');
  });

  it('rule 3: only a walk with ticks, lanes and steps is proved', async () => {
    const report = await checkShardfile(source(), new Map(), {validate: () => Promise.resolve(observed(walked))});
    expect(report.proof).toMatchObject(walked);
    expect(indexProof(walked)).toBe('proved');
  });
});
