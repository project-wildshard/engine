import { expect, test } from 'vitest';
import { vitestMaxWorkers, vitestNodeExecArgv } from '../src/scripts/vitest-lane';
import { pushEnvironment } from '../.githooks/push-checks.mjs';
import { pushWorkers } from '../src/scripts/push-budget.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the real fork/thread WASM flag boundary, not only its config text.
import { Worker } from 'node:worker_threads';
// oxlint-disable-next-line import/no-nodejs-modules -- The worker message or error settles the actual inheritance probe.
import { once } from 'node:events';
// oxlint-disable-next-line import/no-nodejs-modules -- Build the real push-gate shim's search path.
import { delimiter, resolve } from 'node:path';

test('WASM lifetime workaround is confined to Node 24 test forks', async () => {
  expect(vitestNodeExecArgv('24.21.0')).toEqual(['--no-wasm-code-gc']);
  for (const version of ['22.23.0', '25.0.0', '26.10.0']) expect(vitestNodeExecArgv(version)).toEqual([]);
  for (const flag of vitestNodeExecArgv()) expect(process.execArgv).toContain(flag);
  const worker = new Worker("require('node:worker_threads').parentPort.postMessage(process.execArgv)", { eval: true });
  try {
    const inherited: unknown = (await once(worker, 'message'))[0];
    expect(inherited).toEqual(process.execArgv);
  } finally { await worker.terminate(); }
});

test('only the serialized local CF1 run defaults to four workers', () => {
  expect(vitestMaxWorkers({})).toBe(2);
  expect(vitestMaxWorkers({ WS_COMMIT_RELATED_TOKEN: '' })).toBe(2);
  expect(vitestMaxWorkers({ WS_COMMIT_RELATED_TOKEN: 'invocation' })).toBe(4);
});

test('CI keeps its runner default even if a CF1 marker is present', () => {
  for (const ci of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    expect(vitestMaxWorkers(ci)).toBeUndefined();
    expect(vitestMaxWorkers({ ...ci, WS_COMMIT_RELATED_TOKEN: 'invocation' })).toBeUndefined();
  }
});

test('explicit positive worker limits keep priority in every environment', () => {
  for (const env of [{}, { CI: 'true' }, { WS_COMMIT_RELATED_TOKEN: 'invocation' }]) {
    for (const value of ['1', '2', '6']) {
      expect(vitestMaxWorkers({ ...env, WS_VITEST_MAX_WORKERS: value })).toBe(Number(value));
    }
  }
});

test('invalid explicit limits still refuse rather than falling back', () => {
  for (const value of ['', '0', '-1', '1.5', '2x', '9007199254740992']) {
    expect(() => vitestMaxWorkers({ WS_COMMIT_RELATED_TOKEN: 'invocation', WS_VITEST_MAX_WORKERS: value }))
      .toThrow('WS_VITEST_MAX_WORKERS must be a positive integer');
  }
});

test('the engine push profile uses the gate worker override', () => {
  const path = [resolve('.githooks/gate-bin'), process.env['PATH'] ?? ''].join(delimiter);
  const env = pushEnvironment({ PATH: path, WS_GATE_WORKERS: '3' });
  expect(env['WS_GATE_WORKERS']).toBe('3');
  expect(pushWorkers(env)).toBe(3);
  expect(env['PATH']).not.toContain('.githooks/gate-bin');
  expect(pushEnvironment(env)['PATH']).toBe(env['PATH']);
});
