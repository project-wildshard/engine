// oxlint-disable-next-line import/no-nodejs-modules -- Owned compiler input fixtures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise promise reads in the recorder.
import { readFile } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Simulate an external writer outside the recorder's process.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture subprocess runtime.
import process from 'node:process';
import { afterEach, expect, it } from 'vitest';
import { captureProductInputs, productInputKey, productToolchainKey, recordBundle, recordModuleInput, recordResolution, inputRecorderPlugin, matchingProductInputKey, publishProductInputs, replayProductInputs } from '../scripts/shardfile-inputs.mjs';
import { InputHashMemo } from '../scripts/bake-input-hashes.mjs';
import { build } from '../scripts/shardfile-vite.mjs';
import {build as buildCompiler} from 'vite';
import * as v from 'valibot';
import { createProjectGeneration } from '../src/sharddev/projectGeneration';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): string {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/product-inputs-')); owned.push(root);
  for (const path of ['src/engine', 'src/sharddev', 'src/format', 'assets']) mkdirSync(resolve(root,path), { recursive: true });
  for (const path of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml']) writeFileSync(resolve(root,path),'{}');
  writeFileSync(resolve(root,'entry.ts'), "import {value} from './src/engine/used'; export const answer=value;\n");
  writeFileSync(resolve(root,'src/engine/used.ts'),'export const value=1;\n');
  writeFileSync(resolve(root,'asset.txt'),'asset'); return root;
}
it('receipts include step keys and explicit inputs without depending on cached files', async () => {
  const root=fixture(), receipt=resolve(root,'receipt.json'), cache=resolve(root,'.cache'), memo=new InputHashMemo(root);
  await captureProductInputs(root,receipt,async()=>{
    const ctx=createProjectGeneration(root,'a'.repeat(64),new Map(),cache);
    await ctx.cached({id:'fixture',inputs:['asset.txt']},inputs=>inputs);
    recordBundle({output:[]});
  });
  const rows=v.parse(v.object({inputs:v.array(v.string())}),JSON.parse(readFileSync(receipt,'utf8')));
  expect(rows.inputs.some(entry=>/^G [a-f0-9]{64}$/u.test(entry))).toBe(true);
  expect(rows.inputs.some(entry=>entry.includes('.cache'))).toBe(false);
  const key=productInputKey(root,receipt,[],memo); expect(key).toMatch(/^[a-f0-9]{64}$/u);
  rmSync(cache,{recursive:true}); expect(productInputKey(root,receipt,[],memo)).toBe(key);
  writeFileSync(resolve(root,'asset.txt'),'changed'); expect(productInputKey(root,receipt,[],memo)).toBeUndefined();
});
it('keys native-bundled modules, sync and async reads, negative probes and real directory inventories only', async () => {
  const root = fixture(), receipt = resolve(root,'receipt.json'), memo = new InputHashMemo(root);
  await captureProductInputs(root,receipt,async () => {
    readFileSync(resolve(root,'asset.txt')); await readFile(resolve(root,'asset.txt'));
    existsSync(resolve(root,'optional.json')); readdirSync(resolve(root,'assets'));
    await build({root,configFile:false,publicDir:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:resolve(root,'entry.ts'),formats:['es'],fileName:'fixture'}}});
  });
  const key = () => productInputKey(root,receipt,[],memo), before = key(); expect(before).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(resolve(root,'src/engine/unread.generated.ts'),'unread'); expect(key()).toBe(before);
  writeFileSync(resolve(root,'src/engine/used.ts'),'export const value=2;\n'); expect(key()).toBeUndefined();
  writeFileSync(resolve(root,'src/engine/used.ts'),'export const value=1;\n'); expect(key()).toBe(before);
  writeFileSync(resolve(root,'optional.json'),'{}'); expect(key()).toBeUndefined(); rmSync(resolve(root,'optional.json'));
  writeFileSync(resolve(root,'assets/new.txt'),'new'); expect(key()).toBeUndefined(); rmSync(resolve(root,'assets/new.txt'));
  expect(productInputKey(root,receipt,['--other-flags'],memo)).not.toBe(key());
  expect(productInputKey(root,receipt,[],new InputHashMemo(fixture()))).toBeUndefined();
  rmSync(resolve(root,'asset.txt'));mkdirSync(resolve(root,'asset.txt'));
  expect(key()).toBeUndefined();rmSync(resolve(root,'asset.txt'),{recursive:true});
  symlinkSync('entry.ts',resolve(root,'asset.txt'));
  expect(key()).toBeUndefined();rmSync(resolve(root,'asset.txt'));writeFileSync(resolve(root,'asset.txt'),'asset');
  expect(key()).toBe(before);
  writeFileSync(receipt,'{}'); expect(key()).toBeUndefined();
});

