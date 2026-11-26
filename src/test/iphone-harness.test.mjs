import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, test, vi } from 'vitest';
import { agentUrl } from '../scripts/agent-marker.mjs';
import { commands } from '../scripts/memory/iphone-footprint.mjs';
import { frameSummary } from '../scripts/memory/iphone/frames.mjs';
import { activityMonitor, footprintWindow, timedSample } from '../scripts/memory/iphone/record.mjs';
import { enterZone, openSharedSafari, pageState, readRecovery } from '../scripts/memory/iphone/safari.mjs';
import recorded from '../../test/fixtures/iphone-memory/recorded-boots.json';

const base = 'https://staging.wildshard.io';
const endpoint = 'http://127.0.0.1:4444';
const element = { 'element-6066-11e4-a52e-4f735466cecf': 'enter' };
afterEach(() => vi.restoreAllMocks());

/** @param {{ slug: string; build: string; stage?: string; progress?: string; driverError?: string }} record */
function replay(record) {
  const calls = [];
  const data = new Map();
  const storage = { clear: () => data.clear(), getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let switched = false, entered = false, polled = 0, originReads = 0;
  let href = 'about:blank';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, request) => {
    const path = url.pathname.replace(/^\/session\/replay(?:-replacement)?/u, '');
    const body = request.body === undefined ? {} : JSON.parse(request.body);
    calls.push([request.method, path, body]);
    if (path === '/session') return Response.json({ value: { sessionId: switched ? 'replay-replacement' : 'replay' } });
    if (path === '/window/handles') return Response.json({ value: ['old'] });
    if (path === '/window/new') return Response.json({ value: { handle: 'new' } });
    if (path === '/url') {
      href = body.url;
      originReads = 0;
    }
    if (path === '/element/enter/click') entered = true;
    if (path === '/execute/sync') {
      if (body.script === 'return location.origin;') {
        originReads++;
        return Response.json({ value: originReads === 1 ? 'null' : new URL(href).origin });
      }
      if (body.script === pageState) {
        if (entered) polled++;
        if (polled === 2 && record.driverError) {
          return Response.json({ value: { error: record.driverError, message: record.driverError } }, { status: 404 });
        }
        const state = { build: record.build, visible: true, control: polled === 2, timeOrigin: 1,
          phases: { su: { fact: record.stage ?? 'Ready', pct: record.progress ?? '100%' } } };
        return Response.json({ value: state });
      }
      if (body.args[0]?.includes?.('enter zone') && !entered) return Response.json({ value: { el: element, label: 'enter zone' } });
      if (body.script.includes('Origin moved before recovery read')) {
        const value = runInNewContext(`(function(){ ${body.script} }).apply(null, args)`, {
          args: body.args, localStorage: storage, location: { href, origin: new URL(href).origin },
        });
        return Response.json({ value });
      }
    }
    if (path === '/execute/async') {
      expect(originReads).toBe(2);
      const value = await new Promise(done => {
        runInNewContext(`(function(){ ${body.script} }).apply(null, args)`, {
          args: [...body.args, done], localStorage: storage, sessionStorage: { clear() {} },
          location: { href, origin: new URL(href).origin }, navigator: { serviceWorker: { getRegistrations: async () => [] } },
          caches: { keys: async () => [] }, indexedDB: { databases: async () => [] },
        });
      });
      return Response.json({ value });
    }
    return Response.json({ value: null });
  });
  return { calls, next: () => { switched = true; return openSharedSafari(endpoint, 'test-device'); } };
}

test('recorded Nine boot reaches control after the origin wait, cold reset, slot readback and W3C click', async () => {
  const record = recorded.nine;
  const { calls } = replay(record);
  const driver = await openSharedSafari(endpoint, 'test-device');
  const boot = await enterZone(driver, { base, slug: record.slug, slots: { 'debug.phoneBudget': true, 'debug.loadGc': true } });
  expect(boot).toMatchObject({ outcome: 'control', state: { build: record.build }, origin: {
    href: agentUrl(`${base}/robots.txt`), cache: { caches: 0, serviceWorkers: 0, databases: 0, http: 'may carry' },
  } });
  expect(boot.origin.saved).toContainEqual({ scope: 'device', key: 'debug.phoneBudget', data: true });
  const navigation = calls.filter(([method, path]) => method === 'POST' && path === '/url').map(([, , body]) => body.url);
  expect(navigation).toEqual([`${base}/robots.txt`, `${base}/slug/${record.slug}`].map(agentUrl));
  expect(calls.some(([, path]) => path === '/element/enter/click')).toBe(true);
  expect(calls.some(([, path]) => path.includes('screenshot'))).toBe(false);
});

