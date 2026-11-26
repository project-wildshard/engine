// Product-only read receipts. Node records file access; the Vite bridge records
// Rust-bundled module inputs and resolution candidates which bypass Node fs.
import './format-hook.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import worker from 'node:worker_threads';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { createHash } from 'node:crypto';
import { isBuiltin, registerHooks, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import {compilerCodeHash} from './compiler-code.mjs';
import {functionSource} from './function-source.mjs';
import {borrowShardfileEntry} from './shardfile-cache.mjs';

const raw = { read:fs.readFileSync, stat:fs.lstatSync, list:fs.readdirSync, real:fs.realpathSync.native, write:fs.writeFileSync, mkdir:fs.mkdirSync, rename:fs.renameSync };
const digest = (/** @type {string|Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const schema = 'shardfile-inputs/5', modules = new Set([import.meta.filename,resolve(import.meta.dirname,'bake-input-hashes.mjs'),resolve(import.meta.dirname,'compiler-code.mjs'),resolve(import.meta.dirname,'function-source.mjs')]);
const code=/\.[cm]?[jt]sx?$/u;
const Receipt = v.strictObject({schema:v.literal(schema),node:v.string(),inputs:v.pipe(v.array(v.pipe(v.string(),v.regex(/^(?:[FDMP] .+|G [a-f0-9]{64})$/u))),v.minLength(1)),values:v.record(v.string(),v.string()),seal:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u))});
/** @type {AsyncLocalStorage<{root:string,reads:Map<string,string>,writes:Set<string>,bundles:number,invalid:string[],observing:boolean,loading?:string|undefined,traceOnly?:boolean,inventory?:Set<string>,opaque?:Set<string>,packageExports?:Map<string,Set<string>>,installedRoot?:string|undefined}>} */
const scopes = new AsyncLocalStorage();
/** @type {ReturnType<typeof scopes.getStore>} */
let generationScope;
/** @type {'F'|'M'} */
let moduleKind='M';
const inputScope=()=>scopes.getStore() ?? generationScope;
// SDK steps publish content identities. Their source closure and explicit input
// reads are traced normally; cache location and cache hits are not inputs.
channel('wildshard.generation-key').subscribe(message=>{
  const scope=inputScope();
  if(scope===undefined)return;
  const row=v.parse(v.strictObject({key:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u))}),message);
  scope.reads.set(`G ${row.key}`,row.key);
});
let installed = false;
/** @param {unknown} target */
function localPath(target) {
  if (typeof target === 'string') return resolve(target);
  if (target instanceof URL && target.protocol === 'file:') return fileURLToPath(target);
  if (target instanceof Uint8Array) return resolve(new TextDecoder().decode(target));
  return undefined;
}
/** @param {string} root @param {string} path */
function inside(root, path) {
  const file = relative(root, path).split(sep).join('/');
  if (file === '' || file === '..' || file.startsWith('../') || isAbsolute(file)) return undefined;
  if (file.split('/').some(part => ['node_modules','.git','.cache','tmp','out','.wildshard'].includes(part))) return undefined;
  return file;
}
/** Current exact bytes, directory inventory, link target or negative existence.
 * @param {string} root @param {string} entry @param {import('./bake-input-hashes.mjs').InputHashMemo} [memo] */
