// Intrusive Template holder census, deliberately separate from G682 qualification.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeHeap } from './soak/boundary.mjs';

export const coreHeapProtocol = 'webkit-core-heap-diagnostic/1';
const templates = new Set(['_template', 'blender-template']);
/** Refuse mixed or broad captures before preview/Simulator work. */
export function coreHeapRequested(args) {
  if (args['core-heap'] === undefined) return false;
  if (args['core-heap'] !== '1' || !templates.has(args['core-memory']) || !/^[a-f0-9]{40}$/u.test(args.rev ?? '') || args.base !== undefined
    || (args.runs !== undefined && args.runs !== '1') || (args.modes !== undefined && args.modes !== 'cold')
    || args['core-attribution'] !== undefined || args['keep-video'] !== undefined) {
    throw new Error('Core heap diagnostic requires one pinned cold Template, without other diagnostic recorders');
  }
  return true;
}

const fenceExpression = `(() => {const w=window.__wildshard?.world;return {href:location.href,
  ready:!!w?.hud.entered&&!w.hud.paused&&w.game.frameGate()&&!document.querySelector('.ws-load')};})()`;
function fence(value, target) {
  if (value === null || typeof value !== 'object' || value.ready !== true || typeof value.href !== 'string'
    || new URL(value.href).searchParams.get('chunk') !== target) throw new Error('Heap diagnostic left its compiled Template');
  return value.href;
}
/** Raw snapshot and class estimates are diagnostic; Heap.snapshot may collect. */
export async function captureCoreHeap(driver, target, out, samples, write = writeFileSync) {
  if (!templates.has(target) || samples.map(row => row.phase).join(',') !== '10s,60s,120s') {
    throw new Error('Heap diagnostic requires sealed original Template samples');
  }
  const result = { protocol: coreHeapProtocol, qualifying: false, mayCollect: true,
    before: null, after: null, snapshot: null, errors: [] };
  try {
    result.before = fence(await driver.evaluate(fenceExpression), target);
  } catch (error) { result.errors.push(String(error)); return result; }
  try {
    await driver.send('Heap.enable');
    const heap = await driver.send('Heap.snapshot');
    if (heap === null || typeof heap !== 'object' || typeof heap.snapshotData !== 'string') throw new Error('Missing WebKit heap snapshot data');
    const text = heap.snapshotData, file = `${target}-heap.json`;
    write(join(out, file), text);
    result.snapshot = { file, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), summary: null };
    result.after = fence(await driver.evaluate(fenceExpression), target);
    if (result.after !== result.before) throw new Error('Template navigation changed during heap diagnostic');
    result.snapshot.summary = summarizeHeap(text);
  } catch (error) { result.errors.push(String(error)); }
  finally {
    try { await driver.send('Heap.disable'); } catch (error) { result.errors.push(`Heap.disable: ${String(error)}`); }
  }
  return result;
}
