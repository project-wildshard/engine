// oxlint-disable-next-line import/no-nodejs-modules -- the vendored transcoder loads from disk.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the vendored transcoder is CommonJS.
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {desktopKtx2, flipsImage} from '../src/cook/game/cookedKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';

// SF17 follow-up: a creature coat is its rig's skin map, drawn in the rig map's glTF orientation (riggedHulls.ts: flipY false), and
// the hand-made coat bake encoded it unflipped. Nalati's board (SF6f) caught the cook flipping every coat: decoded, the
// cooked file matched the source only upside down. A coat's cooked KTX2 must decode to the image as it is.

interface Ktx2File {isValid(): boolean; startTranscoding(): boolean; getImageLevelInfo(level: number, layer: number, face: number): {origWidth: number; origHeight: number};
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(out: Uint8Array, level: number, layer: number, face: number, format: number, flags: number, channel0: number, channel1: number): number; close(): void; delete(): void}
interface Basis {initializeBasis(): void; KTX2File: new (bytes: Uint8Array) => Ktx2File; transcoder_texture_format: {cTFRGBA32: {value: number}}}

const SIZE = 64;
/** Dark at the top row, light at the bottom, so a flip moves every row. */
const gradient = (): Buffer => Buffer.from(Array.from({length: SIZE * SIZE * 3}, (_, at) => Math.round((Math.floor(at / 3 / SIZE) / (SIZE - 1)) * 255)));
let encode: ImageKtx2Encode, basis: Basis, coat: Uint8Array;

beforeAll(async () => {
  encode = await loadBasisuImageKtx2();
  const factory = createRequire(import.meta.url)('../src/scripts/vendor/basisu/basis_encoder.cjs') as (options: object) => Promise<Basis>;
  basis = await factory({wasmBinary: new Uint8Array(readFileSync(new URL('../src/scripts/vendor/basisu/basis_encoder.wasm', import.meta.url))), print: () => undefined, printErr: () => undefined});
  basis.initializeBasis();
  coat = new Uint8Array(await sharp(gradient(), {raw: {width: SIZE, height: SIZE, channels: 3}}).png().toBuffer());
}, 60_000);

/** The KTX2's top level as RGBA, as a GPU samples it. */
function decode(bytes: Uint8Array): Uint8Array {
  const file = new basis.KTX2File(bytes), format = basis.transcoder_texture_format.cTFRGBA32.value;
  try {
    expect(Boolean(file.isValid()) && Boolean(file.startTranscoding())).toBe(true);
    const out = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, format));
    expect(file.transcodeImage(out, 0, 0, 0, format, 0, -1, -1)).not.toBe(0);
    return out;
  } finally { file.close(); file.delete(); }
}
/** The mean red of a row of RGBA texels. */
const rowMean = (rgba: Uint8Array, row: number): number => { let sum = 0; for (let x = 0; x < SIZE; x++) sum += rgba[(row * SIZE + x) * 4] ?? 0; return sum / SIZE; };

describe('SF17: a creature coat keeps its orientation through the cook', () => {
  it('never flips a coat, desktop or phone copy, and still flips a standalone ground texture', () => {
    expect(flipsImage('/assets/z/models/coats/wolf.wolf.dark.coat.png', new Set())).toBe(false);
    expect(flipsImage('/assets/z/models/coats/horse-wild.horse.bay.coat.phone.webp', new Set())).toBe(false);
    expect(flipsImage('/assets/z/tex/meadow.webp', new Set())).toBe(true);
  });

  it('decodes the cooked coat to the PNG as it is, top row dark and bottom row light', () => {
    const url = '/assets/z/models/coats/wolf.wolf.dark.coat.png';
    const page = new TextEncoder().encode(JSON.stringify({version: 1, native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
    const cooked = desktopKtx2(page, [{url, read: () => coat}], encode);
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    const file = cooked?.files.find(row => row.url === table.desktop[url]);
    expect(file).toBeDefined();
    const rgba = decode(file?.bytes ?? new Uint8Array());
    expect(rowMean(rgba, 0)).toBeLessThan(16);
    expect(rowMean(rgba, SIZE - 1)).toBeGreaterThan(239);
  }, 60_000);
});
