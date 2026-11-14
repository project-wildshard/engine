// Read-only Git inputs for fast checks. No checkout, generated cache or source tree.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { dirname, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as v from 'valibot';

// Committed generators load format from node_modules (J82). Fixture trees that carry only these tools have no hook.
const formatHook = new URL('./format-hook.mjs', import.meta.url);
if (fs.existsSync(formatHook)) await import(formatHook.href);

/** @param {string} root @param {string} revision */
export function gitSourceView(root, revision) {
  const actualRead=fs.readFileSync;
  const command = (/** @type {string[]} */ args) => execFileSync('git', args, {cwd:root,maxBuffer:64*1024*1024,timeout:10_000});
  const tree = command(['ls-tree','-r','-z',revision]).toString('utf8');
  /** @type {Map<string,string>} */
  const files = new Map();
  /** @type {Map<string,Buffer>} */
  const derived = new Map();
  /** @type {Map<string,string>} */
  const generatedProofs = new Map();
  /** @type {Map<string,{id:string,outputs:string[],nativeOutputs:string[]}>} */
  const sourceProviders = new Map();
  const directories = new Set(['']);
  for(const record of tree.split('\0')) {
    if(record==='')continue;
    const at=record.indexOf('\t'),meta=record.slice(0,at).split(' '),path=record.slice(at+1);
    if(meta[0]!=='100644' && meta[0]!=='100755')continue;
    const hash=meta[2];if(hash===undefined)throw new Error('Invalid Git blob inventory');
    files.set(path,hash);
    for(let parent=dirname(path);parent!=='.';parent=dirname(parent))directories.add(parent);
  }
  /** @type {Map<string,Buffer>} */
  const cache = new Map();
  // Only the maintained literal discovery-table writer owns these outputs.
  const sourceRegistry='scripts/source-generation-outputs.json';
  if(files.has(sourceRegistry)){
    const registry=v.parse(v.object({producers:v.record(v.string(),v.array(v.string()))}),JSON.parse(command(['show',`${revision}:${sourceRegistry}`]).toString('utf8')));
    const outputs=registry.producers['scripts/gen-shards.mjs'];
    if(outputs!==undefined)for(const file of outputs)sourceProviders.set(file,{id:'source-discovery',outputs,nativeOutputs:outputs});
  }
  /** @returns {boolean} */
  const admitGenerated=(/** @type {string} */ path)=>{
    const pin=generatedProofs.get(path);if(pin===undefined)return false;
    try{
      const bytes=actualRead(resolve(root,path));
      if(createHash('sha256').update(bytes).digest('hex')!==pin)return false;
      derived.set(path,bytes);return true;
    }catch{return false;}
  };
  /** @returns {Buffer} */
  const read = (/** @type {string} */ path) => {
    const generated=derived.get(path);if(generated!==undefined)return generated;
    const hash=files.get(path);if(hash===undefined){
      if(admitGenerated(path)){const bytes=derived.get(path);if(bytes!==undefined)return bytes;}
      throw Object.assign(new Error(`Missing committed input: ${path}`),{code:'ENOENT'});
    }
    let bytes=cache.get(hash);if(bytes===undefined){bytes=command(['cat-file','blob',hash]);cache.set(hash,bytes);}return bytes;
  };
  /** Batch immutable text reads for tree-scanning guards, never materialize source. @param {string[]} paths */
  const prime=paths=>{
    const hashes=[...new Set(paths.map(path=>files.get(path)).filter(hash=>hash!==undefined&&!cache.has(hash)))];
    for(let start=0;start<hashes.length;start+=32) {
      const selected=hashes.slice(start,start+32);
      const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:`${selected.join('\n')}\n`,maxBuffer:256*1024*1024,timeout:10_000});
      let offset=0;
      for(const hash of selected) {
        const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString('utf8').split(' '),size=Number(header[2]);
        if(end===-1||header[0]!==hash||header[1]!=='blob'||!Number.isSafeInteger(size)||size<0||end+size+1>=bytes.length)throw new Error('Invalid Git batch reply');
        cache.set(hash,bytes.subarray(end+1,end+1+size));offset=end+size+2;
      }
      if(offset!==bytes.length)throw new Error('Unexpected Git batch suffix');
    }
  };
  const matches=(/** @type {string} */ path)=>{try{return read(path).equals(actualRead(resolve(root,path)));}catch{return false;}};
  return {root,revision,files,directories,derived,read,matches,prime,admitGenerated,generatedProofs,sourceProviders};
}

