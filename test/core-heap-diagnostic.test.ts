// oxlint-disable-next-line import/no-nodejs-modules -- Verify exact retained raw snapshot identity.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual prelaunch refusal before any Simulator command.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { captureCoreHeap, coreHeapProtocol, coreHeapRequested } from '../scripts/core-heap-diagnostic.mjs';
import { coreMemorySummary } from '../scripts/shard-phone-memory.mjs';

const target = '_template', href = 'http://127.0.0.1:4400/?sw=0&chunk=_template';
const samples = [10, 60, 120].map(second => ({phase: `${second}s`, rendererBytes: 100, gpuBytes: 1}));
const raw = JSON.stringify({ version: 3, nodes: [1, 100, 0, 0, 2, 200, 1, 0, 3, 40, 0, 0], nodeClassNames: ['Object', 'ArrayBuffer'] });
function fixture() {
  const calls: string[] = [], writes = new Map<string, string>();
  const driver = {
    evaluate: (_expression: string): Promise<unknown> => { calls.push('fence'); return Promise.resolve({href, ready: true}); },
    send: (method: string): Promise<unknown> => { calls.push(method); return Promise.resolve({snapshotData: raw}); },
  };
  const write = (path: string, text: string): void => { calls.push('write'); writes.set(path, text); };
  return { calls, writes, driver, write };
}
const args = {'core-heap': '1', 'core-memory': target, rev: 'a'.repeat(40)};

test('heap mode is explicit, pinned and limited to one original cold Template', () => {
  expect(coreHeapRequested({})).toBe(false);
  expect(coreHeapRequested(args)).toBe(true);
  expect(coreHeapRequested({...args, 'core-memory': 'blender-template'})).toBe(true);
  for (const change of [
    {'core-heap': '0'}, {'core-memory': 'templates'}, {'core-memory': 'all'}, {'core-memory': 'menu'},
    {'core-memory': 'hello'}, {rev: undefined}, {rev: 'HEAD'}, {rev: ''}, {base: 'http://127.0.0.1:4400'}, {runs: '2'},
    {modes: 'warm'}, {'core-attribution': '1'}, {'keep-video': '1'},
  ]) expect(() => coreHeapRequested({...args, ...change})).toThrow('one pinned cold Template');
});

test('seals native samples before snapshot and retains exact raw bytes before summarizing', async () => {
  const f = fixture(), result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
  expect(f.calls).toEqual(['fence', 'Heap.enable', 'Heap.snapshot', 'write', 'fence', 'Heap.disable']);
  expect(f.writes.get('tmp/owned-core-heap/_template-heap.json')).toBe(raw);
  expect(result).toMatchObject({protocol: coreHeapProtocol, qualifying: false, mayCollect: true, before: href, after: href,
    snapshot: {bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex'),
      summary: {version: 3, nodes: 3, estimatedBytes: 340, classes: [
        {kind: 'ArrayBuffer', bytes: 200, nodes: 1}, {kind: 'Object', bytes: 140, nodes: 2},
      ]}}, errors: []});
});

test('unsealed samples and wrong targets cannot enable the heap agent', async () => {
  for (const [selected, phases] of [[target, samples.slice(0, 2)], ['menu', samples], [target, [...samples].reverse()]] as const) {
    const f = fixture();
    await expect(captureCoreHeap(f.driver, selected, 'tmp/owned-core-heap', phases, f.write)).rejects.toThrow('sealed original Template');
    expect(f.calls).toEqual([]);
  }
});

test('missing or failed snapshot stays unavailable and always disables the agent', async () => {
  for (const response of [null, {}, {snapshotData: 1}]) {
    const f = fixture();
    f.driver.send = method => { f.calls.push(method); return Promise.resolve(response); };
    const result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
    expect(result.snapshot).toBeNull(); expect(result.errors).toEqual([expect.stringContaining('Missing WebKit heap')]);
    expect(f.calls.at(-1)).toBe('Heap.disable'); expect(f.writes.size).toBe(0);
  }
  const f = fixture();
  f.driver.send = method => { f.calls.push(method); return Promise.reject(new Error('unsupported')); };
  const result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
  expect(result.snapshot).toBeNull(); expect(result.errors).toHaveLength(2);
  expect(f.calls).toEqual(['fence', 'Heap.enable', 'Heap.disable']);
});

test('malformed heaps keep raw evidence and an unknown summary', async () => {
  const f = fixture();
  f.driver.send = method => { f.calls.push(method); return Promise.resolve({snapshotData: 'bad json'}); };
  const result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
  expect(f.writes.get('tmp/owned-core-heap/_template-heap.json')).toBe('bad json');
  expect(result.snapshot?.summary).toBeNull(); expect(result.errors).toHaveLength(1);
  expect(f.calls.at(-1)).toBe('Heap.disable');
});

test('initial and mid-snapshot navigation refuse without attributing another page', async () => {
  for (const changedAt of [1, 2]) {
    const f = fixture(); let reads = 0;
    f.driver.evaluate = () => { f.calls.push('fence'); reads++; return Promise.resolve({href: reads === changedAt ? `${href}&changed=1` : href, ready: changedAt !== 1}); };
    const result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
    expect(result.errors).toHaveLength(1); expect(result.snapshot?.summary ?? null).toBeNull();
    expect(f.calls.includes('Heap.snapshot')).toBe(changedAt === 2);
    if (changedAt === 2) expect(f.calls.at(-1)).toBe('Heap.disable');
  }
});

test('a heap diagnostic cannot pass the unchanged native qualification', () => {
  const original = {shard: target, protocol: 'webkit-core-floor/1', mode: 'cold', forcedGC: false,
    inspectorResponseBodyBytes: 0, samples, errors: []};
  expect(coreMemorySummary([original], target)[0]?.passed).toBe(true);
  expect(() => coreMemorySummary([{...original, protocol: coreHeapProtocol}], target)).toThrow();
});


test('the actual reader refuses heap mode before touching a fake Simulator', () => {
  for (const flags of [
    ['--core-memory=templates', `--rev=${'a'.repeat(40)}`],
    ['--core-memory=_template', '--rev=HEAD'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/sim-grid-entry.mjs', '--core-heap=1', ...flags],
      {env: {...process.env, SIM_UDID: 'no-such-core-heap-device'}, encoding: 'utf8', timeout: 10000});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('one pinned cold Template');
    expect(result.stderr).not.toContain('Core floor reset failed');
  }
});


test('foreign snapshot layouts retain raw bytes but refuse Inspector estimates', async () => {
  for (const type of ['GCDebugging', 'FutureInspector']) {
    const f = fixture(), text = JSON.stringify({type, version: 3,
      nodes: type === 'GCDebugging' ? [0, 0, 0, 0, 0, 0, 0, 1, 32, 1, 0, 0, 0, 0, 2, 32, 1, 0, 0, 0, 0, 3, 32, 1, 0, 0, 0, 0] : [1, 100, 0, 0],
      nodeClassNames: Array.from({length: 33}, (_, i) => `Class${i}`)});
    f.driver.send = method => { f.calls.push(method); return Promise.resolve({snapshotData: text}); };
    const result = await captureCoreHeap(f.driver, target, 'tmp/owned-core-heap', samples, f.write);
    expect(f.writes.get('tmp/owned-core-heap/_template-heap.json')).toBe(text);
    expect(result.snapshot?.summary).toBeNull();
    expect(result.errors).toEqual([expect.stringContaining('Unsupported WebKit heap snapshot')]);
    expect(f.calls.at(-1)).toBe('Heap.disable');
  }
});
