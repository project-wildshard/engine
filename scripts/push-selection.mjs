import {execFileSync} from 'node:child_process';

/** Complete pushed ranges, never an arbitrary recent commit or a time-budgeted subset.
 * @param {string | undefined} refs @param {string} [cwd] @param {{hosted?:boolean}} [options]
 * @returns {{mode:'full'|'related'|'docs',files:string[],reason:string,tests?:string[]}} */
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
  /** @type {Set<string>} */const docTests=new Set();
  for(const file of changed){
    // These files run on hosted CI. Their independent static checks stay local.
    if(!options.hosted&&file.startsWith('.github/'))continue;
    if(file.endsWith('.md')&&(/^(?:docs|plans|project\/journal)\//u.test(file)||!file.includes('/'))){
      const readers=markdownReaders(file,cwd);
      if(!Array.isArray(readers))return {mode:'full',files:changed,reason:readers.reason};
      for(const test of readers)docTests.add(test);
      continue;
    }
    inputs.push(file);
  }
  if(changed.length>0&&inputs.length===0)return {mode:'docs',files:changed,tests:[...docTests].sort(),reason:`Only hosted CI or Markdown whose readers are the docs lane's checks${docTests.size>0?` and ${docTests.size} reading test(s)`:''}; local static/asks checks retained`};
  const harness=inputs.find(file=>/(^|\/)package\.json$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^(?:\.githooks|public|out|test\/(?:fixtures|pins)|src\/test)\/|^(?:vitest|vite)(?:\.|\/)|^tsconfig|^[^/]+\.json$|^test\/(?:setup|.*config)\.|^scripts\/(?:vitest[-.]|push-vitest\.config\.|push-budget\.|push-duration-sequencer\.|test-shard-plan\.|test-timings\.|engine-ci(?:\.config|-plan|-sequencer|-budget)\.|format-hook\.|bake-loader\.|sim-node-loader\.|lift-pending\.|test-quarantine\.|cpu-admission\.|cpu-broker\.|heavy-lane)/u.test(file));
  if(harness!==undefined)return {mode:'full',files:changed,reason:`test/config/dependency harness: ${harness}`};
  if(changed.length===0)return {mode:'full',files:[],reason:'no changed paths; verify full tree'};
  const invisible=inputs.find(file=>! /^(?:src|test|scripts)\/.+\.[cm]?[jt]sx?$/u.test(file));
  if(invisible!==undefined)return {mode:'full',files:changed,reason:`input has no proven import-graph coverage: ${invisible}`};
  return {mode:'related',files:inputs,reason:'complete pushed source/tool diff; every module still needs an actual test edge (J193)'};
}

/** Scripts that read a root doc against the real tree, and the docs-lane check that runs each (EV9). Both docs lanes
 * (.githooks/push-checks.mjs, scripts/ci-static.sh docs) run check:parity; pre-push and ci job 1 run the changelog
 * check on every push. */
export const DOC_READER_CHECKS=Object.freeze({'scripts/agent-parity.mjs':'check:parity','scripts/changelog.mjs':'changelog check'});
const vitestFile=/^(?:test\/.+\.test\.(?:ts|mjs)|src\/.+\.test\.ts)$/u;

/** Who reads a Markdown file: code that names its path as a whole string literal, or as a string's last path segments
 * (`${root}/docs/x.md`). Prose and comments (AGENTS.md "Disk") never read it. Reading tests run in the docs lane; a
 * known script reader is covered by its docs-lane check; any other reader has no proven test edge, so the push runs full.
 * @param {string} file @param {string} cwd @returns {string[]|{reason:string}} */
function markdownReaders(file,cwd){
  const path=file.replace(/[.[\]()*+?{}|^$\\]/gu,'\\$&');
  let listed;
  try{
    listed=execFileSync('git',['grep','-l','-E','-e',`['"\`/](\\./)?${path}['"\`]`,'--','src','test','scripts','lint','vite'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  }catch(error){
    if(error instanceof Error&&'status'in error&&error.status===1)return [];
    return {reason:`Cannot prove Markdown has no code consumers: ${file}`};
  }
  /** @type {string[]} */const tests=[];
  for(const reader of listed.split('\n').filter(Boolean)){
    if(vitestFile.test(reader))tests.push(reader);
    else if(!Object.hasOwn(DOC_READER_CHECKS,reader))return {reason:`Markdown is a declared source/test/filesystem input: ${file} (read by ${reader})`};
  }
  return tests;
}
