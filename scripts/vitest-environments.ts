import {globSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {configDefaults,type ViteUserConfig,type TestProjectConfiguration} from 'vitest/config';

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
  const project=(name:'node'|'dom'):TestProjectConfiguration=>({...config,extends:false,test:{...test,name,isolate:true,pool:'forks',
    include:name==='node'?include:dom,exclude:name==='node'?[...exclude,...dom]:exclude,environment:name==='node'?'node':'happy-dom'}});
  return {...config,test:{...test,projects:[project('node'),project('dom')]}};
}