function value(root, entry, memo) {
  if(entry.startsWith('G '))return entry.slice(2);
  const kind = entry.slice(0,1), file = entry.slice(2), at = resolve(root,file);
  try {
    const stat = raw.stat(at,{throwIfNoEntry:false});
    if (stat === undefined) return 'absent';
    if (stat.isSymbolicLink()) throw new Error(`Linked product input: ${file}`);
    if (!raw.real(at).startsWith(root+sep)) throw new Error(`Escaped product input: ${file}`);
    if (stat.isDirectory()) return kind === 'D' ? `directory:${digest(raw.list(at).sort().join('\0'))}` : 'directory';
    if (!stat.isFile()) throw new Error(`Nonregular product input: ${file}`);
    if(kind==='P')return 'file';
    const hash=memo === undefined ? digest(raw.read(at)) : memo.hash(file);
    return kind==='M'&&code.test(file)?`module:${compilerCodeHash(file,hash,()=>raw.read(at))}`:hash;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent';
    throw error;
  }
}
/** @param {string} kind @param {unknown} target */
function note(kind, target) {
  const scope = inputScope();
  if(scope===undefined)return;
  const path=localPath(target);
  if(scope.traceOnly&&(kind==='P'||kind==='D'||kind==='L'||kind==='I')) {
    let bounded=path===undefined?'unknown':relative(scope.root,path).split(sep).join('/');
    if(kind==='P'&&path!==undefined&&scope.installedRoot!==undefined) {
      const dependency=relative(scope.installedRoot,path).split(sep).join('/');
      if(dependency!==''&&dependency!=='..'&&!dependency.startsWith('../')&&!isAbsolute(dependency))bounded=`node_modules/.pnpm/${dependency}`;
    }
    scope.inventory?.add(`${kind} ${bounded===''?'.':bounded}`);
  }
  // Only the exact module being loaded is a semantic execution read. Other
  // loader file reads remain raw dependencies, even inside the load callback.
  const loaderRead=scope.traceOnly&&kind==='F'&&path!==scope.loading;
  if((scope.observing&&!loaderRead)||kind==='I'||path===undefined)return;
  const bounded=relative(scope.root,path).split(sep).join('/');
  const file = scope.traceOnly&&bounded!==''&&bounded!=='..'&&!bounded.startsWith('../')&&!isAbsolute(bounded)?bounded:inside(scope.root,path);
  if(file===undefined) {
    if(kind!=='W'&&scope.traceOnly&&path!==scope.root&&!path.split(sep).includes('node_modules'))scope.opaque?.add(`external-read:${path}`);
    return;
  }
  if (kind === 'W') { scope.writes.add(file); return; }
  const entry = `${kind} ${file}`;
  if (scope.reads.has(entry)) return;
  if(scope.traceOnly){scope.reads.set(entry,'read');return;}
  scope.observing = true;
  try { scope.reads.set(entry,value(scope.root,entry)); } catch (error) { scope.invalid.push(`${entry}: ${String(error)}`); }
  finally { scope.observing = false; }
}
/** Track attempted workspace subpaths before resolution, including missing
 * exports caught by a producer. Installed third-party manifests stay pinned by
 * the lockfile; only real manifests inside the isolated source tree qualify.
 * @param {string} specifier */
