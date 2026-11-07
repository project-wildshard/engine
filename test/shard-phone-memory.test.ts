// oxlint-disable-next-line import/no-nodejs-modules -- Refusals must occur before launching a memory browser.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Independently hash the exact diagnostic wire, including whitespace.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the fixture's context-creation contract without a GPU or app.
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';
import { coreMemorySummary, coreMemoryEstimateAudit, chromiumCoreMemorySummary, coreMemoryTargets, selectedCoreMemoryTargets, scriptResourceURLs, simulatorCoreFootprint, webKitCoreMemoryFloorBytes,
  serveHelloWorldMemory, helloWorldMemoryHTML, helloWorldMemoryFloor, coreMemoryProductIdentity,
  webGLMemoryTarget, webGLMemoryHTML, webGLMemoryFloor,
  threeMemoryTarget, threeMemoryHTML, threeMemoryFloor, contextMemoryDiagnostic } from '../scripts/shard-phone-memory.mjs';

const MiB = 1048576;
test('script inventory keeps distinct complete JavaScript URLs only', () => {
  const urls = ['https://example.test/main.js?v=1#entry', 'https://example.test/worker.mjs',
    'https://example.test/CHUNK.JS', 'https://example.test/main.js?v=1#entry',
    'https://example.test/style.css', 'https://example.test/card.png?name=module.js'];
  expect(scriptResourceURLs(urls.map(name => ({name})))).toEqual(urls.slice(0, 3));
  expect(scriptResourceURLs([])).toEqual([]);
});
const nativeProtocol = {protocol: 'webkit-core-floor/1', mode: 'cold', forcedGC: false, inspectorResponseBodyBytes: 0};
const rows = () => coreMemoryTargets.map(target => ({...nativeProtocol, shard: target.shard, errors: [],
  samples: [10, 60, 120].map(second => ({phase: `${second}s`, rendererBytes: target.limitBytes - 10 * MiB, gpuBytes: 10 * MiB}))}));

const metadataVersion = JSON.stringify({build: '1111111-original'});
const metadataIndex = JSON.stringify({format: 'wildshard.shardfile', formatVersion: 2,
  identity: {slug: 'template'}, build: {sourceHash: 'a'.repeat(64)}}, null, 2);
const requestPath = (input: Parameters<typeof fetch>[0]): string => new URL(input instanceof Request ? input.url : input).pathname;
test('post-sample product identity retains the exact wire hash between original-build checks', async () => {
  const requests: {path: string; init: RequestInit | undefined}[] = [];
  const read: typeof fetch = (input, init) => {
    const path = requestPath(input); requests.push({path, init});
    return Promise.resolve(new Response(path === '/version.json' ? metadataVersion : metadataIndex));
  };
  expect(await coreMemoryProductIdentity('https://metadata.test/', '_template', metadataVersion, read)).toEqual({
    status: 'observed', phase: 'after-120s', build: '1111111-original', shard: '_template',
    path: '/shardfiles/_template/shard.json', indexBytes: Buffer.byteLength(metadataIndex),
    indexHash: createHash('sha256').update(metadataIndex).digest('hex'), sourceHash: 'a'.repeat(64),
  });
  expect(requests.map(row => row.path)).toEqual(['/version.json', '/shardfiles/_template/shard.json', '/version.json']);
  const signal = requests[0]?.init?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  for (const request of requests) expect(request.init).toEqual({signal, cache: 'no-store', redirect: 'error'});
});

test('non-product floors make no metadata request', async () => {
  const read: typeof fetch = () => Promise.reject(new Error('Unexpected metadata request'));
  for (const target of ['menu', 'select', 'hello']) expect(await coreMemoryProductIdentity('https://metadata.test/', target, metadataVersion, read)).toBeNull();
});

test('the second template keeps its own canonical product identity', async () => {
  const index = metadataIndex.replace('template', 'blender-template');
  const read: typeof fetch = input => Promise.resolve(new Response(requestPath(input) === '/version.json' ? metadataVersion : index));
  const result = await coreMemoryProductIdentity('https://metadata.test/', 'blender-template', metadataVersion, read);
  expect(result).toMatchObject({status: 'observed', shard: 'blender-template', path: '/shardfiles/blender-template/shard.json',
    indexHash: createHash('sha256').update(index).digest('hex')});
});

test('changed builds cannot identify a product from the native reading', async () => {
  for (const changedAt of [1, 3]) {
    let calls = 0;
    const read: typeof fetch = () => {
      calls++;
      return Promise.resolve(new Response(calls === changedAt ? JSON.stringify({build: '2222222-rebuilt'}) : calls === 2 ? metadataIndex : metadataVersion));
    };
    const result = await coreMemoryProductIdentity('https://metadata.test/', '_template', metadataVersion, read);
    expect(result?.status).toBe('unavailable');
    if (result?.status !== 'unavailable') throw new Error('Missing metadata refusal');
    expect(result.error).toContain('build changed');
    expect(result).not.toHaveProperty('indexHash');
  }
});

