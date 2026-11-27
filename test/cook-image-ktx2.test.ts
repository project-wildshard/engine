// SF15 (J525): the cook makes every KTX2 from the shardfile's own images. A JPG or PNG mount comes out as a desktop UASTC
// KTX2 (sRGB colour, linear normal and roughness), its phone file as ASTC 6x6 cooked from that, a ground layer with its
// unflipped `#layer` twin, and every one of them named in the discovery document's KTX2 table, the table the cooked index
// carries (`cookedKtx2TableOf`). A mount marked `keepImage` and a source the table already names are left as they are.
// oxlint-disable-next-line import/no-nodejs-modules -- the fixture product is a copy of a pinned one on disk.
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the fixture product is a copy of a pinned one on disk.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- the fixture product is a copy of a pinned one on disk.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- the fixture product is a copy of a pinned one on disk.
import {dirname, join} from 'node:path';
import sharp from 'sharp';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {desktopKtx2, flipsImage, roleOfImage, type CookImageMount} from '../src/cook/game/cookedKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {loadBasisuAstc6} from '../src/cook/game/astc6Wasm';
import {isKtx2, ktx2Info, phoneTier, phoneTierSize, type Astc6Encode} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';
import {openShardfile, shardHalf, type OpenShardfile} from '../src/cook/game/shardCook';
import {folderTarball} from '../src/cook/game/folderTarball';
import {mkdirSync} from 'node:fs';

const ASTC_6X6 = new Set([165, 166]);
/** The phone trim at a test's size: small images keep CI's file under its 60 s budget (J295). */
const small = (source: string): number | undefined => (phoneTierSize(source) === undefined ? undefined : 64);
/** The KTX2's DFD transfer function: 2 is sRGB, 1 linear. */
const transfer = (bytes: Uint8Array): number => { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return bytes[view.getUint32(48, true) + 14] ?? 0; };
const pageTable = (): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, slug: 'z', native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
const noise = (size: number, seed: number): Buffer => Buffer.from(Array.from({length: size * size * 3}, (_, at) => (at * 37 + seed * 101 + ((at / 3) | 0) % size * 3) & 255));

let encode: ImageKtx2Encode, astc6: Astc6Encode, jpg: Uint8Array, png: Uint8Array, odd: Uint8Array;
beforeAll(async () => {
  [encode, astc6] = await Promise.all([loadBasisuImageKtx2(), loadBasisuAstc6()]);
  jpg = new Uint8Array(await sharp(noise(128, 1), {raw: {width: 128, height: 128, channels: 3}}).jpeg({quality: 90}).toBuffer());
  png = new Uint8Array(await sharp(noise(64, 2), {raw: {width: 64, height: 64, channels: 3}}).png().toBuffer());
  odd = new Uint8Array(await sharp(noise(30, 3), {raw: {width: 30, height: 30, channels: 3}}).png().toBuffer());
}, 60_000);

it('lists a fetched phone texture blob once and still carries a texture outside the fence', () => {
  const held = openShardfile(folderTarball('test/fixtures/corpus/brasscap-mesa'), {preparationOnly: true});
  const discovery = pageTable(), discoveryPath = 'mounts/discovery.json';
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const blob = (bytes: Uint8Array, suffix: string) => {
    const hash = digest(bytes), path = `blobs/image/${hash}.${suffix}`;
    return {kind: 'image' as const, path, hash, compressed: bytes.length, decoded: 0, gpu: 0,
      triangles: 0, draws: 0, dependencies: [], critical: false};
  };
  const inside = blob(png, 'png'), outside = blob(jpg, 'jpg');
  const reads = new Map([[discoveryPath, discovery], [inside.path, png], [outside.path, jpg]]);
  const fixture: OpenShardfile = {
    ...held, preparationOnly: false, index: {...held.index, files: [inside, outside]},
    cook: {version: 3, renderer: inside.hash, inputHash: inside.hash, packs: 'fence',
      fence: [inside.hash], programs: {version: 2, lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]},
      mounts: [{url: `/shardfiles/${held.slug}/discovery.json`, path: discoveryPath, hash: digest(discovery), bytes: discovery.length}]},
    read: path => reads.get(path) ?? held.read(path),
  };
  const half = shardHalf(fixture, (_url, bytes) => bytes.length, undefined, {phone: true, encode: astc6, images: encode});
  const insideUrl = half.ktx2Table.phone[`/shardfiles/${held.slug}/${inside.path}`];
  const outsideUrl = half.ktx2Table.phone[`/shardfiles/${held.slug}/${outside.path}`];
  expect(insideUrl).toMatch(/\.t512-[a-f0-9]{8}\.ktx2$/u);
  expect(outsideUrl).toMatch(/\.t512-[a-f0-9]{8}\.ktx2$/u);
  const urls = (set: 'entry' | 'whole'): readonly string[] => half.mountRows('phone', set).map(row => row.url);
  expect(urls('entry')).toContain(insideUrl);
  expect(urls('entry')).not.toContain(outsideUrl);
  expect(urls('whole').filter(url => url === insideUrl)).toHaveLength(1);
  expect(urls('whole')).toContain(outsideUrl);
});

