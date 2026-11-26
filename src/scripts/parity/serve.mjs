import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkNodeModules } from '../link-node-modules.mjs';
import { get } from 'node:http';
import { fileURLToPath } from 'node:url';

/** What an exported tree leaves out: paths no build reads (gitignore syntax, every pattern anchored with `/`). The old
 *  host's upload-ignore file said this until OFF-VERCEL OV9 deleted it; the list is that file's patterns. */
export const EXPORT_IGNORE=`${['/node_modules','/dist','/progress','/sources','/art','/docs','/api-tests','/.git','/ios','/android',
  '/dist-native','/dist-drafts','/.native-build','/test/parity','/coverage/'].join('\n')}\n`;

/** @param {string} root @param {string} sha */
export function exportTree(root, sha) {
  const commit=execFileSync('git',['rev-parse','--verify',`${sha}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'wildshard-parity-'))); // canonical (E432)
  const cleanup=()=>rmSync(dir,{recursive:true,force:true});
  try {
    const ign=join(dir,'ign');mkdirSync(ign);
    execFileSync('git',['init','-q',ign]);
    writeFileSync(join(dir,'ignore'),EXPORT_IGNORE);
    const paths=execFileSync('git',['ls-tree','-r','--name-only',commit],{cwd:root,encoding:'utf8',maxBuffer:64*1024**2}).trim().split('\n');
    const ignored=execFileSync('git',['-C',ign,'-c',`core.excludesFile=${join(dir,'ignore')}`,'check-ignore','--no-index','--stdin'],{input:paths.join('\n'),encoding:'utf8',maxBuffer:64*1024**2}).trim().split('\n');
    const excluded=new Set(ignored), keep=paths.filter((p)=>p.startsWith('test/parity/') || !excluded.has(p));
    const tree=join(dir,'tree');mkdirSync(tree);
    const archive=execFileSync('git',['archive',commit,'--',...keep],{cwd:root,maxBuffer:1024**3});
    execFileSync('tar',['-x','-C',tree],{input:archive,maxBuffer:1024**3});
    linkNodeModules(root,tree); // E432: @wildshard/* → this export
    if (existsSync(join(tree,'src/scripts/pins.ts')) && existsSync(join(tree,'test/pins/shardfiles.json'))) {
      // The installer reads tracked public assets from the index, and generation reads HEAD.
      // A private detached index gives both the archived inventory and keeps pin excludes local.
      const objects=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','objects'],{cwd:root,encoding:'utf8'}).trim();
      const gitDir=join(tree,'.git');
      const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')));
      const options={cwd:tree,env:{...env,GIT_DIR:gitDir,GIT_WORK_TREE:tree,GIT_INDEX_FILE:join(gitDir,'index')}};
      const git=(/** @type {string[]} */ args)=>execFileSync('git',args,options);
      git(['init','-q']);
      writeFileSync(join(gitDir,'objects','info','alternates'),`${realpathSync(objects)}\n`);
      git(['update-ref','--no-deref','HEAD',commit]);
      git(['read-tree',commit]);
      execFileSync(process.execPath,['src/scripts/pins.ts','install'],{...options,maxBuffer:16*1024**2});
    }
    return {tree,cleanup};
  } catch(error) {cleanup();throw error;}
}
/** A bounded native HTTP readiness probe. Avoid undici's macOS socket QoS failure before browser capture.
 * @param {string} url @param {number} [timeoutMs] @returns {Promise<boolean>} */
export function previewReady(url, timeoutMs=1000) {
  return new Promise(resolve=>{
    const request=get(url,response=>{response.resume();resolve(response.statusCode!==undefined&&response.statusCode>=200&&response.statusCode<300);});
    request.on('error',()=>resolve(false));
    request.setTimeout(timeoutMs,()=>{request.destroy(new Error('Preview readiness timed out'));});
  });
}
/** @param {string} tree @param {string} sha @param {boolean} [built]
 * @param {{signal?:AbortSignal,telemetryDir?:string,errorReports?:boolean}} [options] */
export async function serve(tree,sha,built=false,{signal,telemetryDir,errorReports=false}={}) {
  signal?.throwIfAborted();
  if(!built)buildTree(tree,sha);
  // the host's plain preview server serves any tree's built bytes with that tree's _headers (D24)
  const server=fileURLToPath(new URL('../preview-server.mjs',import.meta.url));
  const args=[server,'--root',tree,'--host','127.0.0.1','--port','0'];
  if(telemetryDir!==undefined)args.push('--telemetry-dir',telemetryDir);
  if(errorReports)args.push('--error-reports');
  const child=spawn(process.execPath,args,{cwd:tree,stdio:['ignore','pipe','pipe','ipc'],detached:true});
  let startup='';child.stdout.on('data',(chunk)=>{startup+=String(chunk);});child.stderr.on('data',(chunk)=>{startup+=String(chunk);});
  let url='';
  child.on('message', message => {
    if(typeof message==='object'&&message!==null&&'kind' in message&&message.kind==='preview-ready'&&'pid' in message&&message.pid===child.pid&&'port' in message&&typeof message.port==='number'&&Number.isInteger(message.port)&&message.port>0&&message.port<=65535) url=`http://127.0.0.1:${message.port}`;
  });
  /** @type {Promise<void>} */
  const exited = new Promise(resolve => { child.once('close', () => { resolve(); }); });
  /** @type {Promise<void>|null} */ let closing = null;
  function close() { return (closing ??= (async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
      const timer = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* reaped */ } }, 2000);
      try { await exited; } finally { clearTimeout(timer); }
    } else { await exited; }
    signal?.removeEventListener('abort', abort);
  })()); }
  function abort() { void close(); }
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
  // Serve the completed bytes with production headers, without importing the build's generation plugins again.
  const deadline=Date.now()+120000;
  try {while(Date.now()<deadline){signal?.throwIfAborted();if(child.exitCode!==null) throw new Error(`preview exited: ${startup}`);if(url!==''&&await previewReady(`${url}/version.json`,Math.min(1000,Math.max(1,deadline-Date.now())))) return {url,close:()=>{void close();},closed:exited};await new Promise((resolve)=>{setTimeout(resolve,100);});} throw new Error(`preview never served: ${startup}`);}catch(e){await close();throw e;}
}
/** @param {string} path @returns {unknown} */
export function readJson(path) {return existsSync(path) ? JSON.parse(readFileSync(path,'utf8')) : undefined;}

