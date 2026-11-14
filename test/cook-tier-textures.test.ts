// S12 (J330): the cook picks each texture's size per tier from one master, by dropping KTX2 mip levels above the tier's
// largest size. No re-encode: every level the phone keeps is the master's own bytes, so the look is the master's at
// any distance the phone draws.
import {describe, expect, it} from 'vitest';
import {glbImages, ktx2Info, phoneTier, tierGlb, tierKtx2, trimKtx2, type TextureRole} from '../src/cook/game/tierTextures';
import {phoneOverlay} from '../src/cook/game/entryTotals';

const LEVEL_INDEX = 80;

/** A KTX2 with real header and index fields and stand-in level bytes (level i filled with i + 1): trimming never decodes. */
function ktx2(size: number, options: Readonly<{vkFormat?: number; scheme?: number}> = {}): Uint8Array {
  const levels = Math.log2(size) + 1, dfd = new Uint8Array(44).fill(7), kvd = new Uint8Array(20).fill(9);
  const bodies = Array.from({length: levels}, (_, level) => new Uint8Array(Math.max(16, ((size >> level) ** 2) / 4)).fill(level + 1));
  const head = LEVEL_INDEX + 24 * levels, dfdAt = head, kvdAt = dfdAt + dfd.length;
  let at = kvdAt + kvd.length;
  const offsets: number[] = [];
  for (let level = levels - 1; level >= 0; level--) { offsets[level] = at; at += bodies[level]?.length ?? 0; }
  const out = new Uint8Array(at), view = new DataView(out.buffer);
  out.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(12, options.vkFormat ?? 0, true); view.setUint32(16, 1, true);
  view.setUint32(20, size, true); view.setUint32(24, size, true); view.setUint32(36, 1, true);
  view.setUint32(40, levels, true); view.setUint32(44, options.scheme ?? 2, true);
  view.setUint32(48, dfdAt, true); view.setUint32(52, dfd.length, true); view.setUint32(56, kvdAt, true); view.setUint32(60, kvd.length, true);
  for (let level = 0; level < levels; level++) {
    const body = bodies[level] ?? new Uint8Array(), entry = LEVEL_INDEX + 24 * level;
    view.setBigUint64(entry, BigInt(offsets[level] ?? 0), true);
    view.setBigUint64(entry + 8, BigInt(body.length), true);
    view.setBigUint64(entry + 16, BigInt(body.length * 2), true);
    out.set(body, offsets[level]);
  }
  out.set(dfd, dfdAt); out.set(kvd, kvdAt);
  return out;
}

