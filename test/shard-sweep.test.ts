// Meta QA 11-25 row 61: a shard publish gets its tag and its engine pin with no hand step. Pine r18 (11-25): the record
// job's GITHUB_TOKEN could not push tag r18 (a kit sync changed publish.yml on main mid-run) and the cook job's pin
// request was skipped (no nightly key in shard repos, by design), so opus-fr13 tagged and dispatched by hand.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {missingTag, publishedRows, sweepPlan} from '../src/scripts/shard-sweep.mjs';

const BUILT = 'd7b9c83f327843bfdfbeaed59d3ff263184f4c0d', OTHER = 'a'.repeat(40);
const pine = {'pine-hollow': {version: '0.0.17', revision: 18, hash: 'h18', channel: 'staging', commit: BUILT}};
const plan = (over: Partial<Parameters<typeof sweepPlan>[0]> = {}) => sweepPlan({
  repos: [{repo: 'shard-pine-hollow', rows: publishedRows(pine), tags: new Map()}],
  pins: new Map([['pine-hollow', 17]]), branches: new Set(), runs: new Map(), ...over,
});

describe('the shard sweep (QA 11-25 row 61)', () => {
  it('reads published.json rows and skips what it cannot use', () => {
    expect(publishedRows(pine)).toEqual([{slug: 'pine-hollow', revision: 18, hash: 'h18', channel: 'staging', commit: BUILT}]);
    expect(publishedRows({x: {revision: '3'}, y: null})).toEqual([]);
    expect(publishedRows(undefined)).toEqual([]);
  });

  it('names the tag as the record job does', () => {
    const [row] = publishedRows(pine);
    if (row === undefined) throw new Error('no row');
    expect(missingTag(row, new Map())).toBe('r18');
    expect(missingTag(row, new Map([['r18', BUILT]]))).toBeUndefined();
    expect(missingTag(row, new Map([['r18', OTHER]]))).toBe('pine-hollow-r18');
    expect(missingTag(row, new Map([['r18', OTHER], ['pine-hollow-r18', BUILT]]))).toBeUndefined();
  });

  it("tags Pine r18's built commit and starts its pin, as opus-fr13 did by hand", () => {
    expect(plan().actions).toEqual([
      {kind: 'tag', repo: 'shard-pine-hollow', tag: 'r18', commit: BUILT},
      {kind: 'pin', slug: 'pine-hollow', revision: 18, hash: 'h18', channel: 'staging'},
    ]);
  });

  it('does nothing twice: a pinned revision, a waiting pin branch, or a pin run already tried', () => {
    const tagged = [{repo: 'shard-pine-hollow', rows: publishedRows(pine), tags: new Map([['r18', BUILT]])}];
    expect(plan({repos: tagged, pins: new Map([['pine-hollow', 18]])})).toEqual({actions: [], notes: []});
    expect(plan({repos: tagged, branches: new Set(['plan/pin-pine-hollow-r18'])}).notes).toEqual(['pine-hollow r18: plan/pin-pine-hollow-r18 waits to land']);
    const failed = plan({repos: tagged, runs: new Map([['shard-pin pine-hollow r18', 'failure']])});
    expect(failed.actions).toEqual([]);
    expect(failed.notes[0]).toContain('shard-pin already ran (failure)');
  });

  it('never makes a first pin or pins a test channel (J453), but still tags', () => {
    const fresh = plan({pins: new Map()});
    expect(fresh.actions.map(action => action.kind)).toEqual(['tag']);
    expect(fresh.notes[0]).toContain('a first pin is a choice');
    const test = plan({repos: [{repo: 'shard-proof', rows: publishedRows({proof: {revision: 2, hash: 'h', channel: 'test', commit: BUILT}}), tags: new Map()}]});
    expect(test.actions).toEqual([{kind: 'tag', repo: 'shard-proof', tag: 'r2', commit: BUILT}]);
    expect(test.notes[0]).toContain('channel test is not pinned');
  });

  it('runs on a schedule with the nightly app, and shard-pin runs carry the title the sweep looks for', () => {
    const sweep = readFileSync('.github/workflows/shard-sweep.yml', 'utf8');
    expect(sweep).toMatch(/schedule:\n\s+- cron:/u);
    expect(sweep).toContain('permission-workflows: write');
    expect(sweep).toContain('run: node src/scripts/shard-sweep.mjs');
    expect(readFileSync('.github/workflows/shard-pin.yml', 'utf8')).toContain(
      'run-name: shard-pin ${{ inputs.slug || github.event.client_payload.slug }} r${{ inputs.revision || github.event.client_payload.revision }}');
  });
});