describe('SF15: the encode per map kind', () => {
  it('reads colour as sRGB, normal maps and numeric planes as linear, by the hand-made sets\' names', () => {
    expect(roleOfImage('/assets/z/tex/leafy_grass/diffuse.jpg')).toBe('srgb');
    expect(roleOfImage('/assets/z/tex/leafy_grass/nor_gl.jpg')).toBe('normal');
    expect(roleOfImage('/assets/z/tex/leafy_grass/arm.jpg')).toBe('linear');
    expect(roleOfImage('/assets/z/props/rock_rough_2k.png')).toBe('linear');
    expect(roleOfImage('/assets/z/island/lm_beach.jpg')).toBe('linear');
  });

  it('flips a standalone image but not a glTF\'s own texture or a lightmap', () => {
    const gltf = new Set(['/assets/z/models/stump']);
    expect(flipsImage('/assets/z/tex/leafy_grass/diffuse.jpg', gltf)).toBe(true);
    expect(flipsImage('/assets/z/models/stump/textures/stump_diff.jpg', gltf)).toBe(false);
    expect(flipsImage('/assets/z/island/lm_beach.jpg', gltf)).toBe(false);
  });

  it('encodes a JPG and a PNG as UASTC with a full mip chain, sRGB for colour and linear for a normal map', () => {
    const colour = encode(jpg, {role: 'srgb', flip: true}), normal = encode(png, {role: 'normal', flip: false});
    expect(colour !== undefined && isKtx2(colour)).toBe(true);
    expect(ktx2Info(colour ?? new Uint8Array())).toMatchObject({vkFormat: 0, width: 128, height: 128, levels: 8});
    expect(transfer(colour ?? new Uint8Array())).toBe(2);
    expect(ktx2Info(normal ?? new Uint8Array())).toMatchObject({vkFormat: 0, width: 64, height: 64, levels: 7});
    expect(transfer(normal ?? new Uint8Array())).toBe(1);
  }, 60_000);
});

describe('SF15: the desktop KTX2 and its table rows', () => {
  it('names a ground layer\'s KTX2 and #layer twin per tier, and the phone\'s ASTC 6x6 made from them', () => {
    const files = new Map<string, Uint8Array>([
      ['/assets/z/tex/leafy_grass/diffuse.jpg', jpg], ['/assets/z/sky/day.png', png], ['/assets/z/ui/badge.png', png], ['/assets/z/odd.png', odd],
    ]);
    const mounts: CookImageMount[] = [...files].map(([url, bytes]) => ({url, read: () => bytes, ...(url.includes('/ui/') ? {keepImage: true} : {})}));
    const cooked = desktopKtx2(pageTable(), mounts, encode);
    expect(cooked).toBeDefined();
    const made = new Map(cooked?.files.map(file => [file.url, file.bytes]));
    let table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
    expect(Object.keys(table.desktop).sort()).toEqual(['/assets/z/sky/day.png', '/assets/z/tex/leafy_grass/diffuse.jpg', '/assets/z/tex/leafy_grass/diffuse.jpg#layer']);
    const layer = made.get(table.desktop['/assets/z/tex/leafy_grass/diffuse.jpg#layer'] ?? '');
    expect(ktx2Info(layer ?? new Uint8Array())).toMatchObject({vkFormat: 0, width: 128, levels: 8});
    expect(table.desktop['/assets/z/tex/leafy_grass/diffuse.jpg']).toMatch(/^\/assets\/z\/tex\/leafy_grass\/diffuse-[a-f0-9]{8}\.ktx2$/u);
    // The phone tier: each row's 6x6 file, cooked from the desktop file (S12c), trimmed (to 64 here, 512 in a cook) but a #layer twin and a sky kept whole.
    const phone = phoneTier(cooked?.discovery ?? new Uint8Array(), url => made.get(url) ?? files.get(url), small, astc6);
    expect(phone).toBeDefined();
    const phoneMade = new Map([...phone?.files.values() ?? []].flat().map(file => [file.url, file.bytes]));
    table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(phone?.discovery)));
    const ground = phoneMade.get(table.phone['/assets/z/tex/leafy_grass/diffuse.jpg'] ?? '') ?? new Uint8Array();
    expect(ASTC_6X6.has(ktx2Info(ground).vkFormat)).toBe(true);
    expect(ktx2Info(ground).width).toBe(64);
    const twin = phoneMade.get(table.phone['/assets/z/tex/leafy_grass/diffuse.jpg#layer'] ?? '') ?? new Uint8Array();
    expect(ktx2Info(twin)).toMatchObject({width: 128});
    expect(ASTC_6X6.has(ktx2Info(twin).vkFormat)).toBe(true);
    // The UI badge stays an image, and an image off the 4x4 grid too.
    expect(table.desktop['/assets/z/ui/badge.png']).toBeUndefined();
    expect(table.desktop['/assets/z/odd.png']).toBeUndefined();
  }, 120_000);

  it('keeps a row the shard\'s own table already has, and makes nothing when nothing is encoded', () => {
    const own = new TextEncoder().encode(JSON.stringify({version: 1, native: {ktx2: {GPU_FILES: {phone: {}, desktop: {'/assets/z/a.png': '/assets/gpu/z/a-00000000.ktx2'}}}}}));
    expect(desktopKtx2(own, [{url: '/assets/z/a.png', read: () => png}], encode)).toBeUndefined();
    expect(desktopKtx2(pageTable(), [{url: '/assets/z/a.m4a', read: () => png}], encode)).toBeUndefined();
  });
});