/** Pin synchronous policy readers and JS imports to one Git inventory. Scratch and packages stay native.
 * @param {ReturnType<typeof gitSourceView>} view */
export function installGitSourceView(view) {
  const native={read:fs.readFileSync,exists:fs.existsSync,list:fs.readdirSync,stat:fs.statSync,lstat:fs.lstatSync,real:fs.realpathSync,glob:fs.globSync};
  const name = (/** @type {unknown} */ input) => {
    const path=input instanceof URL?fileURLToPath(input):typeof input==='string'?input:null;
    if(path===null)return null;
    const absolute=resolve(path);if(absolute===process.env.WS_GIT_CHECK_CONFIG)return null;
    const local=relative(view.root,absolute).replaceAll(sep,'/');
    if(local.startsWith('../')||isAbsolute(local)||local==='node_modules'||local.split('/').includes('node_modules')||local==='tmp'||local.startsWith('tmp/')||local==='.git'||local.startsWith('.git/'))return null;
    return local;
  };
  Reflect.set(fs,'readFileSync',(/** @type {unknown} */ path,/** @type {unknown} */ options)=>{
    const local=name(path);if(local===null)return Reflect.apply(native.read,fs,[path,options]);
    const bytes=view.read(local),encoding=typeof options==='string'?options:typeof options==='object'&&options!==null?Reflect.get(options,'encoding'):null;
    if(typeof encoding==='string') {
      if(!Buffer.isEncoding(encoding))throw new TypeError(`Unknown encoding: ${encoding}`);
      return bytes.toString(encoding);
    }
    return Buffer.from(bytes);
  });
  Reflect.set(fs,'existsSync',(/** @type {unknown} */ path)=>{const local=name(path);return local===null?Reflect.apply(native.exists,fs,[path]):view.files.has(local)||view.derived.has(local)||view.directories.has(local)||view.admitGenerated(local);});
  const stat=(/** @type {unknown} */ path,/** @type {unknown} */ options,/** @type {'stat'|'lstat'} */ original)=>{
    const local=name(path);if(local===null)return Reflect.apply(native[original],fs,[path,options]);
    const directory=view.directories.has(local),file=view.files.has(local)||view.derived.has(local);
    if(!directory&&!file){if(typeof options==='object'&&options!==null&&Reflect.get(options,'throwIfNoEntry')===false)return undefined;throw Object.assign(new Error(`Missing committed input: ${local}`),{code:'ENOENT'});}
    const template=native.stat(view.root),bytes=file?view.read(local).length:0;
    return Object.assign(Object.create(Object.getPrototypeOf(template)),template,{size:bytes,isFile:()=>file,isDirectory:()=>directory,isSymbolicLink:()=>false});
  };
  Reflect.set(fs,'statSync',(/** @type {unknown} */ path,/** @type {unknown} */ options)=>stat(path,options,'stat'));
  Reflect.set(fs,'lstatSync',(/** @type {unknown} */ path,/** @type {unknown} */ options)=>stat(path,options,'lstat'));
  const real=(/** @type {unknown} */ path,/** @type {unknown} */ options)=>{
    const local=name(path);if(local===null)return Reflect.apply(native.real,fs,[path,options]);
    if(!view.files.has(local)&&!view.directories.has(local))throw Object.assign(new Error(`Missing committed input: ${local}`),{code:'ENOENT'});
    return resolve(view.root,local);
  };
  Reflect.set(real,'native',real);Reflect.set(fs,'realpathSync',real);
  Reflect.set(fs,'readdirSync',(/** @type {unknown} */ path,/** @type {unknown} */ options)=>{
    const local=name(path);if(local===null)return Reflect.apply(native.list,fs,[path,options]);
    if(!view.directories.has(local))throw Object.assign(new Error(`Missing committed directory: ${local}`),{code:'ENOENT'});
    const prefix=local===''?'':`${local}/`,recursive=typeof options==='object'&&options!==null&&Reflect.get(options,'recursive')===true;
    const paths=[...view.files.keys(),...view.directories].filter(p=>p.startsWith(prefix)&&p!==local&&(recursive||!p.slice(prefix.length).includes('/'))).sort();
    const entries=typeof options==='object'&&options!==null&&Reflect.get(options,'withFileTypes')===true;
    return paths.map(p=>entries?{name:p.slice(prefix.length),parentPath:resolve(view.root,local),path:resolve(view.root,local),isFile:()=>view.files.has(p),isDirectory:()=>view.directories.has(p),isSymbolicLink:()=>false}:p.slice(prefix.length));
  });
  Reflect.set(fs,'globSync',(/** @type {string|string[]} */ pattern,/** @type {{cwd?:string|URL,exclude?:string[]}|undefined} */ options)=>{
    const cwd=options?.cwd instanceof URL?fileURLToPath(options.cwd):options?.cwd??process.cwd(),base=name(cwd);
    if(base===null)return native.glob(pattern,options??{});
    const patterns=Array.isArray(pattern)?pattern:[pattern],prefix=base===''?'':`${base}/`;
    return [...view.files.keys()].filter(p=>p.startsWith(prefix)).map(p=>p.slice(prefix.length)).filter(p=>patterns.some(glob=>matchesGlob(p,glob))&&!options?.exclude?.some(glob=>matchesGlob(p,glob)));
  });
  syncBuiltinESMExports();
  registerHooks({
    resolve(specifier,context,next) {
      if(specifier.startsWith('.')&&context.parentURL?.startsWith(pathToFileURL(view.root+sep).href)) {
        const url=new URL(specifier,context.parentURL),local=name(url);
        if(local!==null)for(const candidate of [local,`${local}.ts`,`${local}.mjs`,`${local}.js`])if(view.files.has(candidate))return {url:pathToFileURL(resolve(view.root,candidate)).href,shortCircuit:true};
      }
      return next(specifier,context);
    },
    load(url,context,next) {
      if(!url.startsWith('file:'))return next(url,context);
      const local=name(new URL(url));
      if(local===null)return next(url,context);
      if(!view.files.has(local))throw new Error(`Uncommitted executable input refused: ${local}`);
      if(/\.[cm]?[jt]s$/u.test(local))return {format:local.endsWith('.ts')?'module-typescript':'module',source:view.read(local),shortCircuit:true};
      if(local.endsWith('.json'))return {format:'json',source:view.read(local),shortCircuit:true};
      return next(url,context);
    },
  });
}