/** A GLB whose buffer holds geometry, then the image, then more geometry and a meshopt stream the trim must move. */
function glb(image: Uint8Array): Uint8Array {
  const pad = (n: number): number => Math.ceil(n / 4) * 4;
  const before = new Uint8Array(36).fill(1), after = new Uint8Array(48).fill(2), meshopt = new Uint8Array(20).fill(3);
  const imageAt = before.length, afterAt = pad(imageAt + image.length), meshoptAt = afterAt + after.length;
  const bin = new Uint8Array(pad(meshoptAt + meshopt.length));
  bin.set(before, 0); bin.set(image, imageAt); bin.set(after, afterAt); bin.set(meshopt, meshoptAt);
  const json = {
    asset: {version: '2.0'},
    extensionsUsed: ['KHR_texture_basisu', 'EXT_meshopt_compression'],
    buffers: [{byteLength: bin.length}, {byteLength: 64, extensions: {EXT_meshopt_compression: {fallback: true}}}],
    bufferViews: [
      {buffer: 0, byteOffset: 0, byteLength: before.length},
      {buffer: 0, byteOffset: imageAt, byteLength: image.length},
      {buffer: 0, byteOffset: afterAt, byteLength: after.length},
      {buffer: 1, byteLength: 64, extensions: {EXT_meshopt_compression: {buffer: 0, byteOffset: meshoptAt, byteLength: meshopt.length, byteStride: 4, count: 16, mode: 'ATTRIBUTES'}}},
    ],
    images: [{bufferView: 1, mimeType: 'image/ktx2'}],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = pad(text.length);
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength); out.set(text, 20);
  view.setUint32(20 + jsonLength, bin.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

const levelBytes = (file: Uint8Array, level: number): Uint8Array => {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength), entry = LEVEL_INDEX + 24 * level;
  const at = Number(view.getBigUint64(entry, true)), length = Number(view.getBigUint64(entry + 8, true));
  return file.subarray(at, at + length);
};

describe('S12: per-tier texture sizes from one master', () => {
  it('drops the levels above the tier size and keeps the rest byte for byte', () => {
    const master = ktx2(1024), phone = trimKtx2(master, 512);
    expect(ktx2Info(phone)).toMatchObject({width: 512, height: 512, levels: 10, scheme: 2});
    expect(phone.length).toBeLessThan(master.length * 0.3);
    for (let level = 0; level < 10; level++) expect(levelBytes(phone, level)).toEqual(levelBytes(master, level + 1));
    expect(phone.subarray(LEVEL_INDEX + 24 * 10, LEVEL_INDEX + 24 * 10 + 44)).toEqual(new Uint8Array(44).fill(7));
  });

  it('keeps a texture already at or under the size, and a BasisLZ or non-block one it cannot cut', () => {
    const small = ktx2(256), etc1s = ktx2(1024, {scheme: 1});
    expect(trimKtx2(small, 512)).toBe(small);
    expect(trimKtx2(etc1s, 512)).toBe(etc1s);
    const rgb8 = ktx2(1024, {vkFormat: 23, scheme: 0});
    expect(trimKtx2(rgb8, 512)).toBe(rgb8);
  });

  it('trims ASTC 6×6 masters too', () => {
    expect(ktx2Info(trimKtx2(ktx2(1024, {vkFormat: 166}), 512))).toMatchObject({width: 512, levels: 10, vkFormat: 166});
  });

  it('takes the images out of a GLB and puts the tier size back, with every other view moved intact', () => {
    const master = glb(ktx2(1024)), phone = tierGlb(master, 512);
    const [image] = glbImages(phone);
    expect(image).toBeDefined();
    expect(ktx2Info(image?.bytes ?? new Uint8Array())).toMatchObject({width: 512, levels: 10});
    expect(phone.length).toBeLessThan(master.length * 0.3);
    const read = (file: Uint8Array): {json: {bufferViews: {byteOffset?: number; byteLength: number; extensions?: {EXT_meshopt_compression?: {byteOffset: number; byteLength: number}}}[]}; bin: Uint8Array} => {
      const view = new DataView(file.buffer, file.byteOffset, file.byteLength), jsonLength = view.getUint32(12, true);
      return {json: JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + jsonLength))), bin: file.subarray(28 + jsonLength)};
    };
    const was = read(master), now = read(phone);
    for (const index of [0, 2]) {
      const a = was.json.bufferViews[index], b = now.json.bufferViews[index];
      expect(now.bin.subarray(b?.byteOffset ?? 0, (b?.byteOffset ?? 0) + (b?.byteLength ?? 0))).toEqual(was.bin.subarray(a?.byteOffset ?? 0, (a?.byteOffset ?? 0) + (a?.byteLength ?? 0)));
    }
    const a = was.json.bufferViews[3]?.extensions?.EXT_meshopt_compression, b = now.json.bufferViews[3]?.extensions?.EXT_meshopt_compression;
    expect((b?.byteOffset ?? 0) % 4).toBe(0);
    expect(now.bin.subarray(b?.byteOffset ?? 0, (b?.byteOffset ?? 0) + (b?.byteLength ?? 0))).toEqual(was.bin.subarray(a?.byteOffset ?? 0, (a?.byteOffset ?? 0) + (a?.byteLength ?? 0)));
  });

  it('leaves a GLB with nothing to cut as the same bytes', () => {
    const small = glb(ktx2(256));
    expect(tierGlb(small, 512)).toBe(small);
  });
});

