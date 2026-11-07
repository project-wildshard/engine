// oxlint-disable-next-line import/no-nodejs-modules -- Owned isolated producer fixtures.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real Node preload/load and filesystem boundaries.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Exact executable for the child producer.
import process from 'node:process';
import {afterEach,expect,it} from 'vitest';
import * as v from 'valibot';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(source:string,preload=true) {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/generation-recorder-'));owned.push(root);
  writeFileSync(resolve(root,'entry.mjs'),source);
  writeFileSync(resolve(root,'used.mjs'),'export const value=1;');
  writeFileSync(resolve(root,'raw.ts'),'// raw source data');
  writeFileSync(resolve(root,'unread.ts'),'// unrelated SDK module');
  const receipt=resolve(root,'reads.json');
  const child=spawnSync(process.execPath,[...(preload?['--import',resolve('test/fixtures/input-read-preload.mjs')]:[]),'entry.mjs'],{
    cwd:root,env:{...process.env,WS_GENERATION_READ_RECEIPT:receipt},encoding:'utf8',
  });
  return {root,receipt,child,read:()=>v.parse(v.object({schema:v.literal('generation-reads/4'),files:v.array(v.string()),execution:v.array(v.string()),packages:v.record(v.string(),v.array(v.string())),inventory:v.array(v.string()),opaque:v.array(v.string()),seal:v.string()}),JSON.parse(readFileSync(receipt,'utf8')))};
}
it('records imports and descriptor-based raw reads without consuming unrelated source modules',()=>{
  const {child,read}=fixture("import{value}from'./used.mjs';import fs from'node:fs';const fd=fs.openSync('raw.ts','r');fs.readSync(fd,Buffer.alloc(1),0,1,null);fs.closeSync(fd);fs.writeFileSync('output.json',JSON.stringify(value));");
  expect(child.status,child.stderr).toBe(0);const trace=read();
  expect(trace.execution).toContain('entry.mjs');expect(trace.execution).toContain('used.mjs');expect(trace.files).toContain('raw.ts');
  expect(trace.files).not.toContain('unread.ts');expect(trace.opaque).toEqual([]);expect(trace.inventory.filter(probe=>!probe.startsWith('P ')||!trace.execution.includes(probe.slice(2))),JSON.stringify(trace.inventory)).toEqual([]);
});
it('records hidden loader data and negative probes inside the load callback',()=>{
  const source=`import fs from 'node:fs';import{registerHooks}from'node:module';registerHooks({load(url,context,next){if(url.endsWith('/used.mjs')){fs.readFileSync('unread.ts');fs.existsSync('missing.ts');}return next(url,context);}});const{startGenerationInputTrace}=await import(${JSON.stringify(resolve('scripts/shardfile-inputs.mjs'))});startGenerationInputTrace(process.cwd(),process.env.WS_GENERATION_READ_RECEIPT);await import('./used.mjs');`;
  const {child,read}=fixture(source,false);expect(child.status,child.stderr).toBe(0);
  const trace=read();expect(trace.files).toContain('unread.ts');expect(trace.inventory).toContain('P missing.ts');
});
it.each([true,false])('uses a proven installed store root for external probes: linked=%s',linked=>{
  const source=`import fs from'node:fs';import{resolve}from'node:path';const stage=resolve('stage'),store=resolve('installed');fs.mkdirSync(store+'/dep@1/node_modules/dep',{recursive:true});fs.mkdirSync(stage+'/node_modules',{recursive:true});${linked?"fs.symlinkSync(store,stage+'/node_modules/.pnpm','dir');":''}const{startGenerationInputTrace}=await import(${JSON.stringify(resolve('scripts/shardfile-inputs.mjs'))});startGenerationInputTrace(stage,process.env.WS_GENERATION_READ_RECEIPT);fs.existsSync(store+'/dep@1/node_modules/dep/missing.js');fs.existsSync(resolve(stage,'../unrelated.txt'));`;
  const {child,read}=fixture(source,false);expect(child.status,child.stderr).toBe(0);
  expect(read().inventory).toContain(linked?'P node_modules/.pnpm/dep@1/node_modules/dep/missing.js':'P ../installed/dep@1/node_modules/dep/missing.js');
  expect(read().inventory).toContain('P ../unrelated.txt');
});
it.each([
  "import fs from 'node:fs';fs.existsSync('missing.ts');",
  "import fs from 'node:fs';fs.readdirSync('.');",
  "import fs from 'node:fs';try{fs.realpathSync.native('missing.ts');}catch{}",
  "import fs from 'node:fs';fs.globSync('*.ts');",
  "import fs from 'node:fs/promises';for await(const file of fs.glob('*.ts'))void file;",
  "try{await import('./missing.mjs');}catch{}",
])('retains an inventory fence for filesystem probes: %s',source=>{
  const {child,read}=fixture(source);expect(child.status,child.stderr).toBe(0);expect(read().inventory.length).toBeGreaterThan(0);
});
it.each(['fs','node:fs'])('keeps builtin %s resolution independent of staged filenames',name=>{
  const {child,read}=fixture(`import{createRequire}from'node:module';createRequire(import.meta.url)(${JSON.stringify(name)});`);
  expect(child.status,child.stderr).toBe(0);expect(read().inventory).not.toContain('R commonjs-resolution');expect(read().opaque).toEqual([]);
});
it.each([
  ["fs.readdirSync('listed')",'L'],
  ["fs.readdirSync('listed','utf8')",'L'],
  ["await fs.promises.readdir('listed')",'L'],
  ["await new Promise((resolve,reject)=>fs.readdir('listed',(error,names)=>error?reject(error):resolve(names)))",'L'],
  ["const dir=fs.opendirSync('listed');dir.closeSync()",'L'],
  ["const dir=await fs.promises.opendir('listed');await dir.close()",'L'],
  ["fs.readdirSync('listed',{})",'D'],
  ["fs.readdirSync('listed',{recursive:true})",'D'],
  ["await fs.promises.readdir('listed',{recursive:true})",'D'],
])('records the directory scope of %s', (call,kind)=>{
  const {child,read}=fixture(`import fs from 'node:fs';fs.mkdirSync('listed');${call};`);
  expect(child.status,child.stderr).toBe(0);
  expect(read().inventory).toContain(`${kind} listed`);
  expect(read().inventory).not.toContain(`${kind==='L'?'D':'L'} listed`);
});
it('keeps builtin-looking imports redirected to a real file conservative',()=>{
  const source=`import{createRequire,registerHooks}from'node:module';registerHooks({resolve(specifier,context,next){if(specifier==='node:path'&&context.parentURL===import.meta.url)return{url:new URL('./used.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});const{startGenerationInputTrace}=await import(${JSON.stringify(resolve('scripts/shardfile-inputs.mjs'))});startGenerationInputTrace(process.cwd(),process.env.WS_GENERATION_READ_RECEIPT);createRequire(import.meta.url)('node:path');`;
  const {child,read}=fixture(source,false);expect(child.status,child.stderr).toBe(0);
  expect(read().inventory).toContain('R commonjs-resolution');
});
it('does not inspect directory option getters before the filesystem does',()=>{
  const source="import fs from 'node:fs';fs.mkdirSync('listed/nested',{recursive:true});fs.writeFileSync('listed/nested/file.txt','value');let calls=0;const options={get recursive(){calls++;return calls===1;}};console.log(JSON.stringify({names:fs.readdirSync('listed',options),calls}));";
  const plain=fixture(source,false),traced=fixture(source);
  expect(plain.child.status,plain.child.stderr).toBe(0);expect(traced.child.status,traced.child.stderr).toBe(0);
  expect(traced.child.stdout).toBe(plain.child.stdout);
  expect(traced.read().inventory).toContain('D listed');
});
it('records raw CommonJS and required JSON through synchronous load hooks',()=>{
  const {child,read}=fixture("import fs from'node:fs';import{createRequire}from'node:module';fs.writeFileSync('rows.json','{\"value\":1}');fs.writeFileSync('nested.cjs',\"module.exports=require('./rows.json');\");createRequire(import.meta.url)('./nested.cjs');");
  expect(child.status,child.stderr).toBe(0);const trace=read();
  expect(trace.files).toContain('nested.cjs');expect(trace.files).toContain('rows.json');
  expect(trace.execution).not.toContain('nested.cjs');expect(trace.inventory).toContain('R commonjs-module');expect(trace.opaque).toEqual([]);
});
it.each([
  ["import{spawnSync}from'node:child_process';spawnSync(process.execPath,['-e',\"require('fs').readFileSync('unread.ts')\"]);",'child-process'],
  ["try{process.dlopen({exports:{}},'missing-native-addon.node');}catch{}",'native-addon'],
  ["import{Worker}from'node:worker_threads';const worker=new Worker('',{eval:true});await worker.terminate();",'worker'],
  ["import{createServer}from'node:http';createServer().close();",'network'],
])('marks opaque I/O for the conservative fallback: %s',(source,reason)=>{
  const {child,read}=fixture(source);expect(child.status,child.stderr).toBe(0);expect(read().opaque).toContain(reason);
});
it('permits pure builtin imports and immutable data-URL fetches',()=>{
  const {child,read}=fixture("import{isMainThread}from'node:worker_threads';import'node:http';await fetch('data:text/plain,pinned');if(!isMainThread)throw new Error('wrong thread');");
  expect(child.status,child.stderr).toBe(0);expect(read().opaque).toEqual([]);
});
it('traces freshly produced local cache files without mistaking console streams for network I/O',()=>{
  const {child,read}=fixture("import fs from'node:fs';console.log('producer progress');fs.existsSync('.wildshard/cache/scene.json');fs.mkdirSync('.wildshard/cache',{recursive:true});fs.writeFileSync('.wildshard/cache/scene.json','{}');fs.readFileSync('.wildshard/cache/scene.json');");
  expect(child.status,child.stderr).toBe(0);const trace=read();expect(trace.opaque).toEqual([]);expect(trace.files).toContain('.wildshard/cache/scene.json');
});
it('does not publish a successful trace when a producer fails',()=>{
  const {child,receipt}=fixture("throw new Error('producer failed');");
  expect(child.status).not.toBe(0);expect(existsSync(receipt)).toBe(false);
});
