// Opt-in attribution probe. Nothing here runs during a qualifying soak or measured travel.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readPageMemoryAttribution } from '../memory-report-snapshot.mjs';

/** Four matched cell circuits are a diagnostic, never a shortened qualifying soak. */
export function circuitDiagnostic(value, context) {
  if (value === '' || value === undefined || value === null) return null;
  if (String(value) !== '4' || context.qualifying || context.dryRun || context.contentCut !== null
    || context.firstCrossing || context.layout !== 'dev' || context.leg !== 'cells' || context.routeScope !== 'prepared') {
    throw new Error('Four-circuit diagnostics require nonqualifying Developer prepared cells, without other diagnostic/duration modes');
  }
  return 4;
}

/** Existing route plans stay authoritative; only this explicitly labelled probe omits the crossroads tour. */
export function circuitPlans(route, cycle, diagnostic) {
  // A lead-in (the public road leg leaving its borrowed home) runs once, before the first lap's plans. O12 (coordinator
  // ruling 10-21): the 5 x 5 road tour also runs once, first; the timed cell circuits follow it.
  return [...(cycle === 0 ? route.leadIn ?? [] : []), ...(cycle === 0 && diagnostic === null ? route.coveragePlans ?? [] : []), ...route.plans];
}

/** Scalar diagnostics only: do not read retired attribute arrays or issue GL queries. */
export const boundaryExpression = `(() => {
  const api = window.__wildshard, game = api.world.game, grid = api.shard.grid.state();
  return { at: Date.now()/1000, document: window.__sf57DocumentId, origin: performance.timeOrigin,
    token: window.__frameFloorGridDocumentToken,
    current: grid.live.live.current, inside: grid.inside, pending: grid.live.live.pending,
    gameplayReady: grid.live.live.gameplayReady, memory: (${readPageMemoryAttribution.toString()})(api),
    programs: (game.renderer.info.programs ?? []).map(p => ({id:p.id, name:p.name, usedTimes:p.usedTimes, cacheKey:p.cacheKey})),
    rendererMemory: {...game.renderer.info.memory}, gl: window.__sf57ReadGL(),
    performanceMemory: performance.memory ? {usedJSHeapSize:performance.memory.usedJSHeapSize,
      totalJSHeapSize:performance.memory.totalJSHeapSize, jsHeapSizeLimit:performance.memory.jsHeapSizeLimit} : null,
    wasm: (window.__sf57Wasm ?? []).map(({name,source,memory}) => ({name,source,bytes:memory.deref()?.buffer.byteLength ?? 0})) };
})()`;

/** WebKit v3 includes external payload estimates: these bytes are a subset of WC, never another total to add. */
export function summarizeHeap(text) {
  const data = JSON.parse(text);
  if (data.version !== 3 || (data.type !== undefined && data.type !== 'Inspector') || !Array.isArray(data.nodes) || data.nodes.length % 4 !== 0 || !Array.isArray(data.nodeClassNames)) {
    throw new Error('Unsupported WebKit heap snapshot');
  }
  const classes = new Map(); let bytes = 0;
  for (let i = 0; i < data.nodes.length; i += 4) {
    const size = data.nodes[i + 1], kind = data.nodeClassNames[data.nodes[i + 2]];
    if (!Number.isSafeInteger(size) || size < 0 || typeof kind !== 'string') throw new Error('Invalid WebKit heap node');
    bytes += size;
    const row = classes.get(kind) ?? { kind, bytes: 0, nodes: 0 }; row.bytes += size; row.nodes++; classes.set(kind, row);
  }
  return { version: data.version, nodes: data.nodes.length / 4, estimatedBytes: bytes,
    classes: [...classes.values()].sort((a, b) => b.bytes - a.bytes || a.kind.localeCompare(b.kind)) };
}

// Node exposes this custom adapter on a symbol; its type declaration names the same adapter __promisify__.
/** @type {typeof execFile.__promisify__} */
const execute = Reflect.get(execFile, promisify.custom);
/** Preserve native reads before an optional intrusive heap snapshot; missing support stays a visible refusal. */
export async function captureBoundary({ driver, pid, out, cycle, document, origin, categories,
  collect = () => Promise.resolve(), command = async (name, args) => (await execute(name, args,
    { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 })).stdout,
  write = writeFileSync }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Settled probe requires the fixed game WebContent PID');
  const result = { cycle, pid, startedAt: Date.now() / 1000, errors: [], native: {}, heap: null,
    policy: 'Diagnostic only. Native/SF64/program reads precede Heap.snapshot. Heap may collect; it is outside travel and never substitutes for the original soak.' };
  const checkpoint = () => { write(join(out, `boundary-${cycle}.json`), `${JSON.stringify(result, null, 2)}\n`); };
  const state = await driver.evaluate(boundaryExpression);
  const fence = value => {
    if (value.document !== document || value.token !== origin.token || !Number.isFinite(value.origin) || value.current !== 'driftwood-isle'
      || value.inside !== 'driftwood-isle' || value.pending.length > 0 || !value.gameplayReady) {
      throw new Error('Settled boundary changed the original document or home-ready pose');
    }
  };
  result.before = state; checkpoint(); fence(state);
  for (const [name, binary, args] of [
    ['vmmapSummary', 'vmmap', ['-summary', String(pid)]],
    ['vmmapVerbose', 'vmmap', ['-v', String(pid)]],
    ['footprint', 'footprint', ['-f', 'bytes', '-p', String(pid)]],
  ]) {
    const path = join(out, `boundary-${cycle}-${name}.txt`);
    try { const text = await command(binary, args); write(path, text); result.native[name] = { path, pid }; }
    catch (error) { result.native[name] = { error: String(error), pid }; result.errors.push(`${name}: ${String(error)}`); }
    checkpoint();
    await collect();
  }
  result.categories = await categories(driver);
  result.errors.push(...result.categories.errors);
  if (result.categories.samples.length === 0) result.errors.push('No passive WebKit memory category samples');
  checkpoint();
  await collect();
  if (cycle === 2 || cycle === 4) {
    const startedAt = Date.now() / 1000;
    try {
      await driver.send('Heap.enable');
      const heap = await driver.send('Heap.snapshot');
      if (typeof heap.snapshotData !== 'string') throw new Error('Missing WebKit heap snapshot data');
      const path = join(out, `boundary-${cycle}-heap.json`); write(path, heap.snapshotData);
      result.heap = { path, startedAt, endedAt: Date.now() / 1000, timestamp: heap.timestamp,
        bytes: Buffer.byteLength(heap.snapshotData), sha256: createHash('sha256').update(heap.snapshotData).digest('hex') };
      checkpoint(); result.heap.summary = summarizeHeap(heap.snapshotData);
    } catch (error) { result.heap = { ...result.heap, startedAt, error: String(error) }; result.errors.push(`heap: ${String(error)}`); }
    finally { await driver.send('Heap.disable').catch(error => result.errors.push(`Heap.disable: ${String(error)}`)); }
    checkpoint();
  }
  result.after = await driver.evaluate(boundaryExpression); checkpoint(); fence(result.after);
  await collect(); result.endedAt = Date.now() / 1000; checkpoint();
  return result;
}