test('missing, foreign and corrupt product metadata remains unavailable', async () => {
  for (const response of [new Response(null, {status: 404}), new Response('{broken'),
    new Response(metadataIndex.replace('template', 'different-shard')),
    new Response(metadataIndex.replace('template', '_template')),
    new Response(metadataIndex.replace('a'.repeat(64), 'bad-hash')),
    new Response(metadataIndex, {headers: {'content-length': String(MiB + 1)}})]) {
    const read: typeof fetch = input => Promise.resolve(requestPath(input) === '/version.json' ? new Response(metadataVersion) : response);
    const result = await coreMemoryProductIdentity('https://metadata.test/', '_template', metadataVersion, read);
    expect(result).toMatchObject({status: 'unavailable'});
    expect(result).not.toHaveProperty('indexHash');
  }
});

test('an oversized unknown-length index stream is cancelled at the diagnostic cap', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({start(controller) { controller.enqueue(new Uint8Array(MiB + 1)); }, cancel() { cancelled = true; }});
  const read: typeof fetch = input => Promise.resolve(requestPath(input) === '/version.json' ? new Response(metadataVersion) : new Response(body));
  const result = await coreMemoryProductIdentity('https://metadata.test/', '_template', metadataVersion, read);
  expect(result?.status).toBe('unavailable');
  if (result?.status !== 'unavailable') throw new Error('Missing metadata refusal');
  expect(result.error).toContain('exceeds cap');
  expect(cancelled).toBe(true);
});

test('saved estimate audits keep a one-byte tolerance miss separate from the native budget', () => {
  const summary = {rev: '1'.repeat(40), coreMemory: '_template', results: [{...nativeProtocol, version: JSON.stringify({build: '1111111-fixture'}), shard: '_template', errors: [],
    samples: [{phase: '120s', rendererBytes: 250_000_000, gpuBytes: 50_000_000}]}]};
  const result = spawnSync('node', ['scripts/shard-phone-memory.mjs', 'audit-estimate', '_template', '345000001'],
    {encoding: 'utf8', input: JSON.stringify(summary)});
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"within15Percent":false');
  expect(result.stdout).toContain('"budgetPassed":false');
  const accurate = spawnSync('node', ['scripts/shard-phone-memory.mjs', 'audit-estimate', '_template', '300000000'],
    {encoding: 'utf8', input: JSON.stringify(summary)});
  expect(accurate.status).toBe(1);
  expect(accurate.stdout).toContain('"within15Percent":true');
  expect(accurate.stdout).toContain('"budgetPassed":false');
  const small = summary.results[0];
  if (small === undefined) throw new Error('Missing native fixture');
  const passing = spawnSync('node', ['scripts/shard-phone-memory.mjs', 'audit-estimate', '_template', '100000000'],
    {encoding: 'utf8', input: JSON.stringify({...summary, results: [{...small,
      samples: [{phase: '120s', rendererBytes: 90_000_000, gpuBytes: 10_000_000}]}]})});
  expect(passing.status).toBe(0);
  expect(passing.stdout).toContain('"within15Percent":true');
  expect(passing.stdout).toContain('"budgetPassed":true');
});

test('model tolerance uses exact bytes in both directions and never grants a native budget pass', () => {
  const input = [{...nativeProtocol, shard: '_template', errors: [],
    samples: [{phase: '120s', rendererBytes: 250_000_000, gpuBytes: 50_000_000}]}];
  for (const estimate of [255_000_000, 345_000_000]) {
    expect(coreMemoryEstimateAudit(input, '_template', estimate)).toMatchObject({measuredBytes: 300_000_000,
      within15Percent: true, budgetPassed: false});
  }
  for (const estimate of [254_999_999, 345_000_001]) {
    expect(coreMemoryEstimateAudit(input, '_template', estimate)).toMatchObject({within15Percent: false, budgetPassed: false});
  }
  expect(coreMemoryEstimateAudit([], '_template', 300_000_000)).toMatchObject({measuredBytes: null, within15Percent: null, errorPercent: null, budgetPassed: false});
  for (const estimate of [-1, 0, 1.5, Number.NaN, Infinity]) expect(() => coreMemoryEstimateAudit(input, '_template', estimate)).toThrow();
  expect(() => coreMemoryEstimateAudit(input, 'other', 300_000_000)).toThrow('Unknown app');
});

test('saved estimate audits refuse mixed source pins before issuing a verdict', () => {
  const summary = {rev: '1'.repeat(40), coreMemory: '_template', results: [{...nativeProtocol, version: JSON.stringify({build: '2222222-other'}), shard: '_template', errors: [],
    samples: [{phase: '120s', rendererBytes: 1, gpuBytes: 1}]}]};
  const result = spawnSync('node', ['scripts/shard-phone-memory.mjs', 'audit-estimate', '_template', '1'],
    {encoding: 'utf8', input: JSON.stringify(summary)});
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('source pin differs');
});