/** Content identity excludes harness / baseline / non-build documents, but includes every other exported build input.
 * @param {string} root @param {string} sha */
export function runtimeTree(root,sha) {
  const patterns=EXPORT_IGNORE;
  const entries=execFileSync('git',['ls-tree','-r',sha],{cwd:root,encoding:'utf8',maxBuffer:16*1024**2}).trim().split('\n');
  const temp=mkdtempSync(join(tmpdir(),'parity-key-'));
  try {
    execFileSync('git',['init','-q',temp]);writeFileSync(join(temp,'ignore'),patterns);
    const paths=entries.map((entry)=>entry.split('\t')[1]??'');
    const check=execFileSync('git',['-C',temp,'-c',`core.excludesFile=${join(temp,'ignore')}`,'check-ignore','--no-index','--stdin'],{input:paths.join('\n'),encoding:'utf8',maxBuffer:64*1024**2});
    const ignored=new Set(check.trim().split('\n'));
    const inputs=entries.filter((entry)=>{const path=entry.split('\t')[1]??'';return !ignored.has(path)&&(!path.startsWith('test/')||path.startsWith('test/pins/'))&&!path.startsWith('src/scripts/parity/')&&path!=='scripts/parity.mjs';});
    return createHash('sha256').update(`parity-build-v3-pins\n${process.version}\n${patterns}\n${inputs.join('\n')}`).digest('hex');
  } finally {rmSync(temp,{recursive:true,force:true});}
}

