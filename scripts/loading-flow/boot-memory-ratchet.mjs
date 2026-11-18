// Mini QA 2026-11-17 row 19 (mini-boot99): Jake's iPhone 17 Pro lost Nine's page at boot (iOS took it back at ~2 GB).
// Two cuts brought the boot down; this ratchet keeps them, blocking in ci.yml's Nine load (nine-load.mjs), beside
// MEMORY-GATES MG1's peak probe (scripts/boot-memory-peak.mjs, J408), which reads the peak and stays its own lane's.
//
// 1. No spawn part is held in memory past the download step: the store's checked copy serves a later read
//    (`download:members-dropped`'s `held`, spawnDownload.ts, engine 653c748c).
// 2. CPU geometry buffers still reachable from the scene at control stay under the
//    measured 53 MB plus 10%. The old release volume is telemetry: df9005b4 frees
//    slab buffers on upload, before the staged release marks.
// 3. The page's live JS heap (collected) at control stays under its measured value plus a margin: 367 MB before the
//    two cuts, 289.5 MB after (two runs within 0.1 MB). The margins are wider than the mini's spread because the hosted
//    runner draws on SwiftShader (no multi-draw, so Nine's slabs are not merged there); tighten them from its receipts
//    (load.json's `memory`).

export const NINE_RETAINED_GEOMETRY_CEILING_BYTES = 58.3e6;
/** the live heap ceiling at control (used + ArrayBuffer backing, after a full collection): 289.5 MB measured, plus 17% */
export const NINE_LIVE_CEILING_BYTES = 340e6;

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
 * @param {readonly {operation: string, detail: Record<string, unknown>}[]} marks
 * @param {number | null} retained
 * @param {number} liveBytes
 * @param {{retainedCeiling?: number, liveCeiling?: number}} [limits]
 */
export function bootMemoryVerdict(marks, retained, liveBytes, limits = {}) {
  const retainedCeiling = limits.retainedCeiling ?? NINE_RETAINED_GEOMETRY_CEILING_BYTES;
  const liveCeiling = limits.liveCeiling ?? NINE_LIVE_CEILING_BYTES;
  /** @type {string[]} */ const faults = [];
  const dropped = marks.find(row => row.operation === 'download:members-dropped');
  const held = typeof dropped?.detail.held === 'number' ? dropped.detail.held : null;
  if (held === null) faults.push('boot memory: no download:members-dropped mark with its held count');
  else if (held > 0) faults.push(`boot memory: ${String(held)} spawn parts still held past the download step`);
  const released = marks.filter(row => row.operation === 'memory:geometry-released')
    .reduce((sum, row) => sum + (typeof row.detail.bytes === 'number' ? row.detail.bytes : 0), 0);
  if (retained === null || !Number.isFinite(retained) || retained < 0) faults.push('boot memory: no retained CPU geometry measurement at control');
  else if (retained > retainedCeiling) faults.push(`boot memory: retained CPU geometry ${(retained / 1e6).toFixed(1)} MB at control, over the ${(retainedCeiling / 1e6).toFixed(1)} MB ceiling`);
  if (!(liveBytes <= liveCeiling)) faults.push(`boot memory: live heap ${(liveBytes / 1e6).toFixed(0)} MB at control, over the ${(liveCeiling / 1e6).toFixed(0)} MB ceiling`);
  return { held, released, retained, live: liveBytes, faults };
}

/** The page's live heap after a full collection (Chromium CDP), used + ArrayBuffer backing.
 * @param {{send: (method: string, params?: object) => Promise<any>}} session */
export async function liveHeapBytes(session) {
  await session.send('HeapProfiler.collectGarbage');
  const usage = await session.send('Runtime.getHeapUsage');
  return Number(usage.usedSize ?? 0) + Number(usage.backingStorageSize ?? 0);
}