test('saved Template-pair estimates audit either floor without admitting other cohorts', () => {
  const pair = rows().slice(2).map(row => Object.assign(row, {version: JSON.stringify({build: '1111111-fixture'}),
    samples: row.samples.map(sample => ({...sample, rendererBytes: 208182520 - 10 * MiB}))}));
  const summary = {rev: '1'.repeat(40), coreMemory: 'templates', results: pair};
  const audit = (target: string, input: unknown = summary) => spawnSync('node', [
    'scripts/shard-phone-memory.mjs', 'audit-estimate', target, '208182520',
  ], {encoding: 'utf8', input: JSON.stringify(input)});
  for (const target of ['_template', 'blender-template']) {
    const result = audit(target);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`"shard":"${target}"`);
    expect(result.stdout).toContain('"measuredBytes":208182520');
    expect(result.stdout).toContain('"within15Percent":true');
    expect(result.stdout).toContain('"budgetPassed":true');
  }
  const unrelated = audit('menu');
  expect(unrelated.status).toBe(1); expect(unrelated.stdout).toBe('');
  expect(unrelated.stderr).toContain('does not select');
  const mixed = [...pair, {...nativeProtocol, shard: 'menu', errors: [], samples: [], version: JSON.stringify({build: '1111111-fixture'})}];
  const collected = structuredClone(pair), foreign = structuredClone(pair);
  for (const row of collected) row.forcedGC = true;
  for (const row of foreign) row.version = JSON.stringify({build: '2222222-other'});
  for (const results of [mixed, collected, foreign]) {
    const refused = audit('_template', {...summary, results});
    expect(refused.status).toBe(1); expect(refused.stdout).toBe('');
  }
  const missing = audit('_template', {...summary, results: pair.filter(row => row.shard !== '_template')});
  expect(missing.status).toBe(1);
  expect(missing.stdout).toContain('"measuredBytes":null');
  expect(missing.stdout).toContain('"within15Percent":null');
  expect(missing.stdout).toContain('"budgetPassed":false');
});

test('four independent floors use the picked combined process limits', () => {
  expect(webKitCoreMemoryFloorBytes).toBe(87397464 + 15927456);
  expect(coreMemoryTargets.map(target => [target.shard, target.limitBytes])).toEqual([
    ['menu', webKitCoreMemoryFloorBytes + 50 * MiB], ['select', webKitCoreMemoryFloorBytes + 50 * MiB],
    ['_template', 274_538_200], ['blender-template', 261_512_872],
  ]);
  expect(coreMemorySummary(rows()).every(row => row.passed && row.totalBytes === row.limitBytes)).toBe(true);
});

test('WebKit budgets refuse Chromium, collected and unlabelled readings', () => {
  const native = {shard: 'menu', errors: [], protocol: 'webkit-core-floor/1', mode: 'cold',
    forcedGC: false, inspectorResponseBodyBytes: 0,
    samples: [{phase: '120s', rendererBytes: 1, gpuBytes: 1}]};
  for (const patch of [{protocol: 'chromium-phone-core/1'}, {protocol: undefined},
    {mode: 'warm'}, {forcedGC: true}, {inspectorResponseBodyBytes: 1}]) {
    expect(() => coreMemorySummary([{...native, ...patch}], 'menu')).toThrow();
  }
});

test('single-floor cohorts retain the original target and refuse unknown selections', () => {
  expect(selectedCoreMemoryTargets('all')).toBe(coreMemoryTargets);
  for (const target of coreMemoryTargets) {
    const selected = selectedCoreMemoryTargets(target.shard);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(target);
  }
  for (const selection of ['', 'template', '_template,menu', 'unknown']) {
    expect(() => selectedCoreMemoryTargets(selection)).toThrow('Expected --core-memory');
  }
});

test('Template-only cohorts retain both original floors and refuse mixed or missing evidence', () => {
  const targets = selectedCoreMemoryTargets('templates');
  expect(targets.map(target => target.shard)).toEqual(['_template', 'blender-template']);
  expect(targets[0]).toBe(coreMemoryTargets[2]); expect(targets[1]).toBe(coreMemoryTargets[3]);
  const input = rows().slice(2);
  expect(coreMemorySummary(input, 'templates')).toEqual(coreMemorySummary(rows()).slice(2));
  expect(coreMemorySummary(input.slice(0, 1), 'templates')[1]).toMatchObject({totalBytes: null, passed: false});
  expect(() => coreMemorySummary(rows(), 'templates')).toThrow('Duplicate or unknown');
  const first = input[0];
  if (first === undefined) throw new Error('Missing native Template fixture');
  expect(() => coreMemorySummary([{...first, forcedGC: true}], 'templates')).toThrow();
  expect(() => coreMemorySummary([{...first, protocol: 'chromium-phone-core/1'}], 'templates')).toThrow();
});

