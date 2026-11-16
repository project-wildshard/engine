import {describe, expect, it, vi} from 'vitest';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {emptyShardfile} from '../src/shared/host/author';
import {FIXTURE_RUNTIME_COST} from './fixtures/clientPlanRuntime';

const source = () => emptyShardfile({slug: 'check-fixture', name: 'Check fixture', author: 'Test', revision: 1, seed: 1});
const measured = () => ({ticks: 240, lanes: 4, steps: 16, portalTransfers: 2,
  scripts: {p95Micros: 2, maxMicros: 3, samples: 180}, fuel: {p95: 10, max: 20, samples: 240}});

describe('the shared full shard check (SP19a)', () => {
  it('returns a stable complete budget refusal with fixed observations', async () => {
    const shard = source(); shard.serverBudget.tickMicros = 1;
    const options = {validate: () => Promise.resolve(measured())};
    const author = await checkShardfile(shard, new Map(), options), cook = await checkShardfile(shard, new Map(), options);
    expect(author).toEqual(cook);
    expect(author.pass).toBe(false);
    expect(author.failures).toContainEqual({code: 'perf-script-cpu', message: 'script CPU p95 us/tick: 2 over 1'});
    expect(author.performance.scripts).toEqual({scripts: measured().scripts, fuel: measured().fuel});
    expect(author.proof).toMatchObject({ticks: 240, lanes: 4, steps: 16, portalTransfers: 2});
  });

  it('preserves a complete entry refusal instead of claiming an empty proof', async () => {
    const message = `Blocked portal route: ${'detail '.repeat(100)}`;
    const options = {validate: () => Promise.reject(new Error(message))};
    const author = await checkShardfile(source(), new Map(), options), cook = await checkShardfile(source(), new Map(), options);
    expect(author).toEqual(cook);
    expect(author).toMatchObject({pass: false, proof: 'refused'});
    expect(author.failures).toContainEqual({code: 'check-execution', message});
    expect(author.performance.scripts.scripts.samples).toBe(0);
  });

  it('labels a host worker failure separately from hostile-byte refusal', async () => {
    const error = Object.assign(new Error('Worker ran out of memory'), {code: 'ERR_WORKER_OUT_OF_MEMORY'});
    const report = await checkShardfile(source(), new Map(), {validate: () => Promise.reject(error)});
    expect(report.pass).toBe(false);
    expect(report.failures).toContainEqual({code: 'check-infrastructure', message: error.message});
  });

  it('does not manufacture measured native execution or trusted recipes (J370)', async () => {
    const shard = source(); shard.runtime = {kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: []};
    const validate = vi.fn(() => Promise.resolve(measured()));
    const report = await checkShardfile(shard, new Map(), {validate});
    expect(validate).not.toHaveBeenCalled();
    expect(report).toMatchObject({pass: true, proof: 'unmeasured', performance: {policy: 'warn', native: {unmeasuredViewAndDownload: true}}});
    expect(report.performance.scripts.scripts.samples).toBe(0);
    expect(report.performance.issues.some(issue => issue.code === 'perf-script-samples-missing' && issue.severity === 'warning')).toBe(true);
  });

  it('keeps zero-lane evidence unmeasured', async () => {
    const report = await checkShardfile(source(), new Map(), {validate: () => Promise.resolve({...measured(), lanes: 0})});
    expect(report.pass).toBe(true);
    expect(report.proof).toBe('unmeasured');
  });

  it('uses the actual isolated simulation and complete entry walk by default', async () => {
    const report = await checkShardfile(source(), new Map());
    expect(report.pass, JSON.stringify(report.failures)).toBe(true);
    expect(report.proof).toMatchObject({ticks: 240});
    expect(typeof report.proof).toBe('object');
    if (typeof report.proof === 'object') {
      expect(report.proof.lanes).toBeGreaterThan(0);
      expect(report.proof.steps).toBeGreaterThan(0);
    }
    expect(report.performance.scripts.scripts.samples).toBe(180);
  }, 90_000);
});
