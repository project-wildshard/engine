// CF4: likely source commits from exact Git bytes; never execute the failing imports.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
import * as v from 'valibot';
import { gitSourceView } from './git-source-view.mjs';

const SHA=/^[0-9a-f]{40}$/u;
/** @param {string} path */
function repositoryPath(path){
  if(path.includes('\\')||path.startsWith('/')||path.split('/').some(part=>part===''||part==='..'||part==='.'))return false;
  for(const character of path){
    const point=character.codePointAt(0);
    if(point===undefined||point<32||point===127)return false;
  }
  return true;
}
/** @param {string} path */
const safePath=path=>/^(?:src|scripts|test|admin|api|drafts|lint|vite)\//u.test(path)&&repositoryPath(path);
const packageSchema=v.object({exports:v.optional(v.record(v.string(),v.string()))});

/** @param {string} root @param {string[]} args */
function git(root,args){return execFileSync('git',['--literal-pathspecs',...args],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024}).trim();}

/** Fetch a dependency wave in one promisor request instead of one RPC per
 * cat-file miss. Every byte still comes from the exact immutable blob id.
 * @param {string} root @param {ReturnType<typeof gitSourceView>} view
 * @param {string[]} paths @param {boolean} promisor */
function primeSources(root,view,paths,promisor){
  if(promisor && paths.length>0){
    const hashes=[...new Set(paths.map(path=>view.files.get(path)).filter(hash=>hash!==undefined))];
    const replies=execFileSync('git',['--no-lazy-fetch','cat-file','--batch-check=%(objectname) %(objecttype)'],{
      cwd:root,input:`${hashes.join('\n')}\n`,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,
    }).trim().split('\n');
    /** @type {string[]} */ const missing=[];
    if(replies.length!==hashes.length)throw new Error('Invalid immutable blob inventory reply');
    for(let i=0;i<hashes.length;i++){
      const [hash,kind]=replies[i]?.split(' ')??[];
      if(hash!==hashes[i] || (kind!=='blob' && kind!=='missing'))throw new Error('Invalid immutable blob identity');
      if(kind==='missing' && hash!==undefined)missing.push(hash);
    }
    if(missing.length>0)execFileSync('git',['fetch','--no-tags','--no-write-fetch-head','--filter=blob:none','origin','--stdin'],{
      cwd:root,input:`${missing.join('\n')}\n`,timeout:10000,maxBuffer:8*1024*1024,
    });
  }
  view.prime(paths);
}

/** Resolve only literal relative imports and the committed workspace exports.
 * @param {string} root @param {ReturnType<typeof gitSourceView>} view
 * @param {string[]} roots @param {boolean} promisor */
function closure(root,view,roots,promisor){
  const seen=new Set(roots);
  /** @type {Set<string>} */ const missing=new Set();
  let pending=[...roots];
  while(pending.length>0){
    if(seen.size>3000)throw new Error('dependency inventory exceeds 3000 files');
    for(const file of pending)if(!view.files.has(file))missing.add(file);
    // Non-code imports still belong to the commit/path inventory, but their
    // payload cannot contain another literal module import to discover.
    const batch=pending.filter(file=>view.files.has(file)&&/\.[cm]?[jt]sx?$/u.test(file));
    pending=[];primeSources(root,view,batch,promisor);
    for(const file of batch){
      for(const row of ts.preProcessFile(view.read(file).toString('utf8'),true,true).importedFiles){
        const source=row.fileName.split('?')[0]??row.fileName;
        let target=source.startsWith('.')?posix.normalize(posix.join(dirname(file),source)):null;
        const workspace=/^@wildshard\/([^/]+)(?:\/(.+))?$/u.exec(source);
        if(workspace?.[1]==='format')continue; // Installed: the lockfile pins it, not this tree.
        if(workspace!==null){
          const manifest=`src/${workspace[1]}/package.json`;seen.add(manifest);
          if(!view.files.has(manifest)){missing.add(manifest);continue;}
          const entry=v.parse(packageSchema,JSON.parse(view.read(manifest).toString('utf8'))).exports?.[workspace[2]===undefined?'.':`./${workspace[2]}`];
          if(entry===undefined||!entry.startsWith('./')){missing.add(source);continue;}
          target=posix.normalize(`src/${workspace[1]}/${entry.slice(2)}`);
        }
        if(target===null)continue;
        if(!repositoryPath(target))throw new Error(`dependency escapes repository source: ${target}`);
        const candidates=[target,`${target}.ts`,`${target}.tsx`,`${target}.mts`,`${target}.mjs`,`${target}.js`,`${target}.json`,`${target}/index.ts`,
          ...(target.endsWith('.js')?[`${target.slice(0,-3)}.ts`]:[]),...(target.endsWith('.mjs')?[`${target.slice(0,-4)}.mts`]:[])];
        const found=candidates.find(path=>view.files.has(path));
        if(found===undefined){missing.add(target);continue;}
        if(!seen.has(found)){seen.add(found);pending.push(found);}
      }
    }
  }
  return {paths:[...seen],missing:[...missing]};
}

/** Never confuse a release-only workflow success with a green push.
 * @param {string} sha @param {(path:string)=>unknown} [query] */
