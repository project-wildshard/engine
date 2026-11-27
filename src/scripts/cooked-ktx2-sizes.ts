/** SF20 (J525): the byte size of the KTX2 the cook makes of every image in a built product, for its tile budget
 * (`tile-bakes.mjs`). Each standalone PNG or JPEG file and each PNG or JPEG a GLB holds, on the 4x4 block grid, is encoded
 * with the cook's own encoder (`wasmImageKtx2`, its worker lanes and its cache by input hash, so a rebuild encodes only
 * what changed) at its colour settings; the normal and linear encodes of the same texels differ by a few percent.
 *
 *   node --import <engine>/src/scripts/bake-loader.mjs <engine>/src/scripts/cooked-ktx2-sizes.ts <product folder>
 *
 * Prints one JSON object: the sha256 of each image's bytes to its cooked KTX2's byte length. */
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {existsSync, readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {homedir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- a Node script.
import {join, resolve} from 'node:path';
import {imageHead, wasmImageKtx2} from '../cook/game/imageKtx2Wasm.ts';
import {glbImages} from '../cook/game/tierTextures.ts';

const folder = process.argv[2];
if (folder === undefined) throw new Error('usage: cooked-ktx2-sizes.ts <product folder>');
// oxlint-disable-next-line node/no-process-env -- the cook's image cache, shared with every local cook.
const cacheDir = process.env.WILDSHARD_IMAGE_KTX2_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/image-ktx2-wasm/1');
const index = JSON.parse(readFileSync(join(folder, 'shard.json'), 'utf8')) as {files: {kind?: string; path?: string}[]};
const images: Uint8Array[] = [];
const onGrid = (bytes: Uint8Array): boolean => { const head = imageHead(bytes); return head !== undefined && head.width % 4 === 0 && head.height % 4 === 0; };
for (const file of index.files) {
  if ((file.kind !== 'image' && file.kind !== 'glb') || file.path === undefined || !existsSync(join(folder, file.path))) continue;
  const bytes = new Uint8Array(readFileSync(join(folder, file.path)));
  const found = file.kind === 'image' ? [bytes] : glbImages(bytes).filter(image => image.mimeType === 'image/png' || image.mimeType === 'image/jpeg').map(image => image.bytes);
  images.push(...found.filter(onGrid));
}
const as = {role: 'srgb', flip: false} as const, encoder = await wasmImageKtx2({cacheDir});
for (const image of images) encoder.record(image, as);
await encoder.flush();
const sizes: Record<string, number> = {};
for (const image of images) {
  const out = encoder.encode(image, as);
  if (out !== undefined) sizes[createHash('sha256').update(image).digest('hex')] = out.length;
}
process.stdout.write(`${JSON.stringify(sizes)}\n`);