/** Derive the lint vocabulary from static Git data; no generation job or file write.
 * @param {ReturnType<typeof gitSourceView>} view */
export async function deriveGitVocabulary(view) {
  if(view.files.has('scripts/gen-shard-words.mjs')) {
    const {shardWordData}=/** @type {typeof import('./gen-shard-words.mjs')} */(await import(pathToFileURL(resolve(view.root,'scripts/gen-shard-words.mjs')).href));
    view.derived.set('lint/shard-words.generated.json',Buffer.from(JSON.stringify(shardWordData(view.root))));
  }
}

/** Pure pre-generation tables use their canonical writers and Git-owned JSON,
 * never an ignored file left in the shared checkout.
 * @param {ReturnType<typeof gitSourceView>} view */
export async function deriveGitStarterTables(view) {
  const tables = [
    ['gen-starter-weapons.mjs','starterWeaponsTableSource','src/shared/game/weapons/starter.generated.ts'],
    ['gen-starter-bag.mjs','starterBagTableSource','src/shared/game/bag/starter.generated.ts'],
    ['gen-starter-effects.mjs','starterEffectsTableSource','src/client/game/systems/effects/starter.generated.ts'],
    ['gen-starter-arm-clips.mjs','starterArmClipsTableSource','src/client/game/systems/viewmodel/clips.generated.ts'],
  ];
  for (const [file, binding, output] of tables) {
    if (file === undefined || binding === undefined || output === undefined) throw new Error('Invalid starter table declaration');
    const source = `scripts/${file}`;
    if (!view.files.has(source)) continue;
    /** @type {unknown} */ const module = await import(pathToFileURL(resolve(view.root,source)).href);
    if (typeof module !== 'object' || module === null) throw new Error('Missing starter table module');
    const emit = Reflect.get(module,binding);
    if (typeof emit !== 'function') throw new Error(`Missing starter table writer: ${binding}`);
    /** @type {unknown} */ const text = emit();
    if (typeof text !== 'string') throw new Error(`Invalid starter table source: ${output}`);
    view.derived.set(output,Buffer.from(text));
  }
}