it('keeps another revision from replacing a matching captured read set', async () => {
  const first=fixture(), second=fixture(), directory=resolve(first,'receipts'), recipe=['same-product'];
  writeFileSync(resolve(second,'asset.txt'),'second');
  const receipts=[];
  for(const root of [first,second]) {
    const receipt=resolve(root,'trace.json'), memo=new InputHashMemo(root);
    await captureProductInputs(root,receipt,()=>{readFileSync(resolve(root,'asset.txt'));recordBundle({output:[]});return Promise.resolve();});
    const key=productInputKey(root,receipt,recipe,memo); if(key===undefined)throw new Error('Fixture requires a complete receipt');
    publishProductInputs(directory,receipt,key);receipts.push(key);
  }
  expect(receipts[0]).not.toBe(receipts[1]);
  expect(matchingProductInputKey(first,directory,recipe,new InputHashMemo(first))).toBe(receipts[0]);
  expect(matchingProductInputKey(second,directory,recipe,new InputHashMemo(second))).toBe(receipts[1]);
  writeFileSync(resolve(first,'asset.txt'),'third');
  expect(matchingProductInputKey(first,directory,recipe,new InputHashMemo(first))).toBeUndefined();
});
it('keys compiler writes, refuses concurrent source edits and rejects incomplete traces', async () => {
  const root = fixture(), receipt = resolve(root,'receipt.json');
  await expect(captureProductInputs(root,receipt,() => {
    readFileSync(resolve(root,'asset.txt')); writeFileSync(resolve(root,'asset.txt'),'changed');
    recordBundle({output:[]}); return Promise.resolve();
  })).resolves.toBeUndefined(); // declared compiler writes are keyed by their resulting bytes
  await expect(captureProductInputs(root,receipt,() => {
    readFileSync(resolve(root,'asset.txt'));
    execFileSync(process.execPath,['-e', 'require("node:fs").writeFileSync(process.argv[1],"external")',resolve(root,'asset.txt')]);
    recordBundle({output:[]}); return Promise.resolve();
  })).rejects.toThrow('Product input changed during build');
  await expect(captureProductInputs(root,receipt,() => Promise.resolve())).rejects.toThrow('Incomplete');
});

it('replay keeps an earlier observation and refuses a crossed product scope',async()=>{
  const root=fixture(),receipt=resolve(root,'compiler.json'),other=fixture(),source=resolve(root,'asset.txt');
  await captureProductInputs(root,receipt,()=>{readFileSync(source);recordBundle({output:[]});return Promise.resolve();});
  await expect(captureProductInputs(other,resolve(other,'product.json'),()=>{
    replayProductInputs(root,receipt);recordBundle({output:[]});return Promise.resolve();
  })).rejects.toThrow('Invalid compiler input receipt');
  await expect(captureProductInputs(root,resolve(root,'product.json'),async()=>{
    readFileSync(source);
    execFileSync(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],"changed")',source]);
    await captureProductInputs(root,receipt,()=>{readFileSync(source);recordBundle({output:[]});return Promise.resolve();});
    replayProductInputs(root,receipt);recordBundle({output:[]});
  })).rejects.toThrow('Product input changed during build');
});
it('keys workspace installation while complete receipts own SDK and format source freshness', () => {
  const root = fixture(), memo = new InputHashMemo(root), key = () => productToolchainKey(root,memo), before = key();
  writeFileSync(resolve(root,'src/sharddev/unread.generated.ts'),'generated'); expect(key()).toBe(before);
  writeFileSync(resolve(root,'src/sharddev/compiler.ts'),'compiler'); expect(key()).toBe(before);
  writeFileSync(resolve(root,'src/format/schema.ts'),'schema'); expect(key()).toBe(before);
  writeFileSync(resolve(root,'pnpm-lock.yaml'),'changed dependency installation');expect(key()).not.toBe(before);
});

it('invalidates when a new native directory entry can take precedence', async () => {
  const root=fixture(), receipt=resolve(root,'receipt.json'), memo=new InputHashMemo(root);
  mkdirSync(resolve(root,'module'));
  writeFileSync(resolve(root,'module/index.ts'),'export const value=1;');
  writeFileSync(resolve(root,'entry.ts'),"import {value} from './module'; export const answer=value;");
  await captureProductInputs(root,receipt,async()=>{
    await build({root,configFile:false,publicDir:false,logLevel:'silent',build:{write:false,lib:{entry:resolve(root,'entry.ts'),formats:['es'],fileName:'fixture'}}});
  });
  const before=productInputKey(root,receipt,[],memo); expect(before).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(resolve(root,'module/index.mts'),'export const value=2;');
  expect(productInputKey(root,receipt,[],memo)).not.toBe(before);
});

