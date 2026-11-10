#!/usr/bin/env node
// The lifted tree's lint, by the size of the ask. With paths (the commit lane) it lints those files: 1 s instead of the
// whole tree's 11, which alone broke the 8 s budget. With none (`pnpm check`, CI) it lints the tree.
import { spawnSync } from 'node:child_process';
import {existsSync,lstatSync} from 'node:fs';
import {lintEnvironment} from './lint-tools.mjs';

const TREE = ['src/client/engine', 'src/shared/engine', 'src/server/engine', 'src/client/game', 'src/shared/game', 'src/server/game', 'src/cook/game', 'src/client/host', 'src/shared/host', 'src/server/host', 'src/client/app', 'scripts', 'lint', 'vite'];
const LIFTED = new RegExp(`^(?:${TREE.join('|')})/`, 'u');
const asked = process.argv.slice(2);
const threads = process.env.WS_PUSH_LINT_THREADS;
if (threads !== undefined && !/^[1-9]\d*$/u.test(threads)) throw new Error('Invalid push lint worker limit');
const files = asked.filter(path => LIFTED.test(path));
if (asked.length > 0 && files.length === 0) process.exit(0);
const options=['-c', '.oxlintrc.json', '--deny-warnings', ...(threads === undefined ? [] : ['--threads', threads])],environment=lintEnvironment();
let run = spawnSync('oxlint', [...options,...(asked.length === 0 ? TREE : files)], { stdio: asked.length===0?'inherit':'pipe',encoding:'utf8',env:environment });
if(asked.length>0){
  process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
  if(run.status!==0&&`${run.stdout??''}\n${run.stderr??''}`.includes('No files found to lint')){
    const generated=files.every(path=>/(?:^|\/)[^/]*\.generated\.[^/]+$/u.test(path)&&existsSync(path)&&lstatSync(path).isFile());
    console.error(generated?'lint-game: existing generated outputs have no configured lint inputs; checking the declared selection':'lint-game: selected paths have no eligible lint inputs; running the complete declared tree');
    run=spawnSync('oxlint',[...options,...(generated?['--no-error-on-unmatched-pattern',...files]:TREE)],{stdio:'inherit',encoding:'utf8',env:environment});
  }
}
if (run.error !== undefined) throw run.error;
process.exit(run.status ?? 1);
