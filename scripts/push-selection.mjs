import {execFileSync} from 'node:child_process';

/** Complete pushed ranges, never an arbitrary recent commit or a time-budgeted subset.
 * @param {string | undefined} refs @param {string} [cwd]
 * @returns {{mode:'full'|'related'|'docs',files:string[],reason:string}} */
export function pushSelection(refs,cwd=process.cwd()) {
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
  if(changed.length>0&&changed.every(file=>file.endsWith('.md')||/^(?:docs|plans)\//u.test(file)))return {mode:'docs',files:changed,reason:'only Markdown/docs/plans'};
  const harness=changed.find(file=>/(^|\/)package\.json$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^(?:scripts|\.githooks|\.github|public|out|test\/(?:fixtures|pins)|src\/test)\/|^(?:vitest|vite)\.|^tsconfig|^[^/]+\.json$|^test\/(?:setup|.*config)\./u.test(file));
  if(harness!==undefined)return {mode:'full',files:changed,reason:`test/config/dependency harness: ${harness}`};
  if(changed.length===0)return {mode:'full',files:[],reason:'no changed paths; verify full tree'};
  return {mode:'related',files:changed,reason:'complete pushed source diff (J193)'};
}