it('keeps package metadata as content when native resolution changes its main entry',async()=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),packageFile=resolve(root,'module/package.json');
  mkdirSync(resolve(root,'module'));writeFileSync(packageFile,JSON.stringify({main:'a.js'}));
  writeFileSync(resolve(root,'module/a.js'),'export const value=1;');writeFileSync(resolve(root,'module/b.js'),'export const value=2;');
  writeFileSync(resolve(root,'entry.ts'),"import {value} from './module';export const answer=value;");
  await captureProductInputs(root,receipt,async()=>{
    const result=await build({root,configFile:false,publicDir:false,logLevel:'silent',build:{write:false,lib:{entry:resolve(root,'entry.ts'),formats:['es'],fileName:'fixture'}}});
    const output=Array.isArray(result)?result.at(0):result;
    if(output===undefined||!('output'in output))throw new Error('Missing native fixture output');
    const chunk=output.output.find(row=>row.type==='chunk');if(chunk===undefined)throw new Error('Missing native fixture chunk');
    const value=v.parse(v.object({answer:v.number()}),await import(`data:text/javascript,${encodeURIComponent(chunk.code)}`));expect(value.answer).toBe(1);
  });
  const memo=new InputHashMemo(root);expect(productInputKey(root,receipt,[],memo)).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(packageFile,JSON.stringify({main:'b.js'}));expect(productInputKey(root,receipt,[],memo)).toBeUndefined();
});

it('rechecks absent descendants after a file parent becomes a directory', async () => {
  const root=fixture(), receipt=resolve(root,'receipt.json'), memo=new InputHashMemo(root);
  await captureProductInputs(root,receipt,()=>{
    existsSync(resolve(root,'asset.txt/child.ts'));recordBundle({output:[]});return Promise.resolve();
  });
  const before=productInputKey(root,receipt,[],memo);expect(before).toMatch(/^[a-f0-9]{64}$/u);
  rmSync(resolve(root,'asset.txt'));mkdirSync(resolve(root,'asset.txt'));
  writeFileSync(resolve(root,'asset.txt/child.ts'),'new input');
  expect(productInputKey(root,receipt,[],memo)).toBeUndefined();
});

it('keys existence probes without treating them as source-content reads',async()=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),source=resolve(root,'entry.ts');
  await captureProductInputs(root,receipt,()=>{existsSync(source);recordBundle({output:[]});return Promise.resolve();});
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),before=key();expect(before).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(source,'// changed source, same existence');expect(key()).toBe(before);
  rmSync(source);expect(key()).toBeUndefined();
});

it('separates unselected resolution candidates from loaded source bytes',async()=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),candidate=resolve(root,'src/engine/used.ts');
  await captureProductInputs(root,receipt,()=>{
    recordResolution('./src/engine/used',resolve(root,'entry.ts'));
    recordModuleInput(resolve(root,'entry.ts'));recordBundle({output:[]});return Promise.resolve();
  });
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),before=key();expect(before).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(candidate,'// unused candidate changed');expect(key()).toBe(before);
  writeFileSync(resolve(root,'src/engine/used.js'),'export const value=2;');expect(key()).toBeUndefined();
  rmSync(resolve(root,'src/engine/used.js'));expect(key()).toBe(before);
  writeFileSync(resolve(root,'entry.ts'),'// loaded source changed');expect(key()).toBeUndefined();
});

it.each(['execution','source','function-text'])('keeps %s compiler dependencies in their proper identity domain', mode => {
  const root=fixture(),compiler=resolve(root,'compiler.mjs'),receipt=resolve(root,'receipt.json');
  const initial='/** initial documentation */\nexport function compile(){return 1;}\n';
  writeFileSync(compiler,initial);
  const script=`import fs from 'node:fs';import {pathToFileURL}from'node:url';
    const {installInputRecorder,captureProductInputs,recordBundle}=await import(process.argv[3]);
    installInputRecorder();const compiler=await import(pathToFileURL(process.argv[1]).href);
    await captureProductInputs(process.argv[4],process.argv[2],()=>{
      compiler.compile();
      ${mode==='source'?"fs.readFileSync(process.argv[1]);":mode==='function-text'?"compiler.compile.toString();":''}
      recordBundle({output:[]});return Promise.resolve();
    });`;
  execFileSync(process.execPath,['--input-type=module','-e',script,compiler,receipt,resolve('scripts/shardfile-inputs.mjs'),root],{encoding:'utf8'});
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),before=key();
  expect(before).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(compiler,initial.replace('initial documentation','additional compiler documentation'));
  if(mode==='execution')expect(key()).toBe(before);else expect(key()).toBeUndefined();
  writeFileSync(compiler,initial.replace('return 1','return 2'));expect(key()).toBeUndefined();
});

