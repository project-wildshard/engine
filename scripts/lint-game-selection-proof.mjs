// Real Oxlint CLI in a tiny owned tree; ignored-only selection must run full lint.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';

const owner=process.cwd(),base=resolve(process.argv[2]??'tmp/lint-game-selection-proof');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-')),began=performance.now();
try{
 execFileSync('git',['init','--quiet','--initial-branch=main',root]);
 for(const name of ['src/client/engine','src/shared/engine','src/server/engine','src/client/game','src/shared/game','src/server/game','src/cook/game','src/client/host','src/shared/host','src/server/host','src/client/app','scripts','lint','vite'])mkdirSync(join(root,name),{recursive:true});
 copyFileSync(join(owner,'scripts/lint-game.mjs'),join(root,'scripts/lint-game.mjs'));
 // Use the actual declared native-tool resolver; do not fake the CLI/result.
 symlinkSync(join(owner,'scripts/lint-tools.mjs'),join(root,'scripts/lint-tools.mjs'));
 writeFileSync(join(root,'.oxlintrc.json'),JSON.stringify({rules:{'no-debugger':'error','no-unused-vars':'off'},ignorePatterns:['**/*.generated.*']}));
 const generated='src/client/game/bytes.generated.ts',active='src/client/game/active.ts';
 writeFileSync(join(root,generated),'debugger;');writeFileSync(join(root,active),'export const value=1;');
 /** @param {string[]} files */
 const run=files=>spawnSync(process.execPath,['scripts/lint-game.mjs',...files],{cwd:root,env:{...process.env,PATH:[join(owner,'node_modules/.bin'),process.env.PATH??''].join(delimiter),WS_PUSH_LINT_THREADS:'1'},encoding:'utf8',timeout:8000});
 const ignored=run([generated]);assert.equal(ignored.status,0,ignored.stdout+ignored.stderr);assert.match(ignored.stderr,/checking the declared selection/u);
 writeFileSync(join(root,active),'debugger;');
 const hiddenRed=run(['src/client/game/missing.ts']);assert.notEqual(hiddenRed.status,0);assert.match(hiddenRed.stdout+hiddenRed.stderr,/no-debugger/u,'Unknown selection must fall back and find the real source error');
 const missingGenerated=run(['src/client/game/missing.generated.ts']);assert.notEqual(missingGenerated.status,0);assert.match(missingGenerated.stdout+missingGenerated.stderr,/no-debugger/u,'Nonexistent generated-looking paths cannot use the configured-ignore fast path');
 const mixed=run([generated,active]);assert.notEqual(mixed.status,0);assert.match(mixed.stdout+mixed.stderr,/no-debugger/u);
 writeFileSync(join(root,active),'export const value=1;');assert.equal(run([active]).status,0);
 console.log(JSON.stringify({actualOxlint:true,existingGeneratedScopeChecked:true,unknownSelectionFallsBack:true,missingGeneratedRefused:true,mixedSourceErrorRefused:true,normalSelectionGreen:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(root,{recursive:true,force:true});}
