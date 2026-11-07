import { writeFileSync } from 'node:fs';
import { browserBakeBytes } from '../bake-output.mjs';

/** Validate the native readback without serializing its pixel storage.
 * This function also runs inside the capture page, so it closes over no imports.
 * @template {{width:number,height:number,data:Uint8Array<ArrayBuffer>}} T
 * @param {T} frame */
export function frameSummary(frame) {
  const { data, ...metadata } = frame;
  const bytes = frame.width * frame.height * 4;
  if (!Number.isSafeInteger(frame.width) || frame.width < 1 || !Number.isSafeInteger(frame.height) || frame.height < 1
    || !Number.isSafeInteger(bytes) || !(data instanceof Uint8Array) || !(data.buffer instanceof ArrayBuffer) || data.byteLength !== bytes)
    throw new Error('Invalid native RGBA readback');
  return { bytes, metadata };
}

/** Consume one native readback handle. Only metadata crosses evaluate; raw
 * output uses an exactly bounded binary upload, with route/handle cleanup.
 * @template {{width:number,height:number,data:Uint8Array<ArrayBuffer>}} T
 * @param {import('../bake-output.mjs').ByteSinkPage} page
 * @param {Pick<import('playwright').JSHandle<T>,'evaluate'|'dispose'>} handle
 * @param {string} [file]
 * @param {(metadata:Omit<T,'data'>)=>void} [validate] Synchronous check before binary publication.
 * @returns {Promise<Omit<T,'data'>>} */
export async function readParityFrame(page, handle, file, validate) {
  try {
    /** @type {(frame:T)=>{bytes:number,metadata:Omit<T,'data'>}} */
    const summarize = frameSummary;
    const summary = await handle.evaluate(summarize);
    validate?.(summary.metadata);
    if (file !== undefined) {
      const sink = await browserBakeBytes(page, { maxBytes: summary.bytes, maxFiles: 1 });
      try {
        await handle.evaluate(async (frame, url) => {
          const response = await fetch(url, { method: 'POST', body: frame.data });
          if (!response.ok) throw new Error('Native readback upload refused');
        }, `${sink.url}frame`);
        const bytes = sink.take('frame');
        if (bytes.byteLength !== summary.bytes) throw new Error('Incomplete native RGBA readback');
        writeFileSync(file, bytes);
      } finally { await sink.dispose(); }
    }
    return summary.metadata;
  } finally { await handle.dispose(); }
}