/** Run a declared source-output provider only in the exact native mirror.
 * Its verified result supplies expected identities, never loose source text.
 * @param {ReturnType<typeof gitSourceView>} view @param {string} path */
export function deriveGitDiscovery(view,path) {
  const {WS_GIT_NATIVE_ROOT:nativeRoot}=process.env;
  if(nativeRoot!==view.root)return false;
  if(view.admitGenerated(path))return true;
  const job=view.sourceProviders.get(path);
  if(job===undefined)return false;
  for(const file of job.nativeOutputs)if(!job.outputs.includes(file)||!file.startsWith('src/')&&!file.startsWith('public/')||file.split('/').includes('..'))throw new Error(`Invalid native source output: ${file}`);
  if(job.id!=='source-discovery')throw new Error('Unknown source table provider');
  const source=`
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    const genShards=()=>{throw new Error('Engine generates no shard source');};
    const outputs=JSON.parse(process.argv[1]);
    genShards(process.cwd());
    console.log(JSON.stringify(Object.fromEntries(outputs.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]))));
  `;
  const output=execFileSync(process.execPath,['--experimental-transform-types','--import','./scripts/node-format.mjs','--input-type=module','--eval',source,'--',JSON.stringify(job.nativeOutputs)],{cwd:view.root,encoding:'utf8',maxBuffer:8*1024*1024,
    env:{...process.env,WS_GIT_CHECK_ROOT:view.root,WS_GIT_CHECK_REV:view.revision}});
  const line=output.trim().split('\n').at(-1);
  if(line===undefined)throw new Error('Missing generated-output proof');
  const hashes=v.parse(v.record(v.string(),v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u))),JSON.parse(line));
  for(const file of job.nativeOutputs){
    const hash=hashes[file];if(hash===undefined)throw new Error(`Missing native source proof: ${file}`);
    if(view.files.has(file)){
      if(createHash('sha256').update(view.read(file)).digest('hex')!==hash||!view.matches(file))throw new Error(`Generated output differs from committed source: ${file}`);
      continue;
    }
    view.generatedProofs.set(file,hash);
    if(!view.admitGenerated(file))throw new Error(`Native source output differs: ${file}`);
  }
  return view.derived.has(path);
}
if(process.env.WS_GIT_CHECK_ROOT!==undefined&&process.env.WS_GIT_CHECK_REV!==undefined) {
  const view=gitSourceView(resolve(process.env.WS_GIT_CHECK_ROOT),process.env.WS_GIT_CHECK_REV);
  installGitSourceView(view);await deriveGitVocabulary(view);await deriveGitStarterTables(view);
}