function notePackageExport(specifier) {
  const scope=inputScope();
  if(scope?.traceOnly!==true||scope.observing)return;
  const parts=specifier.split('/'),prefix=parts.at(0),local=parts.at(1);
  if(!prefix?.startsWith('@')||local===undefined||local==='')return;
  const name=`${prefix}/${local}`,key=parts.length===2?'.':`./${parts.slice(2).join('/')}`;
  try {
    const manifest=raw.real(resolve(scope.root,'node_modules',name,'package.json'));
    const file=inside(scope.root,manifest);
    if(file===undefined)return;
    const json=v.parse(v.object({name:v.string()}),JSON.parse(raw.read(manifest,'utf8')));
    if(json.name!==name)return;
    const keys=scope.packageExports?.get(file)??new Set([key]);keys.add(key);
    scope.packageExports?.set(file,keys);
  } catch { /* Missing/unsupported manifests retain their complete raw key. */ }
}
/** Install once in the compiler process, before its entry imports load. */
export function installInputRecorder() {
  if (installed) return; installed = true;
  registerHooks({
  resolve(specifier,context,next) {
    notePackageExport(specifier);
    const scope=inputScope();
    // require.resolve and Node's ESM error hints inspect candidates without
    // executing their bodies. Retain every filename and package manifest for
    // resolution; actual CommonJS module loads below bind raw source bytes.
    try {
      const result=next(specifier,context);
      // A real builtin resolves within the keyed Node runtime, without any
      // staged filename candidates. Redirecting hooks still retain the fence.
      if(scope?.traceOnly===true&&context.conditions.includes('require')&&
        !(isBuiltin(specifier)&&isBuiltin(result.url)))scope.inventory?.add('R commonjs-resolution');
      return result;
    }
    catch(error){
      if(scope?.traceOnly===true) {
        if(context.conditions.includes('require'))scope.inventory?.add('R commonjs-resolution');
        // File/relative failures also bind nearby resolution candidates (and
        // directory-import suggestions). Bare resolution stays conservative.
        let candidate;
        try {
          if(specifier.startsWith('file:'))candidate=new URL(specifier);
          else if((specifier.startsWith('.')||isAbsolute(specifier))&&context.parentURL?.startsWith('file:'))candidate=new URL(specifier,context.parentURL);
        }catch { /* Unsupported candidate retains the conservative fence. */ }
        if(candidate?.protocol==='file:'){note('P',candidate);note('D',new URL('.',candidate));}
        else scope.inventory?.add(`R ${specifier}`);
      }
      throw error;
    }
  },
  load(url,context,next) {
    const file=url.startsWith('file:')?fileURLToPath(url):undefined,scope=inputScope();
    if(file!==undefined)modules.add(file);
    // Reading a module to execute it differs from consuming its source text.
    // Hide only the loader's own I/O; explicit reads after evaluation stay F.
    const observing=scope?.observing,loading=scope?.loading;
    if(scope!==undefined){scope.observing=true;scope.loading=file;}
    let loaded;
    try {loaded=next(url,context);}
    finally {if(scope!==undefined){scope.observing=observing ?? false;scope.loading=loading;}}
    const commonjs=loaded.format==='commonjs'||loaded.format==='commonjs-typescript';
    if(commonjs&&scope?.traceOnly===true)scope.inventory?.add('R commonjs-module');
    // Node's synchronous load hooks cover nested require and JSON loads too.
    // Preserve raw CommonJS bytes, including source inspections and wrappers;
    // never normalize them as ESM execution. Native/worker/child calls below
    // independently mark the complete observation opaque.
    if(file!==undefined)note(commonjs&&scope?.traceOnly===true||!code.test(file)?'F':moduleKind,file);
    return loaded;
  }});
  /** @type {unknown} */
  const functionText=Object.getOwnPropertyDescriptor(Function.prototype,'toString')?.value;
  if(typeof functionText!=='function')throw new Error('Function source reader is unavailable');
  // oxlint-disable-next-line no-extend-native -- Isolated compiler instrumentation must observe function-source content reads; it preserves the original result outside recording scopes.
  Function.prototype.toString=function toString() {
    /** @type {unknown} */
    const text=Reflect.apply(functionText,this,[]);
    if(typeof text!=='string')throw new Error('Function source reader returned non-text');
    const scope=inputScope();
    if(scope!==undefined&&!scope.observing&&!/\{\s*\[native code\]\s*\}$/u.test(text)) {
      scope.observing=true;
      let source;
      try {source=functionSource(this);}finally {scope.observing=false;}
      const file=source?.startsWith('file:')?fileURLToPath(source):undefined;
      if(file!==undefined)note('F',file);
      // Native builtins are pinned by Node's version. Emitted modules under
      // tmp (including already removed bundles), data URLs and unrecognized
      // origins retain the original raw compiler modules as a fallback.
      if((file===undefined||inside(scope.root,file)===undefined)&&source?.startsWith('node:')!==true)
        for(const input of modules)note('F',input);
    }
    return text;
  };
  /** @param {Record<string,unknown>} table @param {string[]} names @param {string} kind */
  const wrap = (table,names,kind) => {
    for (const name of names) {
      const original = table[name]; if (typeof original !== 'function') continue;
      /** @this {unknown} @param {...unknown} args */
      const traced = function traced(...args) {
        // Default/encoding-only directory calls cannot see descendants. Options
        // objects stay conservative without evaluating user getters or proxies.
        // Product receipts retain their existing D identity.
        const shallow=kind==='D'&&inputScope()?.traceOnly===true&&(args[1]===undefined||typeof args[1]==='string'||typeof args[1]==='function');
        note(shallow?'L':kind,args[0]);
        if (name === 'copyFileSync' || name === 'cpSync' || name === 'copyFile' || name === 'cp') note('W',args[1]);
        return Reflect.apply(original,this,args);
      };
      Object.defineProperties(traced,Object.getOwnPropertyDescriptors(original)); table[name] = traced;
    }
  };
  wrap(fs,['existsSync','exists','realpathSync'],'P');
  const nativeRealpath={native:fs.realpathSync.native};wrap(nativeRealpath,['native'],'P');fs.realpathSync.native=nativeRealpath.native;
  wrap(fs,['globSync','glob','readlinkSync','readlink'],'I');
  wrap(fs,['openAsBlob','readFileSync','readFile','statSync','stat','lstatSync','lstat','openSync','open','createReadStream','accessSync','access','copyFileSync','cpSync'],'F');
  wrap(fs,['readdirSync','readdir','opendirSync','opendir'],'D');
  wrap(fs,['writeFileSync','writeFile','appendFileSync','appendFile'],'W');
  wrap(fsp,['realpath'],'P');
  wrap(fsp,['glob','readlink'],'I');
  wrap(fsp,['readFile','stat','lstat','open','access','copyFile','cp'],'F');
  wrap(fsp,['readdir','opendir'],'D'); wrap(fsp,['writeFile','appendFile'],'W');
  const nativeLoad=process.dlopen.bind(process);
  process.dlopen=(...args)=>{generationScope?.opaque?.add('native-addon');nativeLoad(...args);};
  const request=globalThis.fetch.bind(globalThis);
  globalThis.fetch=(...args)=>{
    const target=args[0],url=typeof target==='string'?target:target instanceof URL?target.href:target.url;
    if(!url.startsWith('data:'))generationScope?.opaque?.add('network');
    return request(...args);
  };
  /** Observe actual work, not imports used for isMainThread or pure constants.
   * @param {Record<string,unknown>} table @param {string[]} names @param {string} reason */
  const observeCalls=(table,names,reason)=>{
    for(const name of names) {
      const original=table[name];if(typeof original!=='function')continue;
      /** Console streams use net.Socket with an existing standard descriptor,
       * without opening a network connection. @param {unknown[]} args */
      const mark=args=>{
        const options=args[0];
        if(name==='Socket'&&options!==null&&typeof options==='object'&&'fd'in options&&[0,1,2].includes(Number(options.fd)))return;
        generationScope?.opaque?.add(reason);
      };
      table[name]=new Proxy(original,{
        apply(target,thisArg,args){mark(args);return Reflect.apply(target,thisArg,args);},
        construct(target,args,newTarget){mark(args);return Reflect.construct(target,args,newTarget);},
      });
    }
  };
  observeCalls(worker,['Worker'],'worker');
  observeCalls(net,['Socket','Server','connect','createConnection','createServer'],'network');
  observeCalls(tls,['TLSSocket','connect','createServer'],'network');
  for(const table of [http,https])observeCalls(table,['request','get','createServer'],'network');
  observeCalls(http2,['connect','createServer','createSecureServer'],'network');
  /** @param {Record<string,unknown>} table */
  const observeChildren=table=>{
    for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) {
      const original=table[name];if(typeof original!=='function')continue;
      /** @this {unknown} @param {...unknown} args */
      const traced=function traced(...args) {
        const version=typeof args[0]==='string'&&Array.isArray(args[1])&&args[1].length===1&&
          ((['magick','cwebp','basisu'].includes(basename(args[0]))&&args[1][0]==='-version')||
           (args[0]===process.execPath&&args[1][0]==='--version'));
        if(!version)generationScope?.opaque?.add('child-process');
        return Reflect.apply(original,this,args);
      };
      Object.defineProperties(traced,Object.getOwnPropertyDescriptors(original));table[name]=traced;
    }
  };
  observeChildren(childProcess);
  syncBuiltinESMExports();
}
/** Bind candidate presence/type; selected modules record their actual bytes.
 * Package metadata is resolver input even when it is not an emitted module.
 * A newly added higher-priority relative file must invalidate resolution.
 * @param {string} id @param {string|undefined} importer */
