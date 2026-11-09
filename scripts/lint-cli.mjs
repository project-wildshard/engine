import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {lintEnvironment} from './lint-tools.mjs';

const root=resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,[resolve(root,'node_modules/oxlint/bin/oxlint'),...process.argv.slice(2)],{
  stdio:'inherit',env:lintEnvironment(root),
});
if(result.error!==undefined)console.error(result.error.message);
process.exitCode=result.status??1;
