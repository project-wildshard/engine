// oxlint-disable-next-line import/no-nodejs-modules -- Prove native Node ESM loading, outside Vitest's module transformer.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the tiny compiler/input fixtures.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only explicit fixture and tool paths.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Give the native loader an absolute module URL.
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function native(source: string, args: readonly string[] = []): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict';
    const {importBundle}=await import(process.argv[1]);
    ${source}`, pathToFileURL(resolve('scripts/import-bundle.mjs')).href, ...args], { encoding: 'utf8', timeout: 15_000 });
}

test('concurrent raw modules preserve Unicode, native imports and calls after source cleanup', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/import-bundle-dependency-')); owned.push(root);
  const dependency = resolve(root, 'dependency.mjs'); writeFileSync(dependency, "export const value='external';");
  expect(native(`
    import {existsSync} from 'node:fs'; import {dirname} from 'node:path'; import {fileURLToPath} from 'node:url';
    const dependency=JSON.stringify(process.argv[2]);
    const source="import {basename} from 'node:path'; import {value} from "+dependency+"; export const url=import.meta.url; export const text='舟 🌲 é'; export async function run(){return (await import("+dependency+")).value;} export const name=basename('/one/two')+value;";
    const [first,second]=await Promise.all([importBundle(source),importBundle(source)]);
    assert.notEqual(first.url,second.url);
    for(const module of [first,second]) {
      assert.equal(module.text,'舟 🌲 é'); assert.equal(module.name,'twoexternal'); assert.equal(await module.run(),'external');
      assert.equal(existsSync(dirname(fileURLToPath(module.url))),false);
    }
  `, [pathToFileURL(dependency).href])).toBe('');
});

test('syntax, evaluation and top-level asynchronous failures remove only their owned modules', () => {
  expect(native(`
    import {registerHooks} from 'node:module'; import {existsSync} from 'node:fs';
    import {dirname} from 'node:path'; import {fileURLToPath} from 'node:url';
    const attempted=[]; const hook=registerHooks({load(url,context,next){
      if(url.includes('/tmp/author-module-')&&url.endsWith('/bundle.mjs'))attempted.push(url);
      return next(url,context);
    }});
    try {
      await assert.rejects(importBundle('export const ='),SyntaxError);
      await assert.rejects(importBundle("throw new Error('evaluation refusal')"),/evaluation refusal/);
      await assert.rejects(importBundle("await Promise.reject(new Error('async refusal'))"),/async refusal/);
      assert.equal(attempted.length,3);
      for(const url of attempted)assert.equal(existsSync(dirname(fileURLToPath(url))),false);
    } finally {hook.deregister();}
  `)).toBe('');
});

test.each([false, true])('compiler function text keeps original input identities after cleanup: %s', inspect => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/import-bundle-inputs-')); owned.push(root);
  const compiler = resolve(root, 'compiler.mjs');
  writeFileSync(compiler, '/** original docs */ export const compile=()=>1;');
  expect(native(`
    import {readFileSync,writeFileSync} from 'node:fs';
    const {captureProductInputs,recordBundle,productInputKey}=await import(process.argv[2]);
    const {InputHashMemo}=await import(process.argv[3]);
    const root=process.argv[4],compiler=root+'/compiler.mjs',receipt=root+'/receipt.json',source=readFileSync(compiler,'utf8');
    await captureProductInputs(root,receipt,async()=>{
      recordBundle({output:[{type:'chunk',moduleIds:[compiler]}]},{execution:true});
      const module=await importBundle(source);
      assert.equal(module.compile(),1);
      ${inspect ? 'module.compile.toString();' : ''}
    });
    const saved=JSON.parse(readFileSync(receipt,'utf8'));
    assert.equal(saved.inputs.some(row=>row.includes('author-module-')),false);
    const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),before=key();
    assert.match(before,/^[a-f0-9]{64}$/u);
    writeFileSync(compiler,'/** changed docs */ export const compile=()=>1;');
    ${inspect ? 'assert.equal(key(),undefined);' : 'assert.equal(key(),before);'}
    writeFileSync(compiler,'/** original docs */ export const compile=()=>2;');assert.equal(key(),undefined);
  `, [pathToFileURL(resolve('scripts/shardfile-inputs.mjs')).href, pathToFileURL(resolve('scripts/bake-input-hashes.mjs')).href, root])).toBe('');
});