export function recordResolution(id, importer) {
  if (!id.startsWith('.') || importer === undefined || !isAbsolute(importer)) return;
  const at = resolve(dirname(importer.split('?')[0]),id.split('?')[0]);
  for (const suffix of ['', '.ts','.tsx','.mts','.js','.jsx','.mjs','.json','/package.json','/index.ts','/index.tsx','/index.mts','/index.js','/index.jsx','/index.mjs','/index.json']) note(suffix==='/package.json'?'F':'P',at+suffix);
}
/** Record resolved inputs before the native bundler reads them.
 * @param {string} id @param {{execution?:boolean}} [options] */
export function recordModuleInput(id,options={}) {
  if(!isAbsolute(id))return;
  const file=id.split('?')[0];
  note(options.execution===true&&code.test(file)?'M':'F',file);
}
/** @param {unknown} result @param {{execution?:boolean}} [options] */
export function recordBundle(result,options={}) {
  const scope = inputScope(); if (scope === undefined) return;
  scope.bundles++;
  for (const build of Array.isArray(result) ? result : [result]) if (build !== null && typeof build === 'object' && 'output' in build && Array.isArray(build.output)) {
    for (const chunk of build.output) if (chunk.type === 'chunk') for (const id of chunk.moduleIds ?? Object.keys(chunk.modules ?? {})) if (typeof id === 'string') {
      recordModuleInput(id,options);
      // Native load callbacks run before the compiler bundle executes. Only
      // its completed execution boundary joins the toString source guard.
      if(options.execution===true&&isAbsolute(id))modules.add(id.split('?')[0]);
    }
  }
}
/** A successful, complete compiler writes its receipt after checking read stability.
 * @param {string} root @param {string} receipt @param {()=>Promise<void>} run */
