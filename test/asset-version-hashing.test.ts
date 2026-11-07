// oxlint-disable-next-line import/no-nodejs-modules -- Observe actual file reads in owned asset fixtures.
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Named builtin imports share the real read observer.
import { syncBuiltinESMExports } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all fixtures beneath checkout scratch.
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { contentNamed, hashTree } from '../scripts/app-build/assetHashes';

test('version filtering omits discarded bodies and retains current full-tree hashes',()=>{
  const root=mkdtempSync(resolve('tmp/asset-version-'));
  const at=resolve(root,'public/assets');mkdirSync(resolve(at,'packs'),{recursive:true});
  writeFileSync(resolve(at,'packs/current.bin'),'unchanged packed body');
  writeFileSync(resolve(at,'model-12345678.glb'),'content named body');
  writeFileSync(resolve(at,'model.glb'),'versioned body');
  const reads=vi.spyOn(fs,'readFileSync');syncBuiltinESMExports();
  try {
    const selected=hashTree('assets',root,path=>!contentNamed(path));
    expect(reads.mock.calls.map(call=>String(call[0]))).toEqual([resolve(at,'model.glb')]);
    const full=hashTree('assets',root);
    expect(selected).toEqual(Object.fromEntries(Object.entries(full).filter(([path])=>!contentNamed(path))));
    writeFileSync(resolve(at,'model.glb'),'changed versioned body');
    expect(hashTree('assets',root,path=>!contentNamed(path))['/assets/model.glb']).not.toBe(selected['/assets/model.glb']);
  } finally { reads.mockRestore();syncBuiltinESMExports();rmSync(root,{recursive:true,force:true}); }
});