describe('phoneTier (S12b)', () => {
  const files: Readonly<Record<string, Uint8Array>> = {
    '/assets/gpu/rock-c9b1bd73.ktx2': ktx2(2048), '/assets/gpu/leaf-11111111.ktx2': ktx2(256),
    '/assets/x/astc6/ground-22222222.ktx2': ktx2(1024), '/assets/gpu/tree-33333333.glb': glb(ktx2(1024)),
  };
  const desktop = {'/assets/rock.png': '/assets/gpu/rock-c9b1bd73.ktx2'};
  const discovery = (phone: Record<string, string>): Uint8Array => new TextEncoder().encode(JSON.stringify({version: 1, slug: 'x', rows: {},
    native: {ktx2: {$call: 'pageModeKtx2', args: [{shard: {phone, desktop}, grid: {phone: {...phone}, desktop}}]}}}));
  const read = (url: string): Uint8Array | undefined => files[url];
  interface Rows {shard: {phone: Record<string, string>; desktop: Record<string, string>}; grid: {phone: Record<string, string>}}
  const rowsOf = (bytes: Uint8Array): Rows | undefined => (JSON.parse(new TextDecoder().decode(bytes)) as {native: {ktx2: {args: Rows[]}}}).native.ktx2.args[0];

  it('gives each phone row over 512 its own content-named file, and moves only the phone maps to it', () => {
    const tier = phoneTier(discovery({
      '/assets/rock.png': '/assets/gpu/rock-c9b1bd73.ktx2', '/assets/leaf.png': '/assets/gpu/leaf-11111111.ktx2',
      '/assets/ground.webp#layer': '/assets/x/astc6/ground-22222222.ktx2', '/assets/tree.glb': '/assets/gpu/tree-33333333.glb',
    }), read);
    if (tier === undefined) throw new Error('expected a phone tier');
    expect([...tier.files.keys()].sort()).toEqual(['/assets/gpu/rock-c9b1bd73.ktx2', '/assets/gpu/tree-33333333.glb']);
    const rock = tier.files.get('/assets/gpu/rock-c9b1bd73.ktx2')?.[0], tree = tier.files.get('/assets/gpu/tree-33333333.glb')?.[0];
    expect(rock?.url).toMatch(/^\/assets\/gpu\/rock\.t512-[a-f0-9]{8}\.ktx2$/u);
    expect(rock === undefined ? 0 : ktx2Info(rock.bytes).width).toBe(512);
    expect(tree === undefined ? 0 : ktx2Info(glbImages(tree.bytes)[0]?.bytes ?? new Uint8Array()).width).toBe(512);
    const rows = rowsOf(tier.discovery);
    expect(rows?.shard.phone['/assets/rock.png']).toBe(rock?.url);
    expect(rows?.grid.phone['/assets/rock.png']).toBe(rock?.url);
    expect(rows?.shard.desktop['/assets/rock.png']).toBe('/assets/gpu/rock-c9b1bd73.ktx2');
    // A row at or under its size, and an author's `#layer` row, keep their file.
    expect(rows?.shard.phone['/assets/leaf.png']).toBe('/assets/gpu/leaf-11111111.ktx2');
    expect(rows?.shard.phone['/assets/ground.webp#layer']).toBe('/assets/x/astc6/ground-22222222.ktx2');
    expect([...tier.kept].sort()).toEqual(['/assets/gpu/leaf-11111111.ktx2', '/assets/x/astc6/ground-22222222.ktx2']);
  });

  it('is nothing when no row gets smaller, so the cook keeps every byte', () => {
    expect(phoneTier(discovery({'/assets/leaf.png': '/assets/gpu/leaf-11111111.ktx2'}), read)).toBeUndefined();
  });

  it('S12d: makes a phone row\'s file from its source when the product dropped the target (Sky Reach rev 3)', () => {
    const own = {'/assets/fan.glb': glb(ktx2(1024))}, from = (url: string): Uint8Array | undefined => own[url as keyof typeof own] ?? files[url];
    const tier = phoneTier(discovery({'/assets/fan.glb': '/assets/gpu/fan-c0f55842.glb', '/assets/gone.glb': '/assets/gpu/gone-44444444.glb'}), from);
    const made = tier?.files.get('/assets/gpu/fan-c0f55842.glb')?.[0];
    expect(made?.url).toMatch(/^\/assets\/gpu\/fan\.t512-[a-f0-9]{8}\.glb$/u);
    expect(made === undefined ? 0 : ktx2Info(glbImages(made.bytes)[0]?.bytes ?? new Uint8Array()).width).toBe(512);
    expect(rowsOf(tier?.discovery ?? new Uint8Array())?.shard.phone['/assets/fan.glb']).toBe(made?.url);
    // with neither the target nor its source, the row stays as it is
    expect(tier?.kept.has('/assets/gpu/gone-44444444.glb')).toBe(true);
  });

  it('keeps a target a kept row still names, beside its phone file', () => {
    const both = phoneTier(discovery({'/assets/rock.png': '/assets/gpu/rock-c9b1bd73.ktx2', '/assets/horizon/day.webp': '/assets/gpu/rock-c9b1bd73.ktx2'}), read);
    expect(both?.kept.has('/assets/gpu/rock-c9b1bd73.ktx2')).toBe(true);
    expect(both?.files.get('/assets/gpu/rock-c9b1bd73.ktx2')).toHaveLength(1);
  });
});