export async function captureFolderInputs(root,receipt,run) {
  if(generationScope!==undefined)generationScope.opaque?.add('nested-product-compiler');
  installInputRecorder();
  const scope = {root:raw.real(root),reads:new Map(),writes:new Set(),bundles:0,invalid:[],observing:false};
  await scopes.run(scope,async () => {
    for (const file of modules) note(code.test(file)?moduleKind:'F',file);
    await run();
  });
  if (scope.invalid.length > 0 || scope.bundles === 0) throw new Error(`Incomplete product input trace: ${scope.invalid.join('; ')}`);
  const values = Object.fromEntries([...scope.reads].sort(([a],[b])=>a.localeCompare(b)).map(([entry,before])=>{
    const after = value(scope.root,entry);
    if (after !== before && !scope.writes.has(entry.slice(2)) && ![...scope.writes].some(file=>file.startsWith(`${entry.slice(2)}/`))) throw new Error(`Product input changed during build: ${entry}`);
    return [entry,after];
  }));
  const body = {schema,node:process.version,inputs:Object.keys(values),values};
  raw.mkdir(dirname(receipt),{recursive:true}); raw.write(receipt,JSON.stringify({...body,seal:digest(JSON.stringify(body))}));
}
/** Replay a verified compiler's reads into the current product scope. The
 * compiler cache does not replace dependencies with its own opaque file path.
 * @param {string} root @param {string} receipt */
