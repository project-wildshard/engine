import {existsSync,globSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {configDefaults,type ViteUserConfig,type TestProjectConfiguration} from 'vitest/config';

/** VITEST-BENCH VB14: light node files proven to leave no state behind share a reused worker (`isolate: false`),
 * so each loads the common module graph once per worker instead of once per file. A file joins
 * `test/shared-worker-tests.json` only if it is green alone and in shared runs in many orders, and touches no
 * module mock, global stub, fake clock, environment variable or fresh-import contract. */
export const SHARED_WORKER_LIST='test/shared-worker-tests.json';

/** Explicit owners of the unchanged configured inventory. An annotation remains authoritative. */
export function withTestEnvironments(config:ViteUserConfig):ViteUserConfig{
  const root=config.root??process.cwd(),{projects:_projects,...test}=config.test??{};
  const include=test.include??configDefaults.include,exclude=test.exclude??configDefaults.exclude;
  const files=[...new Set(include.flatMap(pattern=>[...globSync(pattern,{cwd:root})]))].sort();
  const dom=files.filter(file=>{
    const environment=/@(?:vitest|jest)-environment\s+([\w-]+)/u.exec(readFileSync(resolve(root,file),'utf8'))?.[1]??'node';
    if(!['node','happy-dom','jsdom'].includes(environment))throw new Error(`Unsupported test environment ${environment}: ${file}`);
    return environment!=='node';
  });
  const included=new Set(files),shared=sharedWorkerFiles(root).filter(file=>included.has(file));
  const project=(name:'node'|'shared'|'dom'):TestProjectConfiguration=>({...config,extends:false,test:{...test,name,isolate:name!=='shared',pool:'forks',
    include:name==='node'?include:name==='shared'?shared:dom,
    exclude:name==='node'?[...exclude,...dom,...shared]:exclude,environment:name==='dom'?'happy-dom':'node'}});
  return {...config,test:{...test,projects:[project('node'),...(shared.length===0?[]:[project('shared')]),project('dom')]}};
}

/** The reviewed list, checked whole even when a config includes only some files (a CI shard): every entry exists
 * and is a node suite. A tree without the list (a proof's scratch repository) shares no worker. */
export function sharedWorkerFiles(root:string):string[]{
  const path=resolve(root,SHARED_WORKER_LIST);
  if(!existsSync(path))return [];
  const listed=JSON.parse(readFileSync(path,'utf8')) as unknown;
  if(!Array.isArray(listed)||!listed.every(file=>typeof file==='string'))throw new Error(`${SHARED_WORKER_LIST} must be an array of paths`);
  for(const file of listed){
    if(!existsSync(resolve(root,file)))throw new Error(`${SHARED_WORKER_LIST} names ${file}, which does not exist`);
    const environment=/@(?:vitest|jest)-environment\s+([\w-]+)/u.exec(readFileSync(resolve(root,file),'utf8'))?.[1]??'node';
    if(environment!=='node')throw new Error(`${SHARED_WORKER_LIST} names ${file}, a ${environment} suite: only node files share a worker`);
  }
  return listed;
}
