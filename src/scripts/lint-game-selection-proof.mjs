// Real Oxlint CLI in a tiny owned tree; ignored-only selection must run full lint.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,join,resolve} from 'node:path';
import ci21Tests from '../../lint/ci21-engine-tests.json' with {type:'json'};

const owner=process.cwd(),base=resolve(process.argv[2]??'tmp/lint-game-selection-proof');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-')),began=performance.now();
try{
 execFileSync('git',['init','--quiet','--initial-branch=main',root]);
 for(const name of ['src/client/engine','src/shared/engine','src/server/engine','src/client/game','src/shared/game','src/server/game','src/cook/game','src/client/host','src/shared/host','src/server/host','src/client/app','scripts','lint','vite'])mkdirSync(join(root,name),{recursive:true});
 copyFileSync(join(owner,'src/scripts/lint-game.mjs'),join(root,'src/scripts/lint-game.mjs'));
 copyFileSync(join(owner,'lint/ci21-engine-tests.json'),join(root,'lint/ci21-engine-tests.json'));
 // Use the actual declared native-tool resolver; do not fake the CLI/result.
 symlinkSync(join(owner,'src/scripts/lint-tools.mjs'),join(root,'src/scripts/lint-tools.mjs'));
 writeFileSync(join(root,'.oxlintrc.json'),JSON.stringify({rules:{'no-debugger':'error','no-unused-vars':'off'},ignorePatterns:['**/*.generated.*']}));
 for(const file of ci21Tests){mkdirSync(join(root,dirname(file)),{recursive:true});writeFileSync(join(root,file),'export const value=1;');}
 const generated='src/client/game/bytes.generated.ts',active='src/client/game/active.ts';
 writeFileSync(join(root,generated),'debugger;');writeFileSync(join(root,active),'export const value=1;');
 /** @param {string[]} files */
 const run=files=>spawnSync(process.execPath,['src/scripts/lint-game.mjs',...files],{cwd:root,env:{...process.env,PATH:[join(owner,'node_modules/.bin'),process.env.PATH??''].join(delimiter),WS_PUSH_LINT_THREADS:'1'},encoding:'utf8',timeout:8000});
 const ignored=run([generated]);assert.equal(ignored.status,0,ignored.stdout+ignored.stderr);assert.match(ignored.stderr,/checking the declared selection/u);
 writeFileSync(join(root,active),'debugger;');
 const hiddenRed=run(['src/client/game/missing.ts']);assert.notEqual(hiddenRed.status,0);assert.match(hiddenRed.stdout+hiddenRed.stderr,/no-debugger/u,'Unknown selection must fall back and find the real source error');
 const missingGenerated=run(['src/client/game/missing.generated.ts']);assert.notEqual(missingGenerated.status,0);assert.match(missingGenerated.stdout+missingGenerated.stderr,/no-debugger/u,'Nonexistent generated-looking paths cannot use the configured-ignore fast path');
 const mixed=run([generated,active]);assert.notEqual(mixed.status,0);assert.match(mixed.stdout+mixed.stderr,/no-debugger/u);
 writeFileSync(join(root,active),'export const value=1;');assert.equal(run([active]).status,0);
 const ci21=ci21Tests[0];if(ci21===undefined)throw new Error('CI21 root admission selection is empty');
 mkdirSync(join(root,dirname(ci21)),{recursive:true});writeFileSync(join(root,ci21),'debugger;');
 const selectedRoot=run([ci21]);assert.notEqual(selectedRoot.status,0);assert.match(selectedRoot.stdout+selectedRoot.stderr,/no-debugger/u,'A selected restored root test must reach the real linter');
 const completeRoot=run([]);assert.notEqual(completeRoot.status,0);assert.match(completeRoot.stdout+completeRoot.stderr,/no-debugger/u,'Normal complete lint must include restored root tests');
 const fallbackRoot=run(['src/client/game/missing.ts']);assert.notEqual(fallbackRoot.status,0);assert.match(fallbackRoot.stdout+fallbackRoot.stderr,/no-debugger/u,'Fallback must find an error only in a restored root test');
 writeFileSync(join(root,ci21),'export const value=1;');assert.equal(run([ci21]).status,0);assert.equal(run([]).status,0);
 unlinkSync(join(root,ci21));const absentRoot=run([]);assert.notEqual(absentRoot.status,0);assert.match(absentRoot.stdout+absentRoot.stderr,/restored engine tests are missing/u);
 const absentSelected=run([ci21]);assert.notEqual(absentSelected.status,0);assert.match(absentSelected.stdout+absentSelected.stderr,/restored engine tests are missing/u);
 writeFileSync(join(root,ci21),'export const value=1;');
 writeFileSync(join(root,'.oxlintrc.json'),JSON.stringify({rules:{'no-debugger':'error','no-unused-vars':'off'},ignorePatterns:['**/*.generated.*',ci21]}));
 const ignoredRoot=run([]);assert.notEqual(ignoredRoot.status,0);assert.match(ignoredRoot.stdout+ignoredRoot.stderr,/restored engine tests are not eligible/u);
 const ignoredSelected=run([ci21]);assert.notEqual(ignoredSelected.status,0);assert.match(ignoredSelected.stdout+ignoredSelected.stderr,/restored engine tests are not eligible/u);
 writeFileSync(join(root,'.oxlintrc.json'),JSON.stringify({rules:{'no-debugger':'error','no-unused-vars':'off'},ignorePatterns:['**/*.generated.*']}));assert.equal(run([]).status,0);
 console.log(JSON.stringify({actualOxlint:true,existingGeneratedScopeChecked:true,unknownSelectionFallsBack:true,missingGeneratedRefused:true,mixedSourceErrorRefused:true,normalSelectionGreen:true,restoredRootSelectionRefused:true,completeRootSelectionRefused:true,restoredRootSelectionGreen:true,restoredRootFallbackRefused:true,restoredRootCompleteGreen:true,missingRootRefused:true,missingRootSelectedRefused:true,ignoredRootCompleteRefused:true,ignoredRootSelectedRefused:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(root,{recursive:true,force:true});}
