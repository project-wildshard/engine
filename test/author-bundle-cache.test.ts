// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real compiler cache/input evidence in owned scratch.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine cache fixtures to this checkout.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A foreign writer must bypass the compiler's declared writes.
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { authorBundleCached } from '../scripts/author-bundle-cache.mjs';
import { captureProductInputs, productInputKey, recordBundle, recordResolution } from '../scripts/shardfile-inputs.mjs';
import { InputHashMemo } from '../scripts/bake-input-hashes.mjs';

const owned:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture() {
  const root=mkdtempSync(resolve('tmp/author-bundle-'));owned.push(root);
  const source=resolve(root,'compiler.mjs'),cache=resolve(root,'cache');
  writeFileSync(source,'export const value=1;');
  let calls=0;
  const compile=()=>{
    calls++;
    recordResolution('./dependency',source);
    const code=readFileSync(source,'utf8');
    recordBundle({output:[{type:'chunk',moduleIds:[source]}]},{execution:true});
    return Promise.resolve({code,modules:[source]});
  };
  const run=()=>authorBundleCached(root,['native-fixture'],compile,cache);
  return {root,source,cache,run,compile,calls:()=>calls};
}

test('reuses completed compilation and invalidates source or new resolution candidates',async()=>{
  const f=fixture();
  expect((await f.run()).reused).toBe(false);
  expect((await f.run()).reused).toBe(true);expect(f.calls()).toBe(1);
  writeFileSync(f.source,'export const value=2;');
  expect((await f.run()).reused).toBe(false);expect(f.calls()).toBe(2);
  writeFileSync(resolve(f.root,'dependency.ts'),'export const added=true;');
  expect((await f.run()).reused).toBe(false);expect(f.calls()).toBe(3);
});

test('warm compiler replay keeps source and absent resolution dependencies in every product',async()=>{
  const f=fixture();await f.run();
  const receipt=resolve(f.root,'product.json');
  await captureProductInputs(f.root,receipt,async()=>{
    const bundle=await f.run();expect(bundle.reused).toBe(true);
    recordBundle({output:[{type:'chunk',moduleIds:bundle.modules}]},{execution:true});
  });
  expect(productInputKey(f.root,receipt,[],new InputHashMemo(f.root))).toBeDefined();
  writeFileSync(resolve(f.root,'dependency.ts'),'export const added=true;');
  expect(productInputKey(f.root,receipt,[],new InputHashMemo(f.root))).toBeUndefined();
});

test('a replayed compiler still refuses a foreign edit before the product finishes',async()=>{
  const f=fixture();await f.run();
  await expect(captureProductInputs(f.root,resolve(f.root,'product.json'),async()=>{
    const bundle=await f.run();expect(bundle.reused).toBe(true);
    recordBundle({output:[{type:'chunk',moduleIds:bundle.modules}]},{execution:true});
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],"changed")',f.source]);
  })).rejects.toThrow('Product input changed during build');
});

test('corrupt compiled payloads rebuild and failed compilers publish no hit',async()=>{
  const f=fixture();await f.run();
  const directory=resolve(f.cache,'.author-bundles');
  const recipe=readdirSync(directory)[0];if(recipe===undefined)throw new Error('Missing compiler recipe');
  const at=resolve(directory,recipe),file=readdirSync(at).find(name=>name.endsWith('.json'));
  if(file===undefined)throw new Error('Missing compiler payload');
  writeFileSync(resolve(at,file),'{}');
  expect((await f.run()).reused).toBe(false);expect(f.calls()).toBe(2);
  await expect(authorBundleCached(f.root,['failed'],()=>Promise.reject(new Error('Compiler refused')),f.cache)).rejects.toThrow('Compiler refused');
  const recovered=await authorBundleCached(f.root,['failed'],f.compile,f.cache);
  expect(recovered.reused).toBe(false);
});

test('separates build-time environment while ignoring run metadata',async()=>{
  const f=fixture();await f.run();
  vi.stubEnv('GITHUB_RUN_ID','a-new-run');
  expect((await f.run()).reused).toBe(true);
  vi.stubEnv('VITE_COMPILER_FIXTURE','changed');
  expect((await f.run()).reused).toBe(false);
});
