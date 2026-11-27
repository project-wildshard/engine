// @vitest-environment node
// Standalone shardfiles SF21 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md): the cook's
// texture encodes survive cook jobs (`src/cook/game/encodeCache.ts`). A kept file is read only under a key naming the tier,
// the encoder settings, the role, the flip and the cook version, and only when it is a whole KTX2.
// oxlint-disable-next-line import/no-nodejs-modules -- Git's file list for the load-time read guard.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real cache folders and a real permission-limited cook child.
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each proof owns and removes its folders.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Each proof owns and removes its folders.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child script imports the real encoder by file URL.
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {runJob} from '../src/cook/game/cookWorker';
import {COOK_VERSION, encodeCacheDir, encodeKey, wholeKtx2} from '../src/cook/game/encodeCache';
import {wasmImageKtx2} from '../src/cook/game/imageKtx2Wasm';
import {wasmAstc6} from '../src/cook/game/astc6Wasm';

const noise = (size: number, seed: number): Buffer => Buffer.from(Array.from({length: size * size * 3}, (_, at) => (at * 37 + seed * 101 + ((at / 3) | 0) % size * 3) & 255));
let png: Uint8Array, folder: string;
beforeAll(async () => {
  png = new Uint8Array(await sharp(noise(32, 5), {raw: {width: 32, height: 32, channels: 3}}).png().toBuffer());
  folder = mkdtempSync(join(tmpdir(), 'sf21-'));
});
afterAll(() => { rmSync(folder, {recursive: true, force: true}); });
const kept = (cache: string): string[] => readdirSync(cache).filter(name => name.endsWith('.ktx2'));

describe('SF21: the key covers every setting and the cook version', () => {
  it('names the cook version of cook-version.json and changes with any part, the version or the input', () => {
    expect(COOK_VERSION).toBe((JSON.parse(readFileSync('src/cook/game/cook-version.json', 'utf8')) as {cookVersion: string}).cookVersion);
    const base = encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'settings', 'srgb', 'flip'], png);
    const others = [
      encodeKey(['image-ktx2-wasm/2', 'phone', 'build', 'settings', 'srgb', 'flip'], png),
      encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'other settings', 'srgb', 'flip'], png),
      encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'settings', 'linear', 'flip'], png),
      encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'settings', 'srgb', 'keep'], png),
      encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'settings', 'srgb', 'flip'], png, `${COOK_VERSION}-next`),
      encodeKey(['image-ktx2-wasm/2', 'desktop', 'build', 'settings', 'srgb', 'flip'], png.subarray(1)),
    ];
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  });

  it('takes the cook job\'s folder from COOK_ENCODE_CACHE when an encoder is given none', () => {
    const previous = process.env['COOK_ENCODE_CACHE'];
    try {
      process.env['COOK_ENCODE_CACHE'] = '/job/encodes';
      expect(encodeCacheDir(undefined)).toBe('/job/encodes');
      expect(encodeCacheDir('/given')).toBe('/given');
      process.env['COOK_ENCODE_CACHE'] = '';
      expect(encodeCacheDir(undefined)).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env['COOK_ENCODE_CACHE']; else process.env['COOK_ENCODE_CACHE'] = previous;
    }
  });
});

describe('SF21: a kept encode is reused only when it is a whole KTX2 under the same settings', () => {
  it('reuses a kept desktop encode, and a changed role or flip misses the cache', async () => {
    const cache = join(folder, 'desktop');
    const first = await wasmImageKtx2({cacheDir: cache, lanes: 1});
    const out = first.encode(png, {role: 'srgb', flip: true});
    expect(out !== undefined && wholeKtx2(out)).toBe(true);
    expect(first.stats).toEqual({encoded: 1, reused: 0, failed: 0});
    const again = await wasmImageKtx2({cacheDir: cache, lanes: 1});
    expect(again.encode(png, {role: 'srgb', flip: true})).toEqual(out);
    expect(again.stats).toEqual({encoded: 0, reused: 1, failed: 0});
    again.encode(png, {role: 'linear', flip: true});
    again.encode(png, {role: 'srgb', flip: false});
    expect(again.stats).toEqual({encoded: 2, reused: 1, failed: 0});
    expect(kept(cache)).toHaveLength(3);
  });

  it('encodes again and replaces a kept file that is not a whole KTX2', async () => {
    const cache = join(folder, 'torn'), as = {role: 'srgb', flip: false} as const;
    const first = await wasmImageKtx2({cacheDir: cache, lanes: 1}), out = first.encode(png, as);
    if (out === undefined) throw new Error('No encode');
    const [name] = kept(cache);
    if (name === undefined) throw new Error('Nothing kept');
    expect(wholeKtx2(out.subarray(0, out.length - 1))).toBe(false);
    expect(wholeKtx2(new Uint8Array(out.length))).toBe(false);
    writeFileSync(join(cache, name), out.subarray(0, out.length - 1));
    const again = await wasmImageKtx2({cacheDir: cache, lanes: 1});
    expect(again.encode(png, as)).toEqual(out);
    expect(again.stats).toEqual({encoded: 1, reused: 0, failed: 0});
    expect(new Uint8Array(readFileSync(join(cache, name)))).toEqual(out);
  });

  it('keeps the phone 6x6 encodes under their own key, and a recording pass counts a kept one as reused', async () => {
    const cache = join(folder, 'phone'), desktop = (await wasmImageKtx2({lanes: 1})).encode(png, {role: 'srgb', flip: false});
    if (desktop === undefined) throw new Error('No encode');
    const first = await wasmAstc6({cacheDir: cache, lanes: 1}), out = first.encode(desktop, 'srgb');
    expect(out !== undefined && wholeKtx2(out)).toBe(true);
    const again = await wasmAstc6({cacheDir: cache, lanes: 1});
    again.record(desktop, 'srgb');
    await again.flush();
    expect(again.encode(desktop, 'srgb')).toEqual(out);
    expect(again.stats).toEqual({encoded: 0, reused: 1, failed: 0});
    again.encode(desktop, 'normal');
    expect(again.stats.encoded).toBe(1);
  });
});

