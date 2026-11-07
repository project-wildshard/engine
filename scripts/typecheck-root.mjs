#!/usr/bin/env node
// LS6: scenario tests are an incremental leaf of the same strict solution.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** CI forces a fresh scenario check; local no-change checks reuse its build info.
 * @param {{readonly CI?:string,readonly GITHUB_ACTIONS?:string}} [environment] */
export function rootTypecheckArguments(environment=process.env) {
  return ['-b','test/tsconfig.json','--builders','1',...(environment.CI || environment.GITHUB_ACTIONS ? ['--force'] : [])];
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  if(process.argv.length!==2){console.error('typecheck-root: expected no arguments');process.exit(2);}
  const root=resolve(import.meta.dirname,'..'),args=rootTypecheckArguments();
  const result=spawnSync(resolve(root,'node_modules/.bin/tsc'),args,{cwd:root,stdio:'inherit'});
  if(result.error!==undefined)console.error(result.error.message);
  process.exitCode=result.status??1;
}