it.each([true,false])('keeps native compiler execution %s separate from raw runtime bytes',async execution=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),compiler=resolve(root,'src/sharddev/compiler.ts');
  const before='/** compiler docs */ export const compile=()=>1;';writeFileSync(compiler,before);
  await captureProductInputs(root,receipt,async()=>{
    const result=await buildCompiler({root,configFile:false,publicDir:false,logLevel:'silent',plugins:[inputRecorderPlugin({execution})],build:{write:false,minify:false,lib:{entry:compiler,formats:['es'],fileName:'compiler'}}});
    recordBundle(result,{execution});
  });
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),initial=key();expect(initial).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(compiler,before.replace('compiler docs','changed compiler docs'));
  if(execution)expect(key()).toBe(initial);else expect(key()).toBeUndefined();
  writeFileSync(compiler,before.replace('()=>1','()=>2'));expect(key()).toBeUndefined();
});
it.each([false,true])('keys an explicitly executed author declaration separately from runtime source: %s',async execution=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),compiler=resolve(root,'src/sharddev/compiler.ts');
  const source='/** declaration documentation */ export const value=1;';writeFileSync(compiler,source);
  await captureProductInputs(root,receipt,async()=>{
    await build({root,configFile:false,publicDir:false,logLevel:'silent',plugins:execution?[{name:'wildshard-author-execution',api:{wildshardInputIdentity:'execution'}}]:[],build:{write:false,minify:false,lib:{entry:compiler,formats:['es'],fileName:'config'}}});
  });
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),initial=key();expect(initial).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(compiler,source.replace('declaration documentation','revised declaration documentation'));
  if(execution)expect(key()).toBe(initial);else expect(key()).toBeUndefined();
  writeFileSync(compiler,source.replace('value=1','value=2'));expect(key()).toBeUndefined();
});
it.each([false,true])('guards function text after the native bundle execution boundary: %s',async executed=>{
  const root=fixture(),receipt=resolve(root,'receipt.json'),compiler=resolve(root,'src/sharddev/compiler.ts');
  const source='/** first docs */ export const compile=()=>1;';writeFileSync(compiler,source);
  const bundled=v.parse(v.object({compile:v.function()}),await import(`data:text/javascript,${encodeURIComponent(source)}`));
  await captureProductInputs(root,receipt,()=>{
    recordModuleInput(compiler,{execution:true});
    if(executed)recordBundle({output:[{type:'chunk',moduleIds:[compiler]}]},{execution:true});
    const callback=executed?bundled.compile:()=>1;callback.toString();
    recordBundle({output:[]});return Promise.resolve();
  });
  const memo=new InputHashMemo(root),key=()=>productInputKey(root,receipt,[],memo),initial=key();expect(initial).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(compiler,source.replace('first docs','changed docs'));
  if(executed)expect(key()).toBeUndefined();else expect(key()).toBe(initial);
});

it('injected input inventory receipts observe nested additions and removals without reading payloads', async () => {
  const root = fixture(), receipt = resolve(root, 'inventory-receipt.json'), assets = resolve(root, 'assets');
  mkdirSync(resolve(assets, 'nested')); writeFileSync(resolve(assets, 'one.webp'), 'original');
  writeFileSync(resolve(assets, 'nested/two.webp'), 'two');
  await captureProductInputs(root, receipt, () => {
    const ctx = createProjectGeneration(root, 'c'.repeat(64), new Map(), resolve(root, '.cache'), [{ prefix: '/assets/', directory: assets }]);
    const list = ctx.inputFiles; if (list === undefined) throw new Error('Current SDK must supply inputFiles');
    expect(list(['/assets/'])).toEqual(['/assets/nested/two.webp', '/assets/one.webp']);
    recordBundle({ output: [] }); return Promise.resolve();
  });
  const memo = new InputHashMemo(root), key = productInputKey(root, receipt, [], memo);
  expect(key).toMatch(/^[a-f0-9]{64}$/u);
  writeFileSync(resolve(assets, 'one.webp'), 'changed payload size and content');
  expect(productInputKey(root, receipt, [], memo)).toBe(key);
  writeFileSync(resolve(assets, 'nested/new.webp'), 'new');
  expect(productInputKey(root, receipt, [], memo)).toBeUndefined();
  rmSync(resolve(assets, 'nested/new.webp'));
  expect(productInputKey(root, receipt, [], memo)).toBe(key);
  rmSync(resolve(assets, 'one.webp'));
  expect(productInputKey(root, receipt, [], memo)).toBeUndefined();
});