describe('S12c: the phone tier as ASTC 6×6', () => {
  /** A stand-in encoder: records what it was asked and answers a smaller file, so no basisu runs in a test. */
  const encoder = (): {calls: {width: number; role: TextureRole}[]; encode: (bytes: Uint8Array, role: TextureRole) => Uint8Array} => {
    const calls: {width: number; role: TextureRole}[] = [];
    return {calls, encode: (bytes, role) => { calls.push({width: ktx2Info(bytes).width, role}); return bytes.subarray(0, 96); }};
  };

  it('encodes a UASTC texture after the trim, and only trims ASTC or keeps BasisLZ', () => {
    const {calls, encode} = encoder();
    expect(tierKtx2(ktx2(1024), 512, encode)).toHaveLength(96);
    expect(tierKtx2(ktx2(1024), 512, encode, true)).toHaveLength(96);
    expect(calls).toEqual([{width: 512, role: 'linear'}, {width: 512, role: 'normal'}]);
    expect(ktx2Info(tierKtx2(ktx2(1024, {vkFormat: 166}), 512, encode)).width).toBe(512);
    const etc1s = ktx2(1024, {scheme: 1});
    expect(tierKtx2(etc1s, 512, encode)).toBe(etc1s);
    expect(calls).toHaveLength(2);
  });

  it('encodes the images inside a GLB', () => {
    const {calls, encode} = encoder();
    expect(glbImages(tierGlb(glb(ktx2(1024)), 512, encode))[0]?.bytes).toHaveLength(96);
    expect(calls).toEqual([{width: 512, role: 'linear'}]);
  });

  it('cooks a phone row from its desktop master, in place of the hand-made file', () => {
    const files: Readonly<Record<string, Uint8Array>> = {
      '/assets/gpu/rock-c9b1bd73.ktx2': ktx2(2048), '/assets/x/astc6/rock-44444444.ktx2': ktx2(512, {vkFormat: 166}),
      '/assets/x/astc6/ground-22222222.ktx2': ktx2(1024, {vkFormat: 166}),
    };
    const phone = {'/assets/rock.phone.png': '/assets/x/astc6/rock-44444444.ktx2', '/assets/ground.webp#layer': '/assets/x/astc6/ground-22222222.ktx2'};
    const document = new TextEncoder().encode(JSON.stringify({native: {ktx2: {shard: {phone, desktop: {'/assets/rock.png': '/assets/gpu/rock-c9b1bd73.ktx2'}}}}}));
    const {calls, encode} = encoder();
    const tier = phoneTier(document, url => files[url], undefined, encode);
    const rock = tier?.files.get('/assets/x/astc6/rock-44444444.ktx2')?.[0];
    expect(rock?.url).toMatch(/^\/assets\/x\/astc6\/rock\.t512-[a-f0-9]{8}\.ktx2$/u);
    expect(rock?.bytes).toHaveLength(96);
    expect(calls).toEqual([{width: 512, role: 'linear'}]);
    // An author's `#layer` row keeps its file; without an encoder the master is never read.
    expect(tier?.kept.has('/assets/x/astc6/ground-22222222.ktx2')).toBe(true);
    expect(phoneTier(document, url => files[url])?.files.get('/assets/x/astc6/rock-44444444.ktx2')).toBeUndefined();
  });

  it('S12d: encodes a kept row (a horizon, a #layer twin) at its own size from its own file, never its master', () => {
    const files: Readonly<Record<string, Uint8Array>> = {
      '/assets/gpu/horizon/day-phone-77777777.ktx2': ktx2(1024), '/assets/gpu/horizon/day-88888888.ktx2': ktx2(4096),
    };
    const phone = {'/assets/horizon/day-phone.webp': '/assets/gpu/horizon/day-phone-77777777.ktx2'};
    const document = new TextEncoder().encode(JSON.stringify({native: {ktx2: {shard: {phone, desktop: {'/assets/horizon/day.webp': '/assets/gpu/horizon/day-88888888.ktx2'}}}}}));
    const {calls, encode} = encoder();
    const day = phoneTier(document, url => files[url], undefined, encode)?.files.get('/assets/gpu/horizon/day-phone-77777777.ktx2')?.[0];
    expect(day?.url).toMatch(/^\/assets\/gpu\/horizon\/day-phone\.t16384-[a-f0-9]{8}\.ktx2$/u);
    expect(calls).toEqual([{width: 1024, role: 'linear'}]);
    // Without an encoder it keeps its file, as S12b did.
    expect(phoneTier(document, url => files[url])).toBeUndefined();
  });

  it('takes a master only when the encode ran, and never a desktop GLB for a .phone GLB', () => {
    const files: Readonly<Record<string, Uint8Array>> = {
      '/assets/gpu/rock-c9b1bd73.ktx2': ktx2(2048), '/assets/x/astc6/rock-44444444.ktx2': ktx2(512, {vkFormat: 166}),
      '/assets/gpu/deer-55555555.glb': glb(ktx2(1024)), '/assets/gpu/deer.phone-66666666.glb': glb(ktx2(512, {vkFormat: 166})),
    };
    const phone = {'/assets/rock.png': '/assets/x/astc6/rock-44444444.ktx2', '/assets/deer.phone.glb': '/assets/gpu/deer.phone-66666666.glb'};
    const desktop = {'/assets/rock.png': '/assets/gpu/rock-c9b1bd73.ktx2', '/assets/deer.glb': '/assets/gpu/deer-55555555.glb'};
    const document = new TextEncoder().encode(JSON.stringify({native: {ktx2: {shard: {phone, desktop}}}}));
    const {calls, encode} = encoder();
    // The deer's phone GLB is already 6×6 at 512: nothing to cook, and its desktop GLB is never read.
    expect(phoneTier(document, url => files[url], undefined, encode)?.files.has('/assets/gpu/deer.phone-66666666.glb')).toBe(false);
    expect(calls).toEqual([{width: 512, role: 'linear'}]);
    // A failed encode leaves the hand-made file, which is already at its size.
    expect(phoneTier(document, url => files[url], undefined, () => undefined)).toBeUndefined();
    // A one-level master over the size isn't encoded at full size.
    const flat = ktx2(1024);
    new DataView(flat.buffer).setUint32(40, 1, true);
    expect(tierKtx2(flat, 512, encode)).toBe(flat);
  });
});

