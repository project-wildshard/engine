import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';

// CI calls this selector before pnpm install. Only local stamp verification
// loads the installed revision helpers; hosted classification stays Node-only.
const revisionModule=createRequire(import.meta.url);

/** A generated digest is represented by its changed inputs, never trusted by name.
 * @param {string} file @param {string} root */
function verifiedStamp(file,root){
 try{
  if(!lstatSync(resolve(root,file)).isFile())return false;
  const value=/** @type {unknown} */(JSON.parse(readFileSync(resolve(root,file),'utf8')));
  const expected=file==='scripts/renderer-revision.json'
   ?/** @type {typeof import('./renderer-revision.mjs')} */(revisionModule('./renderer-revision.mjs')).rendererRevision(root)
   :/** @type {typeof import('./shardfile-validation-revision.mjs')} */(revisionModule('./shardfile-validation-revision.mjs')).shardfileValidationRevision(root);
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&'revision'in value&&value.revision===expected;
 }catch{return false;}
}

/** Recorded test clocks: they decide how files are packed into shards, never what a test proves. An explicit list: a
 * new durations-shaped file is harness until it is named here. */
export const TIMING_RECORDS=Object.freeze(['test/durations.json','test/durations-ring1.json','test/durations-source.json','test/durations-observations.jsonl']);

/** Complete pushed ranges, never an arbitrary recent commit or a time-budgeted subset. `timingRecords` (land's
 * rebase rule only) counts the timing records as data, not harness: a rebase that only merged clocks stays carried.
 * @param {string | undefined} refs @param {string} [cwd] @param {{hosted?:boolean,timingRecords?:boolean}} [options]
 * @returns {{mode:'full'|'related'|'docs',files:string[],reason:string}} */
export function pushSelection(refs,cwd=process.cwd(),options={}) {
  if(!refs?.trim())return {mode:'full',files:[],reason:'no complete push range'};
  /** @type {Set<string>} */ const files=new Set();
  for(const line of refs.trim().split('\n')){
    const [,local,,remote]=line.trim().split(/\s+/u);
    if(!/^[a-f0-9]{40}$/u.test(local??'')||!/^[a-f0-9]{40}$/u.test(remote??''))throw new Error('Invalid push range');
    if(/^0+$/u.test(local))continue;
    if(/^0+$/u.test(remote))return {mode:'full',files:[],reason:'new remote ref'};
    for(const path of execFileSync('git',['diff','--name-only','-z',remote,local],{cwd,encoding:'utf8'}).split('\0').filter(Boolean))files.add(path);
  }
  const changed=[...files].sort();
  /** @type {string[]} */const inputs=[];
  for(const file of changed){
    if(!options.hosted&&['scripts/renderer-revision.json','scripts/validation-revision.json'].includes(file)){
      if(!verifiedStamp(file,cwd))return {mode:'full',files:changed,reason:`Generated stamp does not match its actual inputs: ${file}`};
      continue;
    }
    if(options.timingRecords&&TIMING_RECORDS.includes(file))continue;
    // These files run on hosted CI. Their independent static checks stay local.
    if(!options.hosted&&file.startsWith('.github/'))continue;
    if(file.endsWith('.md')&&(/^(?:docs|plans|project\/journal)\//u.test(file)||!file.includes('/'))){
      try{
        execFileSync('git',['grep','--quiet','--fixed-strings','-e',file,'--','src','test','scripts','lint','vite'],{cwd,stdio:'pipe'});
        return {mode:'full',files:changed,reason:`Markdown is a declared source/test/filesystem input: ${file}`};
      }catch(error){
        if(!(error instanceof Error&&'status'in error&&error.status===1))return {mode:'full',files:changed,reason:`Cannot prove Markdown has no code consumers: ${file}`};
      }
      continue;
    }
    inputs.push(file);
  }
  if(changed.length>0&&inputs.length===0)return {mode:'docs',files:changed,reason:'Only hosted CI, verified generated stamps, timing records (land) or Markdown without declared code consumers; local static/asks checks retained'};
  const harness=inputs.find(file=>/(^|\/)package\.json$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^(?:\.githooks|public|out|test\/(?:fixtures|pins)|src\/test)\/|^(?:vitest|vite)(?:\.|\/)|^tsconfig|^[^/]+\.json$|^test\/(?:setup|.*config|durations[^/]*)\.|^scripts\/(?:vitest[-.]|push-vitest\.config\.|push-budget\.|push-duration-sequencer\.|test-shard-plan\.|engine-ci(?:\.config|-plan|-sequencer|-budget)\.|format-hook\.|bake-loader\.|sim-node-loader\.|lift-pending\.|test-quarantine\.|cpu-admission\.|cpu-broker\.|heavy-lane)/u.test(file));
  if(harness!==undefined)return {mode:'full',files:changed,reason:`test/config/dependency harness: ${harness}`};
  if(changed.length===0)return {mode:'full',files:[],reason:'no changed paths; verify full tree'};
  const invisible=inputs.find(file=>! /^(?:src|test|scripts)\/.+\.[cm]?[jt]sx?$/u.test(file));
  if(invisible!==undefined)return {mode:'full',files:changed,reason:`input has no proven import-graph coverage: ${invisible}`};
  return {mode:'related',files:inputs,reason:'complete pushed source/tool diff; every module still needs an actual test edge (J193)'};
}
