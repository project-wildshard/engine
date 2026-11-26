#!/usr/bin/env node
// The lifted tree's lint, by the size of the ask. With paths (the commit lane) it lints those files: 1 s instead of the
// whole tree's 11, which alone broke the 8 s budget. With none (`pnpm check`, CI) it lints the tree.
import { spawnSync } from 'node:child_process';
import {existsSync,lstatSync} from 'node:fs';
import {lintEnvironment} from './lint-tools.mjs';
import {ensureBootStamps} from './boot-stamps.mjs';
import ci21Tests from '../../lint/ci21-engine-tests.json' with { type: 'json' };

const TREE = ['src/client/engine', 'src/shared/engine', 'src/server/engine', 'src/client/game', 'src/shared/game', 'src/server/game', 'src/cook/game', 'src/client/host', 'src/shared/host', 'src/server/host', 'src/client/app', 'scripts', 'lint', 'vite'];
const LIFTED = new RegExp(`^(?:${TREE.join('|')})/`, 'u');
const ENGINE_TESTS = new Set(ci21Tests);
const COMPLETE = [...TREE, ...ENGINE_TESTS];
const asked = process.argv.slice(2);
// LS1/LS9: type-aware lint resolves the ignored boot stamps; write them when this checkout never ran gen:inputs.
ensureBootStamps();
// Full static gates include this global policy even on a disjoint delta retry.
// Commit-only path checks keep their existing isolation from peer loose files.
if(asked.length===0){
 const {unadmittedBrowserImports}=await import('./browser-imports.mjs');
 const missing=unadmittedBrowserImports();
 if(missing.length>0)throw new Error(`Browser launch imports require admission: ${missing.join(', ')}`);
 // ZONE-SNAPSHOTS ZS1 (J507): no checked-in zone snapshots beyond the shrink-only baseline.
 const guard=spawnSync(process.execPath,['src/scripts/zone-snapshot-guard.mjs'],{stdio:'inherit'});
 if(guard.status!==0)process.exit(guard.status??1);
 // CHUNK-PARAM-REMOVAL CP23 (J522): no new chunk param read or write beyond the shrink-only baseline.
 const chunkGuard=spawnSync(process.execPath,['src/scripts/chunk-param-guard.mjs'],{stdio:'inherit'});
 if(chunkGuard.status!==0)process.exit(chunkGuard.status??1);
 // Meta QA 11-25 rows 82 and 84 (J505): no script pointing where nothing is (the kit's .githooks/script-paths.mjs, an
 // empty baseline: enforced).
 const scriptPaths=spawnSync(process.execPath,['.githooks/script-paths.mjs'],{stdio:'inherit'});
 if(scriptPaths.status!==0)process.exit(scriptPaths.status??1);
}
const threads = process.env.WS_PUSH_LINT_THREADS;
if (threads !== undefined && !/^[1-9]\d*$/u.test(threads)) throw new Error('Invalid push lint worker limit');
const files = asked.filter(path => LIFTED.test(path) || ENGINE_TESTS.has(path));
if (asked.length > 0 && files.length === 0) process.exit(0);
const options=['-c', '.oxlintrc.json', '--deny-warnings', ...(threads === undefined ? [] : ['--threads', threads])],environment=lintEnvironment();
/** A restored test must remain a real, eligible input, even beside other lintable files.
 * @param {string[]} required */
function checkRestoredTests(required){
 if(required.length===0)return;
 const missing=required.filter(path=>!existsSync(path)||!lstatSync(path).isFile());
 if(missing.length>0)throw new Error(`lint-game: restored engine tests are missing: ${missing.join(', ')}`);
 const listed=spawnSync('oxlint',['-c','.oxlintrc.json','--debug','files',...required],{encoding:'utf8',env:environment});
 if(listed.error!==undefined)throw listed.error;
 const eligible=new Set((listed.stdout??'').trim().split(/\r?\n/u));
 const ignored=required.filter(path=>!eligible.has(path));
 if(listed.status!==0||ignored.length>0)throw new Error(`lint-game: restored engine tests are not eligible: ${ignored.join(', ')}\n${listed.stderr??''}`);
}
if(ci21Tests.length===0)throw new Error('lint-game: restored engine test admission table is empty');
checkRestoredTests(asked.length===0?ci21Tests:files.filter(path=>ENGINE_TESTS.has(path)));

let run = spawnSync('oxlint', [...options,...(asked.length === 0 ? COMPLETE : files)], { stdio: asked.length===0?'inherit':'pipe',encoding:'utf8',env:environment });
if(asked.length>0){
  process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
  if(run.status!==0&&`${run.stdout??''}\n${run.stderr??''}`.includes('No files found to lint')){
    const generated=files.every(path=>/(?:^|\/)[^/]*\.generated\.[^/]+$/u.test(path)&&existsSync(path)&&lstatSync(path).isFile());
    console.error(generated?'lint-game: existing generated outputs have no configured lint inputs; checking the declared selection':'lint-game: selected paths have no eligible lint inputs; running the complete declared tree');
    if(!generated)checkRestoredTests(ci21Tests);
    run=spawnSync('oxlint',[...options,...(generated?['--no-error-on-unmatched-pattern',...files]:COMPLETE)],{stdio:'inherit',encoding:'utf8',env:environment});
  }
}
if (run.error !== undefined) throw run.error;
process.exit(run.status ?? 1);