test('recorded Pine tab loss retains its last stage and reads slots in a replacement session', async () => {
  const record = recorded.pine;
  const { next } = replay(record);
  const driver = await openSharedSafari(endpoint, 'test-device');
  const samples = [];
  await expect(enterZone(driver, { base, slug: record.slug, slots: { 'debug.phoneBudget': false }, observe: sample => samples.push(sample) }))
    .rejects.toMatchObject({ code: record.driverError });
  expect(samples.at(-1)).toMatchObject({ build: record.build, control: false, phases: { su: { fact: record.stage, pct: record.progress } } });
  await expect(readRecovery(await next(), base, ['debug.phoneBudget', 'graphics'])).resolves.toMatchObject({
    slots: { 'debug.phoneBudget': false, graphics: 'low' }, abrupt: null,
  });
});

test('footprint windows select a new PID, keep control and settled separate and preserve missing data', () => {
  const opened = 10_000, control = 11_000;
  const rows = Array.from({ length: 13 }, (_, i) => ({ name: 'com.apple.WebKit.WebContent', pid: 7,
    physFootprint: i === 0 ? 500 : 100 + i, time: opened + i * 500 }));
  const old = { ...rows[0], pid: 6, physFootprint: 999, time: opened - 100 };
  const sample = timedSample(JSON.stringify({ ...rows[0], timestamp: new Date(opened).toISOString() }));
  expect(sample).toEqual(rows[0]);
  expect(footprintWindow([old, { ...old, time: opened }, ...rows], opened, control))
    .toMatchObject({ pid: 7, peakBytes: 500, controlBytes: 102, settledBytes: 107.5, samples: 13 });
  expect(footprintWindow([{ ...old, time: opened }, ...rows], opened, control)).toMatchObject({ pid: null, peakBytes: null });
  // the inspector keeps Safari's tab: both processes predate the trial, and the zone's dwarfs the idle spare
  const spare = { ...old, physFootprint: 6, time: opened - 100 }, zone = rows.map((row) => ({ ...row, time: row.time }));
  expect(footprintWindow([spare, { ...spare, time: opened }, { ...zone[0], time: opened - 50 }, ...zone], opened, control))
    .toMatchObject({ pid: 7, peakBytes: 500 });
  // and a fresh spare process beside it is not the zone's
  expect(footprintWindow([{ ...zone[0], time: opened - 50 }, ...zone, { ...spare, pid: 8, time: opened + 600 }], opened, control))
    .toMatchObject({ pid: 7, peakBytes: 500 });
  expect(footprintWindow(rows.slice(0, 4), opened, control).settledBytes).toBeNull();
  expect(commands({ seconds: 60, out: 'tmp/iphone13' }).sysmon[0]).toContain('60000');
  expect(frameSummary([{ seconds: 1, frames: 30, tMs: 1000, frameMs: [25, 30, 33], gpuApproxMs: [1, 2, 3], draws: 121, triangles: 911_000 }]))
    .toMatchObject({ fps: 30, p50Ms: 30, p95Ms: 30, drawsP95: 121 });
});

test('dry-run exposes the harness modes and routes the release suite without touching the device', () => {
  const bench = 'src/scripts/memory/iphone/bench.mjs';
  for (const [mode, seconds] of [['boot', 30], ['walk', 60], ['soak', 600], ['staircase', 30]]) {
    const output = execFileSync(process.execPath, [bench, '--mode', mode, '--dry-run'], { encoding: 'utf8' });
    expect(JSON.parse(output.trim().split('\n').at(-1))).toMatchObject({ mode, seconds });
  }
  const release = execFileSync(process.execPath, [bench, '--suite', 'release', '--dry-run'], { encoding: 'utf8' });
  expect(release).toContain('Hold iphone13.lock for all captures');
  expect(release).toContain('"--zone","nine-dragon-stack","--mode","walk"');
});

test('Activity Monitor export resolves referenced cells and uses interval-end times for the sysmon PID', () => {
  const fixtures = 'test/fixtures/iphone-memory';
  const trace = { toc: `${fixtures}/activity-toc.xml`, samples: `${fixtures}/activity-rows.xml` };
  const parsed = activityMonitor(trace, [7]);
  const start = Date.parse('2026-11-19T10:57:43.538-05:00');
  expect(parsed.error).toBeNull();
  expect(parsed.series).toHaveLength(2);
  expect(parsed.series[0]).toEqual({ pid: 7, time: start + 1298.370125, physFootprint: 419744104 });
  expect(parsed.series[1]).toEqual({ pid: 7, time: start + 2596.74025, physFootprint: 419744104 });
  expect(activityMonitor(trace, [8])).toEqual({ series: [], error: 'No Activity Monitor sample for the selected PID' });
});
