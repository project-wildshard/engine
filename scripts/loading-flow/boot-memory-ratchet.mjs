// Mini QA 2026-11-17 row 19 (mini-boot99): Jake's iPhone 17 Pro lost Nine's page at boot (iOS took it back at ~2 GB).
// Two cuts brought the boot down; this ratchet keeps them, blocking in ci.yml's Nine load (nine-load.mjs), beside
// MEMORY-GATES MG1's peak probe (scripts/boot-memory-peak.mjs, J408), which reads the peak and stays its own lane's.
//
// 1. No spawn part is held in memory past the download step: the store's checked copy serves a later read
//    (`download:members-dropped`'s `held`, spawnDownload.ts, engine 653c748c).
// 2. The boot lets the CPU copies of the geometry it drew go (`memory:geometry-released`, memorySaver.ts
//    `releaseDrawnGeometry`): this load released 77.6 MB on the mini (Chromium, Metal, two runs alike) where it
//    released none before.
// 3. The page's live JS heap (collected) at control stays under its measured value plus a margin: 367 MB before the
//    two cuts, 289.5 MB after (two runs within 0.1 MB). The margins are wider than the mini's spread because the hosted
//    runner draws on SwiftShader (no multi-draw, so Nine's slabs are not merged there); tighten them from its receipts
//    (load.json's `memory`).

/** the drawn geometry the boot must let go: 77.6 MB measured, less 35% */
export const NINE_RELEASED_FLOOR_BYTES = 50e6;
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

/**
 * @param {readonly {operation: string, detail: Record<string, unknown>}[]} marks
 * @param {number} liveBytes
 * @param {{releasedFloor?: number, liveCeiling?: number}} [limits]
 */
export function bootMemoryVerdict(marks, liveBytes, limits = {}) {
  const releasedFloor = limits.releasedFloor ?? NINE_RELEASED_FLOOR_BYTES, liveCeiling = limits.liveCeiling ?? NINE_LIVE_CEILING_BYTES;
  /** @type {string[]} */ const faults = [];
  const dropped = marks.find(row => row.operation === 'download:members-dropped');
  const held = typeof dropped?.detail['held'] === 'number' ? dropped.detail['held'] : null;
  if (held === null) faults.push('boot memory: no download:members-dropped mark with its held count');
  else if (held > 0) faults.push(`boot memory: ${String(held)} spawn parts still held past the download step`);
  const released = marks.filter(row => row.operation === 'memory:geometry-released')
    .reduce((sum, row) => sum + (typeof row.detail['bytes'] === 'number' ? row.detail['bytes'] : 0), 0);
  if (released < releasedFloor) faults.push(`boot memory: released ${(released / 1e6).toFixed(1)} MB of drawn geometry, under the ${(releasedFloor / 1e6).toFixed(0)} MB floor`);
  if (!(liveBytes <= liveCeiling)) faults.push(`boot memory: live heap ${(liveBytes / 1e6).toFixed(0)} MB at control, over the ${(liveCeiling / 1e6).toFixed(0)} MB ceiling`);
  return { held, released, live: liveBytes, faults };
}

/** The page's live heap after a full collection (Chromium CDP), used + ArrayBuffer backing.
 * @param {{send: (method: string, params?: object) => Promise<any>}} session */
export async function liveHeapBytes(session) {
  await session.send('HeapProfiler.collectGarbage');
  const usage = await session.send('Runtime.getHeapUsage');
  return Number(usage.usedSize ?? 0) + Number(usage.backingStorageSize ?? 0);
}
