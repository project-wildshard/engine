// oxlint-disable-next-line import/no-nodejs-modules -- the vendored transcoder loads from disk.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the mounts carry their hashes.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- the vendored transcoder is CommonJS.
import {createRequire} from 'node:module';
import sharp from 'sharp';
import {beforeAll, describe, expect, it} from 'vitest';
import {desktopKtx2, heldMapRoles} from '../src/cook/game/cookedKtx2';
import {decodeWebp, loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {cookedKtx2TableOf, heldMapUrl} from '../src/shared/game/shardfile/cookedKtx2Table';
import {openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';
import {folderTarball} from '../src/cook/game/folderTarball';

// SF7h: a held view's rig maps (`heldView.ts` `loadMap`) are read unflipped as NoColorSpace data. Nine Dragon's SF7f board
// caught the cook flipping them and encoding the packed `maps` plane as colour (about 8 dB against the hand-made set): by
// URL, `arm-r-maps.webp` is an sRGB standalone image. The cook now takes their roles from the held document, and a cooked
// rig map must decode to its source, row for row, in a linear transfer.

interface Ktx2File {isValid(): boolean; startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(out: Uint8Array, level: number, layer: number, face: number, format: number, flags: number, channel0: number, channel1: number): number; close(): void; delete(): void}
interface Basis {initializeBasis(): void; KTX2File: new (bytes: Uint8Array) => Ktx2File; transcoder_texture_format: {cTFRGBA32: {value: number}}}

const SIZE = 64, BASE = '/assets/nine-dragon-stack/viewmodel/';
const enc = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
/** A held row as Nine's generator writes it (`src/generators/heldView.ts`), with one map name. */
const view = {
  rig: {url: 'rig.glb', skeleton: 'rig', sockets: ['grip'], joints: [], holdRight: [], holdLeft: [], walkRate: 1, lag: {max: 1, pitch: 1, yaw: 1}},
  blade: {socket: 'grip', base: 0, tip: 1},
  trail: {look: 'trail', seed: 'seed', samples: 1, subdivisions: 1, movementSq: 1, life: 1, total: 1, from: 0, order: 0},
  claw: 'claw', params: {}, meshes: [],
  maps: {base: BASE, names: ['arm-r'], kinds: {maps: 'uMapsTex', nrm: 'uNrmTex'}, anisotropy: 4},
  weave: {file: 'weave.bin', size: 1, param: 'weave'},
  decal: {files: {desktop: 'decal.png', phone: 'decal.png'}, param: 'decal'},
  back: [], additive: [], frame: [],
  pendants: {socket: 'grip', scene: {version: 1, root: 'root', nodes: [{kind: 'group', id: 'root'}], materials: []}, materials: [], geometry: []},
};
const index = {files: [
  {kind: 'json' as const, path: 'blobs/held.json', jsonSchema: {$comment: '@wildshard/format/heldJianDocument#HeldJianDocumentSchema'}},
  {kind: 'json' as const, path: 'blobs/other.json', jsonSchema: {$comment: '@wildshard/format/other#Other'}},
]};
/** Dark at the top row, light at the bottom, so a flip moves every row; red and green apart, so a swizzle shows. */
const source = (): Buffer => Buffer.from(Array.from({length: SIZE * SIZE * 4}, (_, at) => {
  const row = Math.floor(at / 4 / SIZE), channel = at % 4, value = Math.round((row / (SIZE - 1)) * 255);
  return channel === 0 ? value : channel === 1 ? 255 - value : channel === 2 ? 128 : 255;
}));
let encode: ImageKtx2Encode, basis: Basis, webp: Uint8Array, texels: Uint8Array;

beforeAll(async () => {
  encode = await loadBasisuImageKtx2();
  const factory = createRequire(import.meta.url)('../src/scripts/vendor/basisu/basis_encoder.cjs') as (options: object) => Promise<Basis>;
  basis = await factory({wasmBinary: new Uint8Array(readFileSync(new URL('../src/scripts/vendor/basisu/basis_encoder.wasm', import.meta.url))), print: () => undefined, printErr: () => undefined});
  basis.initializeBasis();
  webp = new Uint8Array(await sharp(source(), {raw: {width: SIZE, height: SIZE, channels: 4}}).webp({lossless: true}).toBuffer());
  texels = new Uint8Array(await sharp(webp).ensureAlpha().raw().toBuffer());
  // SF19: the cook decodes a WebP to a PNG of its pixels ahead of the synchronous encode.
  expect(await decodeWebp([webp])).toBe(true);
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
/** A KTX2's transfer function from its DFD: 1 linear, 2 sRGB. */
const transfer = (bytes: Uint8Array): number => bytes[new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(48, true) + 14] ?? 0;
/** The worst red or green gap between two RGBA images, texel for texel. */
const worst = (a: Uint8Array, b: Uint8Array): number => {
  let max = 0;
  for (let at = 0; at < a.length; at += 4) for (const channel of [0, 1]) max = Math.max(max, Math.abs((a[at + channel] ?? 0) - (b[at + channel] ?? 0)));
  return max;
};

describe('SF7h: the cook encodes held rig maps as data, right side up', () => {
  it('reads each held map URL and role from the held document only', () => {
    const roles = heldMapRoles(index, path => path === 'blobs/held.json' ? enc({view}) : enc({}));
    expect([...roles]).toEqual([[`${BASE}arm-r-maps.webp`, 'linear'], [`${BASE}arm-r-nrm.webp`, 'normal']]);
    expect(heldMapUrl({...view.maps, imageExtension: 'png'} as typeof view.maps, 'arm-r', 'nrm')).toBe(`${BASE}arm-r-nrm.png`);
  });

  it('decodes each cooked rig map to its source, unflipped and linear, desktop and phone alike', () => {
    const roles = heldMapRoles(index, path => path === 'blobs/held.json' ? enc({view}) : enc({}));
    const page = enc({version: 1, native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}});
    const urls = [...roles.keys()], phones = urls.map(url => url.replace(/\.webp$/u, '.phone.webp'));
    const cooked = desktopKtx2(page, [...[...roles].map(([url, heldMapRole]) => ({url, heldMapRole, read: () => webp})),
      ...phones.map(url => ({url, read: () => webp}))], encode);
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    for (const [at, url] of urls.entries()) {
      const file = cooked?.files.find(row => row.url === table.desktop[url]);
      expect(file, url).toBeDefined();
      expect(table.phone[phones[at] ?? '']).toBe(table.desktop[url]);
      const bytes = file?.bytes ?? new Uint8Array();
      expect(transfer(bytes), url).toBe(1);
      const rgba = decode(bytes);
      // Right side up: the top row is the source's dark row; the texels match the source within UASTC's error.
      expect(rgba[0], url).toBeLessThan(16);
      expect(rgba[(SIZE * (SIZE - 1)) * 4], url).toBeGreaterThan(239);
      expect(worst(rgba, texels), url).toBeLessThan(24);
    }
  }, 60_000);

  it('still cooks the same file by its URL alone flipped and sRGB, which is the bug the held roles stop', () => {
    const page = enc({version: 1, native: {}});
    // `hand-r-maps` (by URL an sRGB image; `arm-r-maps` reads as linear only because it starts `arm`)
    const url = `${BASE}hand-r-maps.webp`, cooked = desktopKtx2(page, [{url, read: () => webp}], encode);
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    const bytes = cooked?.files.find(row => row.url === table.desktop[url])?.bytes ?? new Uint8Array();
    expect(transfer(bytes)).toBe(2);
    expect(decode(bytes)[0]).toBeGreaterThan(200);
  }, 60_000);

  it('cooks a shardfile\'s held rig maps through shardHalf with the held document\'s roles, unflipped', () => {
    const shard = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
    const page = enc({version: 1, slug: 'z', native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}});
    const held = enc({view}), maps = `${BASE}arm-r-maps.webp`, nrm = `${BASE}arm-r-nrm.webp`, hand = `${BASE}hand-r-maps.webp`;
    const inputs = new Map([[`/shardfiles/${shard.slug}/discovery.json`, page], [maps, webp], [nrm, webp], [hand, webp], ['blobs/held.json', held]]);
    const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const mounts = [...inputs].filter(([url]) => url.startsWith('/')).map(([url, bytes]) => ({url, path: url, bytes: bytes.length, hash: hash(bytes)}));
    const heldRow = {kind: 'json' as const, path: 'blobs/held.json', hash: hash(held), compressed: held.length, decoded: held.length, gpu: 0, triangles: 0, draws: 0,
      dependencies: [], critical: false, jsonSchema: {$comment: '@wildshard/format/heldJianDocument#HeldJianDocumentSchema'}};
    const fixture: OpenShardfile = {...shard, preparationOnly: false, index: {...shard.index, files: [...shard.index.files, heldRow]} as OpenShardfile['index'],
      cook: {version: 1, mounts}, read: path => inputs.get(path) ?? shard.read(path)};
    const calls: {readonly role: string; readonly flip: boolean}[] = [], ours = hash(webp);
    shardHalf(fixture, (_url, bytes) => bytes.length, undefined, {images: (image, as) => {
      if (hash(image) === ours) calls.push(as);
      return encode(image, as);
    }});
    // The held document names arm-r only: its two planes cook as data and normal, unflipped; hand-r-maps, which no held
    // row names, is still a standalone colour image by its URL.
    expect(calls).toEqual([{role: 'linear', flip: false}, {role: 'normal', flip: false}, {role: 'srgb', flip: true}]);
  }, 60_000);
});
