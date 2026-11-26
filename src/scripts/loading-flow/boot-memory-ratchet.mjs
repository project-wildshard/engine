// Mini QA 2026-11-17 row 19 (mini-boot99): Jake's iPhone 17 Pro lost Nine's page at boot (iOS took it back at ~2 GB).
// Two cuts brought the boot down; this ratchet keeps them, blocking in ci.yml's Nine load (nine-load.mjs), beside
// MEMORY-GATES MG1's peak probe (src/scripts/boot-memory-peak.mjs, J408), which reads the peak and stays its own lane's.
//
// 1. No spawn part is held in memory past the download step: the store's checked copy serves a later read
//    (`download:members-dropped`'s `held`, spawnDownload.ts, engine 653c748c).
// 2. CPU geometry buffers still reachable from the scene at control, and 3. the page's live JS heap (collected) at
//    control, are judged through the budget verdict (BUDGET-CAPS BC11, J444): nine/boot/retained-geometry and
//    nine/boot/live-heap in budgets/baselines.json, measured on Nine's pinned revision, soft line baseline + 10%. The
//    old hand ceilings were 58.3 MB (53 MB + 10%) and 340 MB (289.5 MB + 17%); hosted reads 13.3 MB and 217 MB.
//    A regression is not a fault here: nine-load.mjs writes the rows to budget-measures.json, which the budgets
//    workflow judges after ci (a fix row for the pusher, never a red ci). A new Nine revision is new content.
import { judgeReads } from '../memory/ledgerVerdict.mjs';

export const NINE_BOOT_KEYS = Object.freeze({ retained: 'nine/boot/retained-geometry', live: 'nine/boot/live-heap' });

/** Browser-side: the boot timeline's memory marks with their detail. */
export function bootMemoryMarks() {
  const timing = Reflect.get(globalThis, '__bootTiming'), read = timing === undefined ? undefined : Reflect.get(timing, 'read');
  const data = typeof read === 'function' ? read.call(timing) : timing;
  const entries = data === undefined || data === null ? [] : Reflect.get(data, 'entries');
  return Array.isArray(entries) ? entries.filter(row => row.operation === 'download:members-dropped' || row.operation === 'memory:geometry-released')
    .map(row => ({ operation: String(row.operation), detail: { ...row.detail } })) : [];
}

/** Browser-side: CPU geometry backing stores still reachable from the rendered scene.
 * @param {import('three').Object3D | null} [scene] */
export function retainedGeometryBytes(scene = window.__wildshard?.world?.game.rootScene) {
  if (scene === undefined || scene === null) return null;
  /** @type {Set<ArrayBufferLike>} */ const buffers = new Set();
  /** @param {object | null | undefined} attribute */
  const add = (attribute) => {
    if (attribute === undefined || attribute === null) return;
    const storage = Object.getOwnPropertyDescriptor(attribute, 'data')?.value ?? attribute;
    // An array accessor would read released bytes back from the GPU.
    const array = Object.getOwnPropertyDescriptor(storage, 'array')?.value;
    if (ArrayBuffer.isView(array) && array.buffer.byteLength > 0) buffers.add(array.buffer);
  };
  scene.traverse((node) => {
    const {geometry, instanceMatrix, instanceColor} = /** @type {Partial<import('three').InstancedMesh>} */ (node);
    if (geometry !== undefined) {
      Object.values(geometry.attributes).forEach(add);
      for (const attributes of Object.values(geometry.morphAttributes)) attributes.forEach(add);
      add(geometry.index);
    }
    add(instanceMatrix);
    add(instanceColor);
  });
  return buffers.size === 0 ? null : [...buffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
}

/**
 * The boot's faults and its two budget rows. Held parts and a missing measurement are faults (they fail the load); a
 * measurement's verdict is a row (`over-hard` is a fault too, `regressed` is the budgets job's).
 * @param {readonly {operation: string, detail: Record<string, unknown>}[]} marks
 * @param {number | null} retained
 * @param {number} liveBytes
 * @param {{ contentKey: string, budgets: Parameters<typeof judgeReads>[0] }} judging
 */
export function bootMemoryVerdict(marks, retained, liveBytes, { contentKey, budgets }) {
  /** @type {string[]} */ const faults = [];
  const dropped = marks.find(row => row.operation === 'download:members-dropped');
  const held = typeof dropped?.detail.held === 'number' ? dropped.detail.held : null;
  if (held === null) faults.push('boot memory: no download:members-dropped mark with its held count');
  else if (held > 0) faults.push(`boot memory: ${String(held)} spawn parts still held past the download step`);
  const released = marks.filter(row => row.operation === 'memory:geometry-released')
    .reduce((sum, row) => sum + (typeof row.detail.bytes === 'number' ? row.detail.bytes : 0), 0);
  const rows = [];
  if (retained === null || !Number.isFinite(retained) || retained < 0) faults.push('boot memory: no retained CPU geometry measurement at control');
  else rows.push(judgeReads(budgets, NINE_BOOT_KEYS.retained, [retained], contentKey));
  if (!Number.isFinite(liveBytes) || liveBytes < 0) faults.push('boot memory: no live heap measurement at control');
  else rows.push(judgeReads(budgets, NINE_BOOT_KEYS.live, [liveBytes], contentKey));
  for (const row of rows) if (row.status === 'over-hard') faults.push(`boot memory: ${row.key} ${(row.value / 1e6).toFixed(1)} MB at control, over its ${(Number(row.hard) / 1e6).toFixed(1)} MB hard cap`);
  return { held, released, retained, live: liveBytes, faults, rows };
}

/** The page's live heap after a full collection (Chromium CDP), used + ArrayBuffer backing.
 * @param {{send: (method: string, params?: object) => Promise<any>}} session */
export async function liveHeapBytes(session) {
  await session.send('HeapProfiler.collectGarbage');
  const usage = await session.send('Runtime.getHeapUsage');
  return Number(usage.usedSize ?? 0) + Number(usage.backingStorageSize ?? 0);
}