export function priorGreen(sha,query){
  const repo=process.env.GITHUB_REPOSITORY??'',run=process.env.GITHUB_RUN_ID??'';
  if(!/^[\w.-]+\/[\w.-]+$/u.test(repo)||!/^\d+$/u.test(run)||!SHA.test(sha))throw new Error('missing exact push run identity');
  const api=query??((/** @type {string} */ path)=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024})));
  const current=v.parse(v.object({event:v.string(),head_branch:v.string(),head_sha:v.string(),created_at:v.string(),path:v.string()}),api(`repos/${repo}/actions/runs/${run}`));
  if(current.event!=='push'||current.head_branch!=='main'||current.head_sha!==sha||current.path!=='.github/workflows/deploy.yml')throw new Error('not the exact main push run');
  const runs=v.parse(v.object({workflow_runs:v.array(v.object({event:v.string(),head_branch:v.string(),head_sha:v.string(),status:v.string(),conclusion:v.nullable(v.string()),created_at:v.string(),path:v.string()}))}),
    api(`repos/${repo}/actions/workflows/deploy.yml/runs?branch=main&event=push&status=success&per_page=100`)).workflow_runs;
  const green=runs.filter(row=>row.event==='push'&&row.head_branch==='main'&&row.status==='completed'&&row.conclusion==='success'
    &&row.path==='.github/workflows/deploy.yml'&&row.created_at<current.created_at&&SHA.test(row.head_sha))
    .sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  if(green===undefined)throw new Error('no prior successful main push in the bounded inventory');
  return green.head_sha;
}

/** At most three candidates, prioritizing the failing file over its imports.
 * Missing generated imports stay visible; no checkout, producer or build runs.
 * @param {string} root @param {string} base @param {string} sha @param {string[]} files */
export function culpritReport(root,base,sha,files){
  if(!SHA.test(base)||!SHA.test(sha)||files.length===0||files.length>16||files.some(file=>!safePath(file)))throw new Error('invalid culprit report inputs');
  git(root,['merge-base','--is-ancestor',base,sha]);
  const remote=spawnSync('git',['config','--bool','--get','remote.origin.promisor'],{cwd:root,encoding:'utf8',timeout:10000});
  if(remote.error!==undefined)throw remote.error;
  if(remote.status!==0 && remote.status!==1)throw new Error('Cannot read immutable source remote');
  const promisor=remote.status===0&&remote.stdout.trim()==='true';
  const currentView=gitSourceView(root,sha),previousView=gitSourceView(root,base);
  const current=closure(root,currentView,files,promisor);
  // Checkout already hydrated current source. Fetch its historical counterparts
  // together so a deep old import chain does not need a round trip per level.
  // Old-only imports are still discovered and fetched by the unchanged walk.
  if(promisor)primeSources(root,previousView,current.paths.filter(file=>previousView.files.has(file)&&/\.[cm]?[jt]sx?$/u.test(file)),true);
  const previous=closure(root,previousView,files,promisor);
  const paths=[...new Set([...current.paths,...previous.paths])].sort((a,b)=>a.localeCompare(b));
  const commits=(/** @type {string[]} */ selected)=>git(root,['log','-n','3','--format=%H',`${base}..${sha}`,'--',...selected]).split('\n').filter(Boolean);
  const direct=commits(files),related=commits(paths);
  const candidates=[...new Set([...direct,...related])].slice(0,3).map(commit=>{
    const [subject='',assistedBy='']=git(root,['show','-s','--format=%s%x00%(trailers:key=Assisted-by,valueonly)',commit]).split('\0');
    const attribution=assistedBy.trim();
    return {sha:commit,subject,assistedBy:attribution.length===0?'no Assisted-by trailer':attribution,match:direct.includes(commit)?'failing file':'literal import'};
  });
  return {base,sha,files,candidates,missingImports:[...new Set([...current.missing,...previous.missing])].sort((a,b)=>a.localeCompare(b))};
}

/** Fetch the immutable commit graph within the existing Git deadline.
 * A fixed depth cannot cover a long red window, even when its exact base is known.
 * @param {string} root @param {string} sha */
export function prepareHistory(root,sha){
  if(!SHA.test(sha))throw new Error('invalid history revision');
  if(git(root,['rev-parse','--is-shallow-repository'])==='true')git(root,['fetch','--no-tags','--filter=blob:none','--unshallow','origin',sha]);
}

function main(){
  const option=(/** @type {string} */ key)=>process.argv.find(value=>value.startsWith(`--${key}=`))?.slice(key.length+3);
  const root=resolve(option('root')??'.'),sha=option('sha')??process.env.GITHUB_SHA??'',base=option('base')??priorGreen(sha);
  const files=v.parse(v.array(v.string()),JSON.parse(option('files')??'[]'));
  // checkout@v4 normally has one commit. Fetch the immutable graph within
  // the Git deadline; a missing ancestor remains unavailable.
  prepareHistory(root,sha);
  console.log(JSON.stringify(culpritReport(root,base,sha,files)));
}
if(process.argv[1]!==undefined&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{main();}catch(error){console.error(`CI culprit report unavailable: ${error instanceof Error?error.message:'invalid diagnostic input'}`);process.exitCode=1;}
}