test('single-floor verdicts enforce the same limit without requiring other visits', () => {
  for (const target of coreMemoryTargets) {
    const input = {...nativeProtocol, shard: target.shard, errors: [], samples: [
      {phase: '120s', rendererBytes: target.limitBytes - 1, gpuBytes: 1},
    ]};
    expect(coreMemorySummary([input], target.shard)).toEqual([
      {...target, totalBytes: target.limitBytes, passed: true},
    ]);
    input.samples[0] = {phase: '120s', rendererBytes: target.limitBytes, gpuBytes: 1};
    expect(coreMemorySummary([input], target.shard)).toEqual([
      {...target, totalBytes: target.limitBytes + 1, passed: false},
    ]);
    expect(coreMemorySummary([], target.shard)).toEqual([
      {...target, totalBytes: null, passed: false},
    ]);
    expect(coreMemorySummary([{...input, errors: ['reader failed']}], target.shard)).toEqual([
      {...target, totalBytes: null, passed: false},
    ]);
  }
});

test('single-floor verdicts refuse foreign results and non-app targets', () => {
  expect(() => coreMemorySummary(rows(), 'menu')).toThrow('Duplicate or unknown');
  for (const selection of ['hello', 'unknown', '', 'menu,select']) {
    expect(() => coreMemorySummary([], selection)).toThrow('Unknown app core memory floor');
  }
});

test('uses original 120s values, counts GPU, and never substitutes a cache-clear improvement', () => {
  const input = rows();
  const menu = input[0], target = coreMemoryTargets[0];
  if (menu === undefined || target === undefined) throw new Error('Missing menu fixture');
  menu.samples = [{phase: '10s', rendererBytes: 300 * MiB, gpuBytes: 30 * MiB},
    {phase: '60s', rendererBytes: 200 * MiB, gpuBytes: 30 * MiB},
    {phase: '120s', rendererBytes: target.limitBytes - 5 * MiB, gpuBytes: 6 * MiB},
    {phase: 'after-http-cache-clear', rendererBytes: MiB, gpuBytes: MiB}];
  expect(coreMemorySummary(input)[0]).toMatchObject({totalBytes: target.limitBytes + MiB, passed: false});
});

test('missing, failed and invalid readings cannot pass as zero', () => {
  expect(coreMemorySummary([])).toHaveLength(4);
  expect(coreMemorySummary([]).every(row => row.totalBytes === null && !row.passed)).toBe(true);
  expect(coreMemorySummary([{...nativeProtocol, shard: 'menu', errors: ['page failed'], samples: [{phase: '120s', rendererBytes: 1, gpuBytes: 1}]}])[0])
    .toMatchObject({totalBytes: null, passed: false});
  expect(coreMemorySummary([{...nativeProtocol, shard: 'menu', errors: [], samples: [{phase: '10s', rendererBytes: 1, gpuBytes: 1}]}])[0])
    .toMatchObject({totalBytes: null, passed: false});
  for (const rendererBytes of [-1, Number.NaN, Infinity, undefined]) expect(() => coreMemorySummary([
    {shard: 'menu', errors: [], samples: [{phase: '120s', rendererBytes, gpuBytes: 1}]},
  ])).toThrow();
});

test('GPU-only readings cannot qualify a missing WebContent floor', () => {
  for (const gpuBytes of [0, 10 * MiB]) {
    const input = [{...nativeProtocol, shard: '_template', errors: [],
      samples: [10, 60, 120].map(second => ({phase: `${second}s`, rendererBytes: 0, gpuBytes}))}];
    expect(coreMemorySummary(input, 'templates')[0]).toMatchObject({totalBytes: null, passed: false});
    expect(coreMemoryEstimateAudit(input, '_template', MiB)).toMatchObject({measuredBytes: null,
      errorPercent: null, within15Percent: null, budgetPassed: false});
  }
  // An absent GPU process is supported; a real WebContent reading still qualifies.
  expect(coreMemorySummary([{...nativeProtocol, shard: '_template', errors: [],
    samples: [{phase: '120s', rendererBytes: MiB, gpuBytes: 0}]}], 'templates')[0])
    .toMatchObject({totalBytes: MiB, passed: true});
});

test('Chromium diagnostics retain original totals and errors without native verdicts', () => {
  const input = rows().map(({shard, errors, samples}) => ({shard, errors, samples, protocol: 'chromium-phone-core/1'}));
  expect(chromiumCoreMemorySummary(input)).toEqual(coreMemoryTargets.map(({shard, name, limitBytes}) => ({
    shard, name, totalBytes: limitBytes,
  })));
  const menu = input[0];
  if (menu === undefined) throw new Error('Missing diagnostic fixture');
  expect(chromiumCoreMemorySummary([{...menu, errors: ['page failed']}])[0]).toMatchObject({totalBytes: null});
  expect(chromiumCoreMemorySummary([]).every(row => row.totalBytes === null)).toBe(true);
  expect(() => chromiumCoreMemorySummary(rows())).toThrow();
  expect(() => coreMemorySummary(input)).toThrow();
});