export function replayFolderInputs(root,receipt) {
  const saved=v.parse(Receipt,JSON.parse(raw.read(receipt,'utf8')));
  const scope=inputScope(),canonical=raw.real(root);
  if(saved.node!==process.version || scope!==undefined&&scope.root!==canonical
    || saved.inputs.some(entry=>!entry.startsWith('G ')&&inside(canonical,resolve(canonical,entry.slice(2)))!==entry.slice(2))
    || new Set(saved.inputs).size!==saved.inputs.length || Object.keys(saved.values).length!==saved.inputs.length
    || saved.seal!==digest(JSON.stringify({schema:saved.schema,node:saved.node,inputs:saved.inputs,values:saved.values})))throw new Error('Invalid compiler input receipt');
  for(const entry of saved.inputs) {
    if(value(canonical,entry)!==saved.values[entry])throw new Error(`Compiler input changed: ${entry}`);
    // The check above already read these exact bytes/types. Repeating it in
    // note() doubles filesystem work for thousands of resolver candidates.
    // Keep the first observation; captureFolderInputs still checks every
    // joined dependency again when the enclosing product finishes.
    if(scope?.traceOnly===true&&!entry.startsWith('G '))note(entry.slice(0,1),resolve(canonical,entry.slice(2)));
    else if(scope!==undefined&&!scope.reads.has(entry))scope.reads.set(entry,saved.values[entry]);
  }
}
/** A missing/malformed receipt always misses. Unread generated files never enter it.
 * @param {string} root @param {string} receipt @param {string[]} args @param {import('./bake-input-hashes.mjs').InputHashMemo} memo */
export function folderInputKey(root,receipt,args,memo) {
  try {
    if(memo.root!==raw.real(root))return undefined;
    const saved = v.parse(Receipt,JSON.parse(raw.read(receipt,'utf8')));
    if (saved.node !== process.version
      || saved.inputs.some(entry=> !entry.startsWith('G ') && inside(root,resolve(root,entry.slice(2))) !== entry.slice(2))
      || new Set(saved.inputs).size !== saved.inputs.length || Object.keys(saved.values).length !== saved.inputs.length
      || saved.seal !== digest(JSON.stringify({schema:saved.schema,node:saved.node,inputs:saved.inputs,values:saved.values}))) return undefined;
    for (const entry of saved.inputs) {
      const expected=saved.values[entry];
      // A captured content digest already identifies a regular-file read. The
      // hash memo checks type, containment and fresh stats itself; avoid doing
      // those same filesystem checks once more in value(). Any type change
      // refuses this receipt through the enclosing miss-on-error boundary.
      const current=entry.startsWith('G ') ? value(root,entry,memo) : /^[a-f0-9]{64}$/u.test(expected) ? memo.hash(entry.slice(2)) : value(root,entry,memo);
      if(expected!==current)return undefined;
    }
    return digest(JSON.stringify({schema,node:process.version,platform:process.platform,arch:process.arch,args,inputs:saved.inputs.map(entry=>[entry,saved.values[entry]])}));
  } catch { return undefined; }
}
/** Keep immutable read-set variants: simultaneous revisions cannot overwrite
 * another build's evidence. Only a byte-matching captured snapshot can hit.
 * @param {string} root @param {string} directory @param {string[]} args @param {import('./bake-input-hashes.mjs').InputHashMemo} memo */
