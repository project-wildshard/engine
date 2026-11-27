import { expect, test, vi } from 'vitest';
import { CompressedTexture, DataTexture, type Texture } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolate the collection proof in a real-GC child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the child's temporary repository configuration.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve installed runner paths without a shell.
import { resolve as resolvePath } from 'node:path';
import * as ktx2 from '../src/client/engine/core/ktx2';
import { ownSceneResource } from '../src/client/engine/app/sceneOwnership';
import { Scope } from '../src/shared/engine/app/scope';
import type { Renderer } from '../src/client/engine/render/renderer';
import { emptyShardfile } from '../src/shared/host/author';
import { parseFamilyMaterial } from '@wildshard/format/materialFamilies';
import { clientMaterials } from '../src/client/game/shardfile/clientMaterials';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

// The stub parses only KTX2 inputs. The identifier routes these bytes to the stubbed transcoder.
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function fixture(mode: 'success' | 'decode' | 'pending' | 'missing' = 'success', raw = false) {
  const scope = new Scope('material-loader'), source = emptyShardfile({ slug: 'loader-fixture', name: 'Loader', author: 'Test', seed: 1, revision: 1 });
  source.look.materials['first'] = parseFamilyMaterial({ family: 'painterly', map: 'first' });
  source.look.materials['second'] = parseFamilyMaterial({ family: 'painterly', map: 'second' });
  const textures: (CompressedTexture | DataTexture)[] = [], loaders: WeakRef<KTX2Loader>[] = [], binaries: WeakRef<ArrayBuffer>[] = [];
  let disposed = 0, complete = (): void => { throw new Error('No pending decode'); };
  const failure = new Error('Decode refused');
  const detect = vi.spyOn(ktx2, 'detectKtx2Support').mockImplementation(loader => loader);
  const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose').mockImplementation(() => { disposed++; });
  const parse = vi.spyOn(KTX2Loader.prototype, 'parse').mockImplementation(function decode(this: KTX2Loader, _bytes, onLoad, onError) {
    const binary = new ArrayBuffer(527333);Reflect.set(this, 'transcoderBinary', binary);
    loaders.push(new WeakRef(this));binaries.push(new WeakRef(binary));
    if (mode === 'decode') { onError?.(failure);return; }
    const pixels = new Uint8Array([1, 2, 3, 255]);
    const texture = raw ? new DataTexture(pixels, 1, 1) : new CompressedTexture([{ data: pixels, width: 1, height: 1 }], 1, 1);
    textures.push(texture);
    // three's declarations describe Basis output; its raw KTX2 parser returns DataTexture.
    const loaded = onLoad as ((decoded: Texture) => void) | undefined;
    if (mode === 'pending') complete = () => { loaded?.(texture); };
    else loaded?.(texture);
  });
  const assets = new Map([['first', new Uint8Array([...KTX2_IDENTIFIER, 1])]]);
  if (mode !== 'missing') assets.set('second', new Uint8Array([...KTX2_IDENTIFIER, 2]));
  const start = () => clientMaterials(source, assets, legacyDouble<Renderer>({}), scope, { graphs: false });
  return { scope, textures, loaders, binaries, failure, start, finish: () => { complete(); }, disposed: () => disposed,
    restore: () => { parse.mockRestore();dispose.mockRestore();detect.mockRestore(); } };
}

test('one-shot transcoder retires after its final decode while materials remain usable', async () => {
  const f = fixture();
  try {
    const result = await f.start();
    expect(f.textures).toHaveLength(2);expect(f.disposed()).toBe(1);expect(f.scope.disposed).toBe(false);
    expect(result.textures.get('first')).toBe(f.textures[0]);expect(result.textures.get('second')).toBe(f.textures[1]);
    expect(f.textures[0]).toHaveProperty('mipmaps.0.data', new Uint8Array([1, 2, 3, 255]));
    expect(result.compile({ family: 'painterly', map: 'first' })).toHaveProperty('map', f.textures[0]);
    f.scope.dispose();expect(f.disposed()).toBe(1);
  } finally { f.scope.dispose();f.restore(); }
});