test('duplicate or foreign floors and duplicate acceptance samples refuse', () => {
  const input = rows();
  expect(() => coreMemorySummary([...input, ...input])).toThrow('Duplicate or unknown');
  expect(() => coreMemorySummary([{shard: 'other', errors: [], samples: []}])).toThrow('Duplicate or unknown');
  expect(() => coreMemorySummary([{shard: 'menu', errors: [], samples: [
    {phase: '120s', rendererBytes: 1, gpuBytes: 1}, {phase: '120s', rendererBytes: 2, gpuBytes: 2},
  ]}])).toThrow('Duplicate 120s');
});

test('core command requires the floor protocol and source pin before any browser', () => {
  for (const flags of [[], ['--floor']]) {
    expect(() => execFileSync('node', ['scripts/shard-phone-memory.mjs', 'http://127.0.0.1:1', 'core', 'fixture', 'tmp/unused-core.json', ...flags],
      {encoding: 'utf8', stdio: 'pipe'})).toThrow(flags.length > 0 ? 'Core floors require --pin' : 'Menu/core targets require --floor');
  }
});

test('single compiled floors require their protocol and exact pin before any browser', () => {
  for (const flags of [[], ['--floor']]) expect(() => execFileSync('node', [
    'scripts/shard-phone-memory.mjs', 'http://127.0.0.1:1', '_template', 'fixture', 'tmp/unused-core.json', '--compiled', ...flags,
  ], {encoding: 'utf8', stdio: 'pipe'})).toThrow('Compiled floor requires');
});

test('official WebKit core floors refuse mixed entry modes or duplicate readings before Simulator access', () => {
  const run = (flags: readonly string[]): string => execFileSync('node', ['scripts/sim-grid-entry.mjs', '--base=http://127.0.0.1:1', ...flags],
    {encoding: 'utf8', stdio: 'pipe', env: {...process.env, SIM_UDID: 'no-device-opened'}});
  expect(() => run(['--core-memory=all', '--shard=_template'])).toThrow('Expected --core-memory');
  expect(() => run(['--core-memory=unknown'])).toThrow('Expected --core-memory');
  expect(() => run(['--core-memory=all', '--runs=2'])).toThrow('exactly one cold reading');
  expect(() => run(['--core-memory=all', '--modes=cold,warm'])).toThrow('exactly one cold reading');
  expect(() => run(['--core-attribution=1'])).toThrow('Core attribution requires');
  expect(() => run(['--core-memory=all', '--core-attribution=2'])).toThrow('Core attribution requires');
});

test('upgrade observation refuses unrelated or repeated Simulator scenarios before device access', () => {
  expect(() => execFileSync('node', ['scripts/sim-grid-entry.mjs', '--base=http://127.0.0.1:1', '--upgrade-second-tap=1'],
    { encoding: 'utf8', stdio: 'pipe', env: {...process.env, SIM_UDID: 'no-device-opened'} })).toThrow('Second tap diagnostic requires');
  for (const flags of [[], ['--runs=2', '--modes=warm'], ['--runs=1', '--modes=cold'], ['--runs=1', '--modes=warm', '--shard=_template']]) {
    expect(() => execFileSync('node', ['scripts/sim-grid-entry.mjs', '--base=http://127.0.0.1:1', '--upgrade-from=https://example.test', ...flags],
      {encoding: 'utf8', stdio: 'pipe', env: {...process.env, SIM_UDID: 'no-device-opened'}})).toThrow('one warm grid run');
  }
});

test('Simulator footprint sums original process identities and keeps GPU separate', () => {
  const webContent = [{pid: 12, startAbstime: 100, physicalFootprintBytes: 120 * MiB},
    {pid: 13, startAbstime: 101, physicalFootprintBytes: 20 * MiB}];
  const gpu = [{pid: 14, startAbstime: 102, physicalFootprintBytes: 30 * MiB}];
  expect(simulatorCoreFootprint({webContent, gpu})).toEqual({webContent, gpu, rendererBytes: 140 * MiB, gpuBytes: 30 * MiB});
  expect(simulatorCoreFootprint({webContent, gpu: []}).gpuBytes).toBe(0);
});

test('Simulator missing, duplicate or corrupt native process readings refuse', () => {
  const process = {pid: 12, startAbstime: 100, physicalFootprintBytes: MiB};
  for (const input of [{webContent: [], gpu: []}, {webContent: [process]},
    {webContent: [process], gpu: [process]}, {webContent: [{...process, physicalFootprintBytes: -1}], gpu: []},
    {webContent: [{...process, startAbstime: 0}], gpu: []}]) expect(() => simulatorCoreFootprint(input)).toThrow();
});


