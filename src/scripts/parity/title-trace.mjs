import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export const TITLE_TRACE_MAX_RAW_BYTES = 32 * 1024 * 1024;
export const TITLE_TRACE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const TITLE_TRACE_CATEGORIES = Object.freeze([
  'gpu', 'cc', 'viz', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
]);

/** @type {import('./title-trace.mjs').OpenTitleTrace} */
const openTitleTrace = page => {
  const browser = page.context().browser();
  if (browser === null || browser.browserType().name() !== 'chromium') return null;
  return { start: (target, options) => browser.startTracing(target, options), stop: () => browser.stopTracing() };
};

/** Observe only the existing title capture. Trace failures never replace its result.
 * The public API returns a complete trace buffer; bound retained raw and compressed bytes,
 * and report an oversized trace as unavailable rather than silently trimming evidence.
 * @template T @param {import('playwright').Page} page @param {string} prefix
 * @param {()=>Promise<T>} capture @param {import('./title-trace.mjs').OpenTitleTrace} [open]
 * @param {import('./title-trace.mjs').TitleTraceWriter} [write]
 * @returns {Promise<T>} */
export async function observeTitleCapture(page, prefix, capture, open = openTitleTrace, write = writeFileSync) {
  const startedAt = Date.now();
  /** @type {import('./title-trace.mjs').TitleTracePort|null} */ let port = null;
  let started = false, state = 'unavailable', message = '', rawBytes = 0, compressedBytes = 0;
  const path = `${prefix}-chromium.json.gz`, receipt = `${prefix}-chromium.meta.json`;
  try {
    port = open(page);
    if (port !== null) {
      await port.start(page, { categories: [...TITLE_TRACE_CATEGORIES], screenshots: false });
      started = true;
    } else message = 'Chromium tracing is unavailable for this browser';
  } catch (error) { message = String(error); }
  const captureStartedAt = Date.now();
  try { return await capture(); }
  finally {
    const captureEndedAt = Date.now();
    if (started && port !== null) {
      try {
        const bytes = await port.stop(); rawBytes = bytes.byteLength;
        if (rawBytes > TITLE_TRACE_MAX_RAW_BYTES) state = 'oversize';
        else {
          const packed = gzipSync(bytes, { level: 1 }); compressedBytes = packed.byteLength;
          if (compressedBytes > TITLE_TRACE_MAX_COMPRESSED_BYTES) state = 'oversize';
          else { write(path, packed); state = 'retained'; }
        }
      } catch (error) { message = String(error); }
    }
    const observation = { state, message, startedAt, captureStartedAt, captureEndedAt, stoppedAt: Date.now(),
      maxRawBytes: TITLE_TRACE_MAX_RAW_BYTES, maxCompressedBytes: TITLE_TRACE_MAX_COMPRESSED_BYTES,
      rawBytes, compressedBytes, categories: TITLE_TRACE_CATEGORIES,
      path: state === 'retained' ? path : null };
    try { write(receipt, `${JSON.stringify(observation, null, 2)}\n`); }
    catch (error) { console.log(`boot-title-trace receipt unavailable: ${String(error)}`); }
    console.log(`boot-title-trace ${JSON.stringify(observation)}`);
  }
}