test.each(['decode', 'missing'] as const)('one-shot transcoder retires on %s refusal', async mode => {
  const f = fixture(mode);
  try {
    const pending = f.start();
    await (mode === 'decode' ? expect(pending).rejects.toBe(f.failure) : expect(pending).rejects.toThrow('Missing admitted material texture'));
    expect(f.disposed()).toBe(1);f.scope.dispose();expect(f.disposed()).toBe(1);
  } finally { f.scope.dispose();f.restore(); }
});

test('scope cancellation retires a pending loader once and refuses its late texture', async () => {
  const f = fixture('pending');
  try {
    const pending = f.start();
    const late = await vi.waitFor(() => {
      const texture = f.textures[0];
      if (texture === undefined) throw new Error('Missing pending texture');
      return texture;
    });
    const released = vi.spyOn(late, 'dispose');
    f.scope.dispose();expect(f.disposed()).toBe(1);f.finish();
    await expect(pending).rejects.toThrow('Material scope unloaded during transcode');
    expect(released).toHaveBeenCalledOnce();expect(f.disposed()).toBe(1);released.mockRestore();
  } finally { f.scope.dispose();f.restore(); }
});

test('retiring an Explorer thumbnail keeps its borrowed GPU-only catalogue texture until the catalogue leaves', async () => {
  const f = fixture('success', true);
  try {
    const catalogue = await f.start(), atlas = catalogue.textures.get('first');
    if (!(atlas instanceof DataTexture)) throw new Error('Missing raw catalogue texture');
    const dispose = vi.spyOn(atlas, 'dispose');
    atlas.onUpdate?.(atlas);
    expect(atlas.image.data).toHaveLength(0); // The original allocation now holds the only decoded copy.

    const specimen = f.scope.child('specimen');
    ownSceneResource(atlas, specimen);
    specimen.dispose();
    expect(dispose).not.toHaveBeenCalled();

    const nextSpecimen = f.scope.child('next-specimen');
    ownSceneResource(atlas, nextSpecimen);
    nextSpecimen.dispose();
    expect(dispose).not.toHaveBeenCalled();
    f.scope.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  } finally { f.scope.dispose();f.restore(); }
});

async function retainedMaterials() {
  const f = fixture();
  try { const materials = await f.start();return { scope: f.scope, materials, loaders: f.loaders, binaries: f.binaries }; }
  finally { f.restore(); }
}
test('live compiled materials do not retain a finished loader or its transcoder binary', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    const { WS_MATERIAL_LOADER_GC: child } = process.env;
    if (child === '1') throw new Error('Material loader proof requires --expose-gc');
    mkdirSync('tmp', { recursive: true });const directory = mkdtempSync(resolvePath('tmp/material-loader-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['test/client-material-loader-lifetime.test.ts'],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_MATERIAL_LOADER_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      });expect(output).toContain('6 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const live = await retainedMaterials();
  try {
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });Reflect.apply(gc, globalThis, []);
      if (live.loaders.every(ref => ref.deref() === undefined) && live.binaries.every(ref => ref.deref() === undefined)) break;
    }
    expect(live.loaders.every(ref => ref.deref() === undefined)).toBe(true);expect(live.binaries.every(ref => ref.deref() === undefined)).toBe(true);
    expect(live.scope.disposed).toBe(false);expect(live.materials.textures.size).toBe(2);
    expect(live.materials.compile({ family: 'painterly', map: 'second' })).toHaveProperty('map', live.materials.textures.get('second'));
    const reentry = fixture();
    try {
      const next = await reentry.start();expect(next.textures.size).toBe(2);expect(reentry.disposed()).toBe(1);
      expect(next.textures.get('first')).not.toBe(live.materials.textures.get('first'));
    } finally { reentry.scope.dispose();reentry.restore(); }
  } finally { live.scope.dispose(); }
});
