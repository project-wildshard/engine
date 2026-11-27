import sharp from 'sharp';
import {beforeAll, expect, it} from 'vitest';
import {desktopKtx2} from '../src/cook/game/cookedKtx2';
import {loadBasisuImageKtx2, type ImageKtx2Encode} from '../src/cook/game/imageKtx2Wasm';
import {ktx2Info} from '../src/cook/game/tierTextures';
import {cookedKtx2TableOf} from '../src/shared/game/shardfile/cookedKtx2Table';

// SF5d and SF5g: Pine Hollow's cooked phone entry asked `rock_ground/arm.jpg`, whose phone row the cook had keyed only by its
// `arm.phone.webp` copy, so the page 404ed and the world didn't download; and a ground layer reached the phone whole (2048 in
// Pine) where desktop reads it trimmed to 1024. The phone keys a file by its own name too, and reads the trimmed layer.

let encode: ImageKtx2Encode, big: Uint8Array, small: Uint8Array;
const pageTable = (): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, slug: 'z', native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone: {}, desktop: {}}, grid: {phone: {}, desktop: {}}}]}}}));
const png = async (size: number): Promise<Uint8Array> =>
  new Uint8Array(await sharp(Buffer.alloc(size * size * 3, 90), {raw: {width: size, height: size, channels: 3}}).png().toBuffer());

beforeAll(async () => {
  encode = await loadBasisuImageKtx2();
  [big, small] = await Promise.all([png(2048), png(64)]);
}, 60_000);

it('keys a file with a phone copy by its own name on the phone, and gives the phone the trimmed layer', () => {
  const arm = '/assets/z/tex/rock/arm.png', copy = '/assets/z/tex/rock/arm.phone.webp';
  const mounts = [{url: arm, read: () => big}, {url: copy, read: () => small}];
  const cooked = desktopKtx2(pageTable(), mounts, encode);
  const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
  expect(table.phone[arm]).toBe(table.phone[copy]);
  expect(table.phone[arm]).toBeDefined();
  const layer = table.desktop[`${arm}#layer`];
  expect(table.phone[`${arm}#layer`]).toBe(layer);
  const made = new Map(cooked?.files.map(file => [file.url, file.bytes]));
  expect(ktx2Info(made.get(layer ?? '') ?? new Uint8Array())).toMatchObject({width: 1024, height: 1024});
}, 120_000);

it('keys a file by its own name whatever its phone copy\'s format (SF7j: Nine\'s scroll.phone.png)', () => {
  const scroll = '/assets/z/scroll.png', copy = '/assets/z/scroll.phone.png';
  const cooked = desktopKtx2(pageTable(), [{url: scroll, read: () => small}, {url: copy, read: () => small}], encode);
  const table = cookedKtx2TableOf(JSON.parse(new TextDecoder().decode(cooked?.discovery)));
  expect(table.phone[copy]).toBeDefined();
  expect(table.phone[scroll]).toBe(table.phone[copy]);
}, 60_000);
