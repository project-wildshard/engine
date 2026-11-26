// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real compiler cache/input evidence in owned scratch.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine cache fixtures to this checkout.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A foreign writer must bypass the compiler's declared writes.
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { authorBundleCached } from '../src/scripts/author-bundle-cache.mjs';
import { captureFolderInputs, folderInputKey, recordBundle, recordResolution } from '../src/scripts/shardfile-inputs.mjs';
import { InputHashMemo } from '../src/scripts/bake-input-hashes.mjs';

const owned:string[]=[];
const scratch=resolve('tmp/codex-pagesize');mkdirSync(scratch,{recursive:true});
afterEach(()=>{vi.unstubAllEnvs();for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture() {
  const root=mkdtempSync(resolve(scratch,'author-bundle-'));owned.push(root);
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
  await captureFolderInputs(f.root,receipt,async()=>{
    const bundle=await f.run();expect(bundle.reused).toBe(true);
    recordBundle({output:[{type:'chunk',moduleIds:bundle.modules}]},{execution:true});
  });
  expect(folderInputKey(f.root,receipt,[],new InputHashMemo(f.root))).toBeDefined();
  writeFileSync(resolve(f.root,'dependency.ts'),'export const added=true;');
  expect(folderInputKey(f.root,receipt,[],new InputHashMemo(f.root))).toBeUndefined();
});

test('a replayed compiler still refuses a foreign edit before the product finishes',async()=>{
  const f=fixture();await f.run();
  await expect(captureFolderInputs(f.root,resolve(f.root,'product.json'),async()=>{
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

// ENG-19: a J196 linked checkout lives outside the root, where receipts never look; its contents key the cache.
function linkedFixture(git:boolean) {
  const f=fixture(),linked=mkdtempSync(resolve(scratch,'author-bundle-linked-'));owned.push(linked);
  const file=resolve(linked,'src/index.ts');
  mkdirSync(resolve(linked,'src'),{recursive:true});writeFileSync(file,'export const sdk=1;');
  if(git){
    const run=(...args:string[])=>execFileSync('git',['-C',linked,...args],{stdio:'ignore'});
    run('init','-q');run('add','-A');run('-c','user.name=t','-c','user.email=t@t','commit','-qm','init','--no-verify');
  }
  mkdirSync(resolve(f.root,'node_modules/@wildshard'),{recursive:true});
  symlinkSync(linked,resolve(f.root,'node_modules/@wildshard/sharddev'));
  return {...f,file};
}

test.each([['a git checkout',true],['a plain directory',false]])('an edit in a linked package (%s) rebuilds without a VITE_ nudge',async(_name,git)=>{
  const f=linkedFixture(git);
  expect((await f.run()).reused).toBe(false);
  expect((await f.run()).reused).toBe(true);
  writeFileSync(f.file,'export const sdk=22;');
  expect((await f.run()).reused).toBe(false);expect(f.calls()).toBe(2);
  expect((await f.run()).reused).toBe(true);
});

test('a linked git checkout keys on new untracked files and HEAD moves too',async()=>{
  const f=linkedFixture(true),linked=resolve(f.file,'../..');
  await f.run();
  writeFileSync(resolve(linked,'src/added.ts'),'export const added=1;');
  expect((await f.run()).reused).toBe(false);
  execFileSync('git',['-C',linked,'add','-A'],{stdio:'ignore'});
  execFileSync('git',['-C',linked,'-c','user.name=t','-c','user.email=t@t','commit','-qm','next','--no-verify'],{stdio:'ignore'});
  expect((await f.run()).reused).toBe(false);
  expect((await f.run()).reused).toBe(true);
});

test('a linked edit during compilation publishes no bundle',async()=>{
  const f=linkedFixture(false);
  await expect(authorBundleCached(f.root,['racing'],async()=>{const bundle=await f.compile();writeFileSync(f.file,'export const sdk=333;');return bundle;},f.cache)).rejects.toThrow('Author compiler inputs changed');
});

// EV8: ordinary writes can retain both the byte count and timestamp (copy tools,
// editors and generated code). A cache hit must still mean the linked bytes match.
test.each(['untracked', 'ignored file', 'ignored folder', 'plain directory'])('unchanged metadata cannot hide linked content edits: %s', async kind => {
  const f = linkedFixture(kind !== 'plain directory'), linked = resolve(f.file, '../..');
  const file = kind === 'ignored folder' ? resolve(linked, 'src/generated/index.ts') : f.file;
  const git = (...args: string[]): void => { execFileSync('git', ['-C', linked, ...args], { stdio: 'ignore' }); };
  if (kind === 'untracked' || kind === 'ignored file') git('rm', '--cached', 'src/index.ts');
  if (kind.startsWith('ignored')) {
    writeFileSync(resolve(linked, '.gitignore'), kind === 'ignored folder' ? 'src/generated/\n' : 'src/index.ts\n');
    git('add', '.gitignore');
  }
  if (kind !== 'plain directory') git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'fixture', '--no-verify');
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, 'export const sdk=1;');
  const stamp = new Date('2026-01-01T00:00:00.000Z'); utimesSync(file, stamp, stamp);
  const compile = async (): Promise<{ code: string; modules: string[] }> => {
    const own = await f.compile();
    return { code: own.code + readFileSync(file, 'utf8'), modules: [...own.modules, file] };
  };
  const run = (): ReturnType<typeof authorBundleCached> => authorBundleCached(f.root, ['linked-byte-control'], compile, f.cache);
  expect((await run()).code).toContain('sdk=1'); expect((await run()).reused).toBe(true);
  writeFileSync(file, 'export const sdk=2;'); utimesSync(file, stamp, stamp);
  const changed = await run();
  expect(changed.reused).toBe(false); expect(changed.code).toContain('sdk=2');
  expect((await run()).reused).toBe(true);
});


test('unrelated ignored checkout build outputs do not race or invalidate a linked compiler', async () => {
  const f = linkedFixture(true), linked = resolve(f.file, '../..'), output = resolve(linked, 'out/generated.json');
  writeFileSync(resolve(linked, '.gitignore'), 'out/\n.tsc-layers/\ndist*/\n');
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, '{"build":1}');
  const compile = async (): Promise<{ code: string; modules: string[] }> => {
    const bundle = await f.compile();
    writeFileSync(output, '{"build":2}');
    return bundle;
  };
  const run = (): ReturnType<typeof authorBundleCached> => authorBundleCached(f.root, ['artifact-race'], compile, f.cache);
  expect((await run()).reused).toBe(false);
  writeFileSync(output, '{"build":3}');
  expect((await run()).reused).toBe(true);
});

test('a compiler importing ignored checkout output always rebuilds', async () => {
  const f = linkedFixture(true), linked = resolve(f.file, '../..'), output = resolve(linked, 'dist/generated.ts');
  writeFileSync(resolve(linked, '.gitignore'), 'dist/\n');
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, 'export const built=1;');
  const compile = async (): Promise<{ code: string; modules: string[] }> => {
    const bundle = await f.compile();
    return { code: bundle.code + readFileSync(output, 'utf8'), modules: [...bundle.modules, output] };
  };
  const run = (): ReturnType<typeof authorBundleCached> => authorBundleCached(f.root, ['imported-artifact'], compile, f.cache);
  expect((await run()).reused).toBe(false);
  expect((await run()).reused).toBe(false);
  writeFileSync(output, 'export const built=2;');
  const changed = await run();
  expect(changed.reused).toBe(false); expect(changed.code).toContain('built=2');
});