export function matchingFolderInputKey(root,directory,args,memo) {
  const release=borrowShardfileEntry(directory);
  try {
    if(fs.existsSync(`${directory}.lock`))return undefined;
    const receipts=raw.list(directory).filter(file=>/^[a-f0-9]{64}\.json$/u.test(file)).map(file=>({file,mtime:raw.stat(resolve(directory,file)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
    for(const row of receipts.slice(0,12)) {
      const key=folderInputKey(root,resolve(directory,row.file),args,memo);
      if(key !== undefined && row.file === `${key}.json`) {
        const now=new Date();fs.utimesSync(directory,now,now);
        return key;
      }
    }
  } catch { /* Missing/incomplete evidence builds a fresh product. */ }
  finally {release();}
  return undefined;
}
/** Publish one complete immutable receipt atomically.
 * @param {string} directory @param {string} receipt @param {string} key */
export function publishFolderInputs(directory,receipt,key) {
  const release=borrowShardfileEntry(directory);
  try {
    // An eviction already in flight may omit this optional warm receipt;
    // the product's own immutable receipt/admission remains authoritative.
    if(fs.existsSync(`${directory}.lock`))return;
    raw.mkdir(directory,{recursive:true});
    const temporary=resolve(directory,`${key}.${process.pid}.tmp`);
    raw.write(temporary,raw.read(receipt)); raw.rename(temporary,resolve(directory,`${key}.json`));
  } finally {release();}
}
if (process.execArgv.some((arg,index)=>arg==='--import' && process.execArgv[index+1] === import.meta.filename)) installInputRecorder();

/** Workspace/dependency installation identity. Compiler execution and runtime
 * source enter complete per-product receipts; unused SDK files do not.
 * @param {string} root @param {import('./bake-input-hashes.mjs').InputHashMemo} memo */
export function folderToolchainKey(root,memo) {
  const files=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];
  return digest(JSON.stringify(files.map(file=>[file,memo.hash(file)])));
}

/** Native plugin callbacks cross an async boundary; bind the product scope at
 * plugin creation rather than assuming Rolldown preserves AsyncLocalStorage.
 * Execution mode is only for the trusted compiler bundle; product/runtime
 * bundles retain byte-exact source. @param {{execution?:boolean}} [options] */
export function inputRecorderPlugin(options={}) {
  const scope = scopes.getStore();
  return {name:'product-input-recorder',enforce:/** @type {const} */ ('pre'),
    /** @param {string} id @param {string|undefined} importer */
    resolveId(id,importer) { if (scope !== undefined) scopes.run(scope,()=>recordResolution(id,importer)); return null; },
    /** @param {string} id */
    load(id) { if (scope !== undefined) scopes.run(scope,()=>recordModuleInput(id,options)); return null; },
  };
}

/** Start one isolated producer's raw Node read trace. Unknown native, network,
 * worker or child-process reads retain the full conservative input closure.
 * @param {string} root @param {string} receipt */
export function startGenerationInputTrace(root,receipt) {
  if(generationScope!==undefined)throw new Error('Generation trace already active');
  moduleKind='M';installInputRecorder();
  /** @type {Map<string,Set<string>>} */
  const packageExports=new Map();
  /** @type {Set<string>} */
  const inventory=new Set();
  /** @type {string|undefined} */
  let installedRoot;
  try {installedRoot=raw.real(resolve(root,'node_modules/.pnpm'));}catch { /* Uninstalled roots keep their original probe addresses. */ }
  const scope={root:raw.real(root),reads:new Map(),writes:new Set(),bundles:0,invalid:[],observing:false,traceOnly:true,inventory,opaque:new Set(),packageExports,installedRoot};
  generationScope=scope;scopes.enterWith(scope);
  for(const file of modules)if(inside(scope.root,file)!==undefined)note(code.test(file)?'M':'F',file);
  process.on('exit',status=>{
    if(status!==0)return;
    const files=[...scope.reads.keys()].filter(entry=>entry.startsWith('F ')).map(entry=>entry.slice(2)).sort((a,b)=>a<b?-1:a>b?1:0);
    const execution=[...scope.reads.keys()].filter(entry=>entry.startsWith('M ')).map(entry=>entry.slice(2)).filter(file=>!scope.reads.has(`F ${file}`)).sort((a,b)=>a<b?-1:a>b?1:0);
    const packages=Object.fromEntries([...scope.packageExports].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([file,keys])=>[file,[...keys].sort((a,b)=>a<b?-1:a>b?1:0)]));
    const body={schema:'generation-reads/4',files,execution,packages,inventory:[...scope.inventory].sort((a,b)=>a<b?-1:a>b?1:0),opaque:[...scope.opaque].sort((a,b)=>a<b?-1:a>b?1:0)};
    raw.write(receipt,JSON.stringify({...body,seal:digest(JSON.stringify(body))}));
  });
}