/** Atomic cache publication + process-owned directory lock; an interrupted build is never a hit.
 * Target-SHA parity metadata is exported separately even on a runtime-cache hit.
 * @param {string} root @param {string} sha @param {string} [cacheRoot]
 * @param {(tree:string,sha:string)=>void|Promise<void>} [build] */
export async function cachedTree(root,sha,cacheRoot=join(homedir(),'.cache/wildshard-parity'),build=buildTree) {
  const key=runtimeTree(root,sha),dir=join(cacheRoot,key),lock=`${dir}.lock`,started=performance.now();
  mkdirSync(cacheRoot,{recursive:true});
  const valid=()=>existsSync(join(dir,'ready.json'))&&existsSync(join(dir,'tree/dist/version.json'));
  let owned=false;
  while(!owned) {
    try {mkdirSync(lock);writeFileSync(join(lock,'pid'),String(process.pid));owned=true;} catch(error) {
      if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;
      const pid=readJsonNumber(join(lock,'pid'));
      if(pid){try{process.kill(pid,0);}catch{rmSync(lock,{recursive:true,force:true});continue;}}
      else if(Date.now()-statSync(lock).mtimeMs>1000){rmSync(lock,{recursive:true,force:true});continue;}
      if(performance.now()-started>240000)throw new Error('infrastructure: parity cache lock exceeded4min',{cause:error});
      await new Promise((resolve)=>{setTimeout(resolve,100);});
    }
  }
  const hit=valid(); let lease='';
  try {
    if(!hit) {
      let exported=/** @type {ReturnType<typeof exportTree>|undefined} */(undefined);
      try {
        exported=exportTree(root,sha);await build(exported.tree,sha);
        rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
        renameSync(exported.tree,join(dir,'tree'));writeFileSync(join(dir,'ready.json'),JSON.stringify({key,sha}));
      } finally {exported?.cleanup();}
    }
    // Readers and eviction share the entry lock. Keep active previews safe until cleanup, including cache hits.
    const users=`${dir}.users`;mkdirSync(users,{recursive:true});lease=mkdtempSync(join(users,`${process.pid}-`));
  } finally {rmSync(lock,{recursive:true,force:true});}
  const fixtures=mkdtempSync(join(tmpdir(),'parity-fixtures-'));
  try {
    const archive=execFileSync('git',['archive',sha,'--','test/parity'],{cwd:root,maxBuffer:64*1024**2});
    execFileSync('tar',['-x','-C',fixtures],{input:archive,maxBuffer:64*1024**2});
    return {tree:join(dir,'tree'),fixtures,hit,key,cleanup:()=>{rmSync(fixtures,{recursive:true,force:true});rmSync(lease,{recursive:true,force:true});}};
  }catch(error){rmSync(fixtures,{recursive:true,force:true});rmSync(lease,{recursive:true,force:true});throw error;}
}
/** @param {string} path */
function readJsonNumber(path) {try{return Number(readFileSync(path,'utf8'));}catch{return 0;}}

/** @param {string} tree @param {string} sha */
// The harness overlays historical trees whose buildIdentity has no sourceBuildId; every one reads WS_BUILD_ID first.
function buildTree(tree,sha) {
  /** @type {import('node:child_process').ExecFileSyncOptions} */
  const options={cwd:tree,env:{...process.env,WS_BUILD_ID:`${sha.slice(0,7)}-${Date.now().toString(36)}`},stdio:'pipe',maxBuffer:16*1024**2};
  // Use this harness's lane even when the historical oracle predates it. One lease owns the whole build pipeline.
  const lane=fileURLToPath(new URL('../heavy-lane.py',import.meta.url));
  execFileSync('python3',[lane,'build','--','bash','-c',
    'if [ -f src/scripts/gen.mjs ]; then node src/scripts/gen.mjs --inputs-only || exit; fi; if [ -f scripts/build-shardfiles.mjs ]; then node scripts/build-shardfiles.mjs || exit; fi; if [ -f src/scripts/build-app.mjs ]; then node src/scripts/build-app.mjs --mode preview; else pnpm exec vite build; fi'],options);
}
