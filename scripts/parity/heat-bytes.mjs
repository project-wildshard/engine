import { writeFileSync } from 'node:fs';
import { browserBakeBytes } from '../bake-output.mjs';

/** Consume optional native heat-image storage, returning only diagnostic rows.
 * @template {{heat:Blob|null}} T
 * @param {import('../bake-output.mjs').ByteSinkPage} page
 * @param {Pick<import('playwright').JSHandle<T>,'evaluate'|'dispose'>} handle
 * @param {string} [file]
 * @returns {Promise<Omit<T,'heat'>>} */
export async function readHeatFrame(page, handle, file) {
  try {
    const summary = await handle.evaluate(({ heat, ...metadata }) => {
      if (heat !== null && (!(heat instanceof Blob) || heat.type !== 'image/jpeg' || heat.size === 0))
        throw new Error('Invalid native heat image');
      return { bytes: heat?.size ?? 0, metadata };
    });
    if (file !== undefined && summary.bytes > 0) {
      const sink = await browserBakeBytes(page, { maxBytes: summary.bytes, maxFiles: 1 });
      try {
        await handle.evaluate(async ({ heat }, url) => {
          if (heat === null) throw new Error('Missing native heat image');
          const response = await fetch(url, { method: 'POST', body: heat });
          if (!response.ok) throw new Error('Native heat upload refused');
        }, `${sink.url}heat`);
        const bytes = sink.take('heat');
        if (bytes.byteLength !== summary.bytes) throw new Error('Incomplete native heat image');
        writeFileSync(file, bytes);
      } finally { await sink.dispose(); }
    }
    return summary.metadata;
  } finally { await handle.dispose(); }
}
