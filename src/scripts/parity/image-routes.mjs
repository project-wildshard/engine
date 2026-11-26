import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

/** Borrow immutable screenshot bytes until the compositor releases its routes.
 * @param {Pick<import('playwright').Page,'route'|'unroute'>} page
 * @param {readonly Uint8Array[]} images */
export function jpegImageRoutes(page, images) {
  /** @type {{bytes:Uint8Array,mime:'image/jpeg'}[]} */
  const encoded = images.map(bytes => ({ bytes, mime: 'image/jpeg' }));
  return imageRoutes(page, encoded);
}

/** Borrow original PNG/JPEG bytes for a mixed-image compositor.
 * @param {Pick<import('playwright').Page,'route'|'unroute'>} page
 * @param {readonly {bytes:Uint8Array,mime:'image/png'|'image/jpeg'}[]} images */
export async function imageRoutes(page, images) {
  const url = `https://board-images.invalid/${randomUUID()}/`, pattern = `${url}*`;
  const inputs = new Map(images.map(({ bytes, mime }, index) => [String(index), { bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), mime }]));
  /** @param {import('playwright').Route} route */
  const read = async route => {
    const request = route.request(), image = request.method() === 'GET' ? inputs.get(request.url().slice(url.length)) : undefined;
    await route.fulfill({ status: image === undefined ? 404 : 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': image?.mime ?? 'image/jpeg' },
      body: image?.bytes ?? 'Missing board image' });
  };
  await page.route(pattern, read);
  return { urls: images.map((_bytes, index) => `${url}${index}`),
    async dispose() { inputs.clear(); await page.unroute(pattern, read); } };
}