test('a zero-byte process cannot hide inside a positive native aggregate', () => {
  const known = {pid: 12, startAbstime: 100, physicalFootprintBytes: MiB};
  const missing = {pid: 13, startAbstime: 101, physicalFootprintBytes: 0};
  for (const input of [{webContent: [known, missing], gpu: []},
    {webContent: [known], gpu: [missing]}, {webContent: [missing], gpu: []}]) {
    expect(() => simulatorCoreFootprint(input)).toThrow();
  }
  expect(simulatorCoreFootprint({webContent: [known], gpu: []}))
    .toMatchObject({rendererBytes: MiB, gpuBytes: 0});
});

test('hello-world is a calibration target and never part of the app cohort', () => {
  const target = selectedCoreMemoryTargets('hello');
  expect(target).toEqual([{shard: 'hello', name: 'Hello, world', limitBytes: null}]);
  expect(selectedCoreMemoryTargets('all').some(row => row.shard === 'hello')).toBe(false);
});

test('hello-world root stays plain while the context fixture has no app assets', async () => {
  const fixture = await serveHelloWorldMemory();
  try {
    const page = await fetch(fixture.url);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toBe(helloWorldMemoryHTML);
    expect(helloWorldMemoryHTML).toContain('<body>Hello, world.</body>');
    expect(helloWorldMemoryHTML).not.toMatch(/<(?:script|style|link|img|canvas)\b/iu);
    expect((await fetch(`${fixture.url}/version.json`)).status).toBe(200);
    expect((await fetch(`${fixture.url}/clear-cache.json?sw=0`)).status).toBe(200);
    expect((await fetch(`${fixture.url}/assets/main.js`)).status).toBe(404);
    expect(await (await fetch(`${fixture.url}/webgl`)).text()).toBe(webGLMemoryHTML);
    expect(webGLMemoryHTML).toContain("canvas.getContext('webgl2'");
    expect(webGLMemoryHTML).not.toMatch(/(?:src=|fetch\(|import\s|requestAnimationFrame)/u);
  } finally { await fixture.close(); }
});

const helloCalibration = () => ({shard: 'hello', protocol: 'webkit-core-floor/1', mode: 'cold', forcedGC: false,
  inspectorResponseBodyBytes: 0, scriptURLs: [], errors: [],
  calibrationDocument: {title: 'Hello, world', text: 'Hello, world.', scripts: 0, canvases: 0},
  samples: [10, 60, 120].map(second => ({phase: `${second}s`, rendererBytes: (90 - second / 2) * MiB, gpuBytes: 7 * MiB}))});

test('hello-world budget base is exactly the unforced 120s combined native sample', () => {
  expect(helloWorldMemoryFloor(helloCalibration())).toEqual({phase: '120s', rendererBytes: 30 * MiB,
    gpuBytes: 7 * MiB, totalBytes: 37 * MiB, menuLimitBytes: 87 * MiB, templateLimitBytes: 137 * MiB});
  for (const patch of [{forcedGC: true}, {mode: 'warm'}, {inspectorResponseBodyBytes: 1}, {scriptURLs: ['app.js']},
    {errors: ['page failed']}, {samples: []}, {samples: helloCalibration().samples.slice(1)},
    {samples: [...helloCalibration().samples, ...helloCalibration().samples]},
    {calibrationDocument: {...helloCalibration().calibrationDocument, canvases: 1}}]) {
    expect(() => helloWorldMemoryFloor({...helloCalibration(), ...patch})).toThrow();
  }
});

test('hello-world refuses app origins or revisions before touching a Simulator', () => {
  for (const flag of ['--base=http://127.0.0.1:1', '--rev=abc']) {
    expect(() => execFileSync('node', ['scripts/sim-grid-entry.mjs', '--core-memory=hello', flag],
      {encoding: 'utf8', stdio: 'pipe', env: {...process.env, SIM_UDID: 'no-device-opened'}})).toThrow('serves its own fixture');
  }
});

const webGLCalibration = () => ({...helloCalibration(), shard: 'webgl',
  samples: helloCalibration().samples.map(sample => Object.assign(sample, {page: {prefetch: null, resources: 0}})),
  calibrationDocument: {title: 'WebGL context', scripts: 1, canvases: 1, ready: true, contexts: 1, clears: 1, losses: 0, lost: false,
    width: 804, height: 1748, viewportWidth: 402, viewportHeight: 874,
    attributes: {alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: false}}});

test('context diagnostic retains the original hello target and never adds an app budget', () => {
  expect(selectedCoreMemoryTargets('contexts')).toEqual([...selectedCoreMemoryTargets('hello'), webGLMemoryTarget]);
  expect(selectedCoreMemoryTargets('webgl')).toEqual([webGLMemoryTarget]);
  expect(selectedCoreMemoryTargets('all')).toHaveLength(4);
  expect(webGLMemoryFloor(webGLCalibration())).toEqual({phase: '120s', rendererBytes: 30 * MiB, gpuBytes: 7 * MiB, totalBytes: 37 * MiB});
  expect(webKitCoreMemoryFloorBytes).toBe(103324920);
  expect(() => coreMemorySummary([webGLCalibration()])).toThrow('unknown');
  expect(() => helloWorldMemoryFloor(webGLCalibration())).toThrow();
});

test('context diagnostic refuses missing clocks, collection and extra content', () => {
  for (const patch of [{mode: 'warm'}, {forcedGC: true}, {protocol: 'chromium-phone-core/1'},
    {inspectorResponseBodyBytes: 1}, {scriptURLs: ['app.js']}, {errors: ['context failed']},
    {samples: webGLCalibration().samples.slice(1)}, {samples: [...webGLCalibration().samples, ...webGLCalibration().samples]},
    {samples: webGLCalibration().samples.map(sample => Object.assign(sample, {page: {prefetch: null, resources: 1}}))}]) {
    expect(() => webGLMemoryFloor({...webGLCalibration(), ...patch})).toThrow();
  }
  for (const patch of [{ready: false}, {contexts: 2}, {clears: 2}, {losses: 1}, {lost: true},
    {scripts: 2}, {canvases: 2}, {width: 402}, {height: 874},
    {attributes: {...webGLCalibration().calibrationDocument.attributes, antialias: true}}]) {
    expect(() => webGLMemoryFloor({...webGLCalibration(), calibrationDocument: {...webGLCalibration().calibrationDocument, ...patch}})).toThrow();
  }
});

test('context calibration refuses app revisions, attribution and repeat modes before Simulator access', () => {
  const run = (selection: string, flag: string): string => execFileSync('node', ['scripts/sim-grid-entry.mjs', `--core-memory=${selection}`, flag],
    {encoding: 'utf8', stdio: 'pipe', env: {...process.env, SIM_UDID: 'no-device-opened'}});
  for (const selection of ['webgl', 'contexts', 'three']) {
    for (const flag of ['--base=http://127.0.0.1:1', '--rev=abc']) expect(() => run(selection, flag)).toThrow('serves its own fixture');
    expect(() => run(selection, '--core-attribution=1')).toThrow('requires an app');
    for (const flag of ['--runs=2', '--modes=warm']) expect(() => run(selection, flag)).toThrow('exactly one cold');
  }
});

const threeCalibration = () => ({...webGLCalibration(), shard: 'three',
  scriptURLs: ['http://127.0.0.1:4400/three.module.js', 'http://127.0.0.1:4400/three.core.js'],
  fixtureModules: ['three.module.js', 'three.core.js'].map(path => ({path: `/${path}`, bytes: 100, sha256: 'a'.repeat(64)})),
  samples: webGLCalibration().samples.map(sample => Object.assign(sample, {page: {prefetch: null, resources: 2, href: 'http://127.0.0.1:4400/three'}})),
  calibrationDocument: {...webGLCalibration().calibrationDocument, title: 'Three.js renderer', revision: '186',
    rendererInfo: {geometries: 0, textures: 0, programs: 0, calls: 0}}});

test('Three.js fixture passes the original opaque context into its renderer', () => {
  const contexts: WebGLContextAttributes[] = [];
  const gl = {clearColor: vi.fn(), clear: vi.fn(), getError: () => 0, NO_ERROR: 0, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2};
  const canvas = {addEventListener: vi.fn(), getContext: (_kind: string, attributes: WebGLContextAttributes) => { contexts.push(attributes);return gl; }};
  class WebGLRenderer {
    readonly context: typeof gl;
    constructor(parameters: {canvas: typeof canvas; context?: typeof gl}) {
      // r186 requests alpha:true when creating its own context, even when its
      // renderer options contain alpha:false. Injected contexts are preserved.
      this.context = parameters.context ?? parameters.canvas.getContext('webgl2', {alpha: true});
    }
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    getContext(): typeof gl { return this.context; }
  }
  const script = /<script type="module">([\s\S]*?)<\/script>/u.exec(threeMemoryHTML)?.[1];
  if (script === undefined) throw new Error('Missing Three.js fixture module');
  const window = {};
  runInNewContext(script.replace(/^import[^\n]+;$/mu, ''), {WebGLRenderer, REVISION: '186', window,
    document: {querySelector: () => canvas}, innerWidth: 402, innerHeight: 714});
  expect(contexts).toEqual([{alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: false}]);
  expect(window).toMatchObject({__ws_coreThree: {ready: true, contexts: 1, clears: 1, losses: 0}});
  expect(gl.clear).toHaveBeenCalledExactlyOnceWith(3);
});

test('Three.js fixture serves only installed module bytes with independent wire hashes', async () => {
  const plain = await serveHelloWorldMemory();
  try {
    expect((await fetch(`${plain.url}/three`)).status).toBe(404);
    expect((await fetch(`${plain.url}/three.module.js`)).status).toBe(404);
    expect(plain.modules).toEqual([]);
  } finally { await plain.close(); }
  const fixture = await serveHelloWorldMemory(true);
  try {
    expect(await (await fetch(`${fixture.url}/three`)).text()).toBe(threeMemoryHTML);
    expect(await (await fetch(`${fixture.url}/version.json`)).json()).toEqual({build: 'webkit-three-renderer-v1'});
    expect(threeMemoryHTML).not.toMatch(/(?:new Scene|new Mesh|requestAnimationFrame|\.render\(|fetch\(|\/src\/)/u);
    expect(fixture.modules.map(module => module.path).sort()).toEqual(['/three.core.js', '/three.module.js']);
    for (const module of fixture.modules) {
      const response = await fetch(`${fixture.url}${module.path}`), bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(bytes.length).toBe(module.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(module.sha256);
      expect(bytes.length).toBeGreaterThan(100_000);
    }
    for (const path of ['/assets/main.js', '/three.cjs', '/three.webgpu.js', '/src/client/app/entry.ts']) expect((await fetch(`${fixture.url}${path}`)).status).toBe(404);
  } finally { await fixture.close(); }
});

test('empty Three.js diagnostic cannot qualify an app floor or rebase G682', () => {
  expect(selectedCoreMemoryTargets('three')).toEqual([threeMemoryTarget]);
  expect(selectedCoreMemoryTargets('all')).toHaveLength(4);
  expect(threeMemoryFloor(threeCalibration())).toEqual({phase: '120s', rendererBytes: 30 * MiB, gpuBytes: 7 * MiB, totalBytes: 37 * MiB});
  expect(() => coreMemorySummary([threeCalibration()])).toThrow('unknown');
  expect(() => helloWorldMemoryFloor(threeCalibration())).toThrow();
  expect(() => webGLMemoryFloor(threeCalibration())).toThrow();
  expect(webKitCoreMemoryFloorBytes).toBe(103324920);
});

test('diagnostic refusal remains explicit without losing or mutating completed captures', () => {
  const raw = threeCalibration();
  raw.calibrationDocument.attributes.alpha = true;
  const original = JSON.stringify(raw), result = contextMemoryDiagnostic(raw);
  expect(result.calibration).toBeNull();
  expect(result.error).toContain('Expected false');
  expect(JSON.stringify(raw)).toBe(original);
  for (const valid of [helloCalibration(), webGLCalibration(), threeCalibration()]) {
    expect(contextMemoryDiagnostic(valid)).toEqual({calibration: {shard: valid.shard, phase: '120s', rendererBytes: 30 * MiB, gpuBytes: 7 * MiB, totalBytes: 37 * MiB}, error: null});
  }
});

test('Three.js diagnostic refuses foreign resources, content, incomplete clocks and collection', () => {
  for (const patch of [{forcedGC: true}, {mode: 'warm'}, {protocol: 'chromium-phone-core/1'}, {errors: ['failed']},
    {inspectorResponseBodyBytes: 1}, {fixtureModules: []}, {scriptURLs: ['app.js', 'three.core.js']},
    {scriptURLs: ['https://other.test/three.module.js', 'https://other.test/three.core.js']},
    {scriptURLs: ['http://127.0.0.1:4400/three.core.js', 'http://127.0.0.1:4400/three.core.js']},
    {samples: threeCalibration().samples.slice(1)}, {samples: [...threeCalibration().samples, ...threeCalibration().samples]},
    {samples: threeCalibration().samples.map(sample => Object.assign(sample, {page: Object.assign(sample.page, {resources: 3})}))},
    {samples: threeCalibration().samples.map(sample => Object.assign(sample, {page: Object.assign(sample.page, {href: 'http://other.test/three'})}))}]) {
    expect(() => threeMemoryFloor({...threeCalibration(), ...patch})).toThrow();
  }
  for (const patch of [{ready: false}, {contexts: 2}, {clears: 2}, {losses: 1}, {lost: true}, {width: 402},
    {rendererInfo: {geometries: 0, textures: 1, programs: 0, calls: 0}},
    {rendererInfo: {geometries: 1, textures: 0, programs: 0, calls: 0}},
    {rendererInfo: {geometries: 0, textures: 0, programs: 1, calls: 0}},
    {rendererInfo: {geometries: 0, textures: 0, programs: 0, calls: 1}}]) {
    expect(() => threeMemoryFloor({...threeCalibration(),calibrationDocument: {...threeCalibration().calibrationDocument,...patch}})).toThrow();
  }
});