it('S12d: the phone overlay is the tiered table\'s stand-ins: the cook\'s phone files and any hand-made 6×6 row', () => {
  const discovery = new TextEncoder().encode(JSON.stringify({native: {ktx2: {GPU_FILES: {phone: {
    '/assets/far-reach/sky.jpg': '/assets/gpu/far-reach/sky.t512-0a1b2c3d.ktx2', '/assets/far-reach/rock.jpg': '/assets/far-reach/astc6/rock-11112222.ktx2',
    '/assets/far-reach/layer.png': '/assets/gpu/far-reach/layer-33334444.ktx2', '/assets/models/bird.glb': '/assets/gpu/models/bird.t512-55556666.glb'},
  desktop: {'/assets/far-reach/sky.jpg': '/assets/gpu/far-reach/sky-77778888.ktx2'}}}}}));
  expect(phoneOverlay(discovery)).toEqual({'/assets/far-reach/sky.jpg': '/assets/gpu/far-reach/sky.t512-0a1b2c3d.ktx2',
    '/assets/far-reach/rock.jpg': '/assets/far-reach/astc6/rock-11112222.ktx2', '/assets/models/bird.glb': '/assets/gpu/models/bird.t512-55556666.glb'});
  expect(phoneOverlay(undefined)).toEqual({});
  expect(phoneOverlay(new TextEncoder().encode('{"native": {}}'))).toEqual({});
});
