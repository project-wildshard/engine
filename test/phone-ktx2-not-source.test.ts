// A phone samples a cooked image mount's KTX2 and never fetches the image itself (SF25 charges the load estimate so), so
// the phone's sets list the KTX2 alone. Images a reader fetches raw stay listed: the zone's own far impostor (the grid's
// far ring decodes the PNG), a glTF's textures (its loader fetches each URI) and every texture blob (UI and glTF readers
// fetch blob images as they are; a WebKit phone boot of Pine read 53 of them). The desktop keeps every image. The
// shard-size gate reads these lists: Pine's phone whole set listed 61.7 MB of images beside their KTX2 (engine@719ceebac).
// oxlint-disable-next-line import/no-nodejs-modules -- hashes for the made-up rows.
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll, expect, it} from 'vitest';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {loadBasisuAstc6} from '../src/cook/game/astc6Wasm';
import type {Astc6Encode} from '../src/cook/game/tierTextures';
import {gltfImageUrls, openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';
import {folderTarball} from '../src/cook/game/folderTarball';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const pageTable = (): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, slug: 'z', native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
const noise = (size: number, seed: number): Buffer => Buffer.from(Array.from({length: size * size * 3}, (_, at) => (at * 37 + seed * 101 + ((at / 3) | 0) % size * 3) & 255));

let encode: ImageKtx2Encode, astc6: Astc6Encode, jpg: Uint8Array, png: Uint8Array, other: Uint8Array;
beforeAll(async () => {
  [encode, astc6] = await Promise.all([loadBasisuImageKtx2(), loadBasisuAstc6()]);
  jpg = new Uint8Array(await sharp(noise(64, 1), {raw: {width: 64, height: 64, channels: 3}}).jpeg({quality: 90}).toBuffer());
  png = new Uint8Array(await sharp(noise(32, 2), {raw: {width: 32, height: 32, channels: 3}}).png().toBuffer());
  other = new Uint8Array(await sharp(noise(32, 4), {raw: {width: 32, height: 32, channels: 3}}).jpeg({quality: 90}).toBuffer());
}, 60_000);

it('names a glTF\'s image URIs against its own URL, never a data URI', () => {
  const gltf = new TextEncoder().encode(JSON.stringify({images: [{uri: 'textures/a%20b.jpg'}, {uri: 'data:image/png;base64,AA=='}, {bufferView: 0}]}));
  expect(gltfImageUrls('/assets/z/models/m/m.gltf', gltf)).toEqual(['/assets/z/models/m/textures/a b.jpg']);
  expect(gltfImageUrls('/assets/z/models/m/m.gltf', new TextEncoder().encode('not json'))).toEqual([]);
});

it('lists a cooked image mount as its KTX2 alone on a phone, and keeps what a reader fetches raw', () => {
  const held = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
  const mount = `/assets/${held.slug}/tex/made_up/diffuse.jpg`, discovery = pageTable();
  const far = `/assets/${held.slug}/baked/far-impostor.png`;
  const model = `/assets/${held.slug}/models/crate/crate.gltf`, modelTexture = `/assets/${held.slug}/models/crate/textures/crate_diff.jpg`;
  const gltf = new TextEncoder().encode(JSON.stringify({asset: {version: '2.0'}, images: [{uri: 'textures/crate_diff.jpg'}]}));
  const blobHash = digest(png), blobPath = `blobs/image/${blobHash}.png`, blobUrl = `/shardfiles/${held.slug}/${blobPath}`;
  const blob = {kind: 'image' as const, path: blobPath, hash: blobHash, compressed: png.length, decoded: 0, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false};
  const inputs: [string, Uint8Array][] = [[`/shardfiles/${held.slug}/discovery.json`, discovery], [mount, jpg], [far, png], [model, gltf], [modelTexture, other]];
  const reads = new Map<string, Uint8Array>([...inputs.map(([url, bytes]) => [`mounts${url}`, bytes] as [string, Uint8Array]), [blobPath, png]]);
  const fixture: OpenShardfile = {
    ...held, preparationOnly: false, index: {...held.index, files: [blob]},
    // a fence shard: its phone sets read the fenced blob and the model
    // (the fence recorded the glTF document alone: its texture rides with it)
    cook: {version: 3, renderer: blobHash, inputHash: blobHash, packs: 'fence', fence: [blobHash, digest(gltf)],
      programs: {version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]},
      mounts: inputs.map(([url, bytes]) => ({url, path: `mounts${url}`, hash: digest(bytes), bytes: bytes.length}))},
    read: path => reads.get(path) ?? held.read(path),
  };
  const half = shardHalf(fixture, (_url, bytes) => bytes.length, undefined, {phone: true, encode: astc6, images: encode});
  const phone = half.ktx2Table.phone;
  for (const source of [mount, far, modelTexture, blobUrl]) expect(phone[source]).toMatch(/\.t512-[a-f0-9]{8}\.ktx2$/u);
  const urls = (tier: 'phone' | 'desktop', set: 'entry' | 'whole'): string[] => [...half.folderRows(tier, set), ...half.mountRows(tier, set)].map(row => row.url.split('?')[0] ?? row.url);
  const phoneWhole = urls('phone', 'whole');
  expect(phoneWhole).toContain(phone[mount]);
  expect(phoneWhole).not.toContain(mount);
  expect(phoneWhole).toEqual(expect.arrayContaining([far, blobUrl]));
  expect(urls('desktop', 'whole')).toContain(mount);
  // a glTF's texture rides with its document
  expect(phoneWhole).toEqual(expect.arrayContaining([model, modelTexture]));
}, 60_000);