// The whole cook path: a pinned product with a ground layer and a sky added as mounts, through `shardHalf` with the tiers on.
const PINNED = 'out/open-plot-alien-plain';
describe.skipIf(!existsSync(join(PINNED, 'cook.json')))('SF15: shardHalf serves the cook\'s KTX2', () => {
  let folder = '';
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'sf15-'));
    cpSync(PINNED, folder, {recursive: true});
    const cook = JSON.parse(readFileSync(join(folder, 'cook.json'), 'utf8')) as {mounts: {url: string; path: string; hash: string; bytes: number}[]};
    for (const [url, bytes] of [['/assets/open-plot-alien-plain/tex/leafy_grass/diffuse.jpg', jpg], ['/assets/open-plot-alien-plain/sky/day.png', png]] as const) {
      const path = `mounts${url}`; mkdirSync(dirname(join(folder, path)), {recursive: true}); writeFileSync(join(folder, path), bytes);
      cook.mounts.push({url, path, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length});
    }
    const text = JSON.stringify(cook), index = JSON.parse(readFileSync(join(folder, 'shard.json'), 'utf8')) as {cook: {bytes: number; hash: string}};
    writeFileSync(join(folder, 'cook.json'), text);
    index.cook = {...index.cook, bytes: Buffer.byteLength(text), hash: createHash('sha256').update(text).digest('hex')};
    writeFileSync(join(folder, 'shard.json'), JSON.stringify(index));
  });
  afterAll(() => { if (folder !== '') rmSync(folder, {recursive: true, force: true}); });

  it('lists the desktop KTX2 in the desktop manifests and the phone 6x6 in the phone ones, both in the table', () => {
    const half = shardHalf(openShardfile(folderTarball(folder), {preparationOnly: true}), (_url, bytes) => bytes.length, undefined, {phone: true, encode: astc6, images: encode});
    const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(half.discovery?.bytes)));
    const source = '/assets/open-plot-alien-plain/tex/leafy_grass/diffuse.jpg', desktop = table.desktop[source] ?? '', phone = table.phone[source] ?? '';
    expect(desktop).toMatch(/-[a-f0-9]{8}\.ktx2$/u);
    expect(phone).toMatch(/\.t512-[a-f0-9]{8}\.ktx2$/u);
    const urls = (tier: 'phone' | 'desktop'): string[] => half.mountRows(tier, 'whole').map(row => row.url);
    expect(urls('desktop')).toContain(desktop);
    expect(urls('desktop')).not.toContain(phone);
    expect(urls('phone')).toContain(phone);
    expect(urls('phone')).not.toContain(desktop);
    // The image stays listed for a GPU that can't sample KTX2.
    expect(urls('desktop').some(url => url.startsWith(source))).toBe(true);
    expect(ASTC_6X6.has(ktx2Info(half.read(phone)).vkFormat)).toBe(true);
    expect(half.tierFiles.map(row => row.url)).toEqual(expect.arrayContaining([desktop, phone]));
  }, 120_000);
});
