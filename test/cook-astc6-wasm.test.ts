// oxlint-disable-next-line import/no-nodejs-modules -- the cook is a Node process
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the cook is a Node process
import {createRequire} from 'node:module';
import {expect, test} from 'vitest';
import {loadBasisuAstc6, wasmAstc6} from '../src/cook/game/astc6Wasm';
import {ktx2Info} from '../src/cook/game/tierTextures';

/** A UASTC master with its mip chain, made by the same vendored build. */
async function uastcMaster(size: number): Promise<Uint8Array> {
  const factory = createRequire(import.meta.url)('../src/cook/game/basisu/basis_encoder.cjs') as (options: object) => Promise<Record<string, any>>;
  const basis = await factory({wasmBinary: new Uint8Array(readFileSync(new URL('../src/cook/game/basisu/basis_encoder.wasm', import.meta.url))), print: () => undefined, printErr: () => undefined});
  basis['initializeBasis']();
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set([x * 4 % 256, y * 4 % 256, (x ^ y) % 256, 255], (y * size + x) * 4);
  const encoder = new basis['BasisEncoder']();
  encoder.setCreateKTX2File(true); encoder.setKTX2UASTCSupercompression(true); encoder.setUASTC(true); encoder.setMipGen(true);
  encoder.setSliceSourceImage(0, rgba, size, size, basis['ldr_image_type'].cRGBA32.value);
  const out = new Uint8Array(size * size * 8 + 65_536), length = encoder.encode(out) as number; encoder.delete();
  return out.slice(0, length);
}

test('S12d: basisu\'s WebAssembly build encodes a UASTC master as ASTC 6x6, on worker threads or this one', async () => {
  const master = await uastcMaster(64);
  expect(ktx2Info(master).vkFormat).toBe(0);
  const direct = (await loadBasisuAstc6())(master, 'srgb');
  expect(direct).toBeDefined();
  const info = ktx2Info(direct ?? new Uint8Array());
  expect([165, 166]).toContain(info.vkFormat); // ASTC 6x6 UNORM / SRGB, as `basisu -ldr_6x6` writes
  expect([info.width, info.height]).toEqual([64, 64]);
  // A recording pass answers as an encode would; flush encodes on workers; the real pass reads the result back.
  const astc6 = await wasmAstc6({lanes: 2});
  expect(astc6.record(master, 'srgb')).toBe(master);
  await astc6.flush();
  expect(astc6.stats).toEqual({encoded: 1, reused: 0, failed: 0});
  expect(astc6.encode(master, 'srgb')).toEqual(direct);
  expect(astc6.stats).toEqual({encoded: 1, reused: 1, failed: 0});
  // Not a KTX2 basisu reads: no file, and the cook keeps the trimmed master.
  expect(astc6.encode(new Uint8Array(64), 'linear')).toBeUndefined();
}, 120_000);