it('SF21: a second cook job reads the first job\'s encodes from the job\'s cache folder', async () => {
  const root = process.cwd(), work = join(folder, 'jobs'), script = join(work, 'probe.mjs'), image = join(work, 'image.png');
  mkdirSync(work, {recursive: true});
  writeFileSync(image, png);
  // The probe runs as a cook job does, permission-limited, and reports its encoder's counts as a refusal.
  writeFileSync(script, `import {readFileSync} from 'node:fs';
import {wasmImageKtx2} from ${JSON.stringify(pathToFileURL(join(root, 'src/cook/game/imageKtx2Wasm.ts')).href)};
const encoder = await wasmImageKtx2({lanes: 1});
const out = encoder.encode(new Uint8Array(readFileSync(${JSON.stringify(image)})), {role: 'srgb', flip: true});
console.log(JSON.stringify({refused: JSON.stringify({cache: process.env.COOK_ENCODE_CACHE ?? null, made: out !== undefined, ...encoder.stats})}));
process.exitCode = 3;`);
  const previous = process.env['COOK_ENCODE_CACHE'];
  delete process.env['COOK_ENCODE_CACHE'];
  const job = async (name: string): Promise<{cache: string | null; made: boolean; encoded: number; reused: number}> => {
    mkdirSync(join(work, name));
    const outcome = await runJob({root, execPath: process.execPath, loader: join(root, 'src/scripts/bake-loader.mjs'), script, wrap: [],
      limits: {seconds: 60, memoryMB: 2048, heapMB: 1024}}, join(work, name, 'input.tar'), join(work, name, 'out'));
    if (outcome.kind !== 'refused') throw new Error(outcome.kind === 'killed' ? outcome.reason : 'The probe cooked');
    return JSON.parse(outcome.reason) as {cache: string | null; made: boolean; encoded: number; reused: number};
  };
  try {
    const first = await job('one'), second = await job('two');
    expect(first).toMatchObject({cache: join(work, 'cache', 'encodes'), made: true, encoded: 1, reused: 0});
    expect(second).toMatchObject({cache: join(work, 'cache', 'encodes'), made: true, encoded: 0, reused: 1});
  } finally {
    if (previous === undefined) delete process.env['COOK_ENCODE_CACHE']; else process.env['COOK_ENCODE_CACHE'] = previous;
  }
}, 120_000);

// An author bundle (sharddev's `wildshard dev` and `validate`, engine linked) inlines `new URL(<file>, import.meta.url)` as a
// data: URL, so a module that reads a file that way when it loads breaks every dev page (opus-sdk, 2026-11-27: SF21's first
// cook-version read). The cook and shared modules read such files by import, or lazily inside the function that needs them.
it('SF21: no cook or shared module reads a file by import.meta.url when it loads', () => {
  const files = execFileSync('git', ['ls-files', '-z', 'src/cook', 'src/shared'], {encoding: 'utf8'}).split('\0')
    .filter(path => /\.(?:ts|mts|mjs)$/u.test(path) && !/\.test\./u.test(path));
  const loading = files.flatMap(path => readFileSync(path, 'utf8').split('\n').flatMap((line, at) =>
    /^(?:export\s+)?(?:const|let|var)\b.*readFileSync\(\s*new URL\([^)]*import\.meta\.url/u.test(line) ? [`${path}:${at + 1}`] : []));
  expect(files.length).toBeGreaterThan(100);
  expect(loading).toEqual([]);
});
