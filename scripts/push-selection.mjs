import {execFileSync} from 'node:child_process';

/** Complete pushed ranges, never an arbitrary recent commit or a time-budgeted subset.
 * @param {string | undefined} refs @param {string} [cwd] @param {{hosted?:boolean}} [options]
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
  if(changed.length>0&&inputs.length===0)return {mode:'docs',files:changed,reason:'Only hosted CI or Markdown without declared code consumers; local static/asks checks retained'};
  const harness=inputs.find(file=>/(^|\/)package\.json$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^(?:\.githooks|public|out|test\/(?:fixtures|pins)|src\/test)\/|^(?:vitest|vite)(?:\.|\/)|^tsconfig|^[^/]+\.json$|^test\/(?:setup|.*config)\.|^scripts\/(?:vitest[-.]|push-vitest\.config\.|push-budget\.|push-duration-sequencer\.|test-shard-plan\.|test-timings\.|engine-ci(?:\.config|-plan|-sequencer|-budget)\.|format-hook\.|bake-loader\.|sim-node-loader\.|lift-pending\.|test-quarantine\.|cpu-admission\.|cpu-broker\.|heavy-lane)/u.test(file));
  if(harness!==undefined)return {mode:'full',files:changed,reason:`test/config/dependency harness: ${harness}`};
  if(changed.length===0)return {mode:'full',files:[],reason:'no changed paths; verify full tree'};
  const invisible=inputs.find(file=>! /^(?:src|test|scripts)\/.+\.[cm]?[jt]sx?$/u.test(file));
  if(invisible!==undefined)return {mode:'full',files:changed,reason:`input has no proven import-graph coverage: ${invisible}`};
  return {mode:'related',files:inputs,reason:'complete pushed source/tool diff; every module still needs an actual test edge (J193)'};
}
