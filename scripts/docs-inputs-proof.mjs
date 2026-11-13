// Public validator and real filesystem consumers after a committed docs-only change.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pushSelection} from './push-selection.mjs';

const directory=resolvePath(process.argv[2]??'tmp/docs-inputs-proof');mkdirSync(directory,{recursive:true});
const root=mkdtempSync(join(directory,'run-'));
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Docs proof','-c','user.email=proof@example.test',...args],{cwd:root,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);mkdirSync(join(root,'kit/scripts'),{recursive:true});mkdirSync(join(root,'docs/tasks/asks'),{recursive:true});mkdirSync(join(root,'docs/plans'),{recursive:true});
 copyFileSync('kit/scripts/asks.mjs',join(root,'kit/scripts/asks.mjs'));
 writeFileSync(join(root,'docs/plans/actual.md'),'# Real plan');
 writeFileSync(join(root,'docs/tasks/asks/A1.md'),'# A1\n\n**Status:** folded into actual\n\n**Ask:** Original recorded request\n');
 git(['add','src','docs']);git(['commit','--quiet','-m','valid docs']);
 assert.equal(spawnSync(process.execPath,['kit/scripts/asks.mjs','check','--all'],{cwd:root}).status,0);
 unlinkSync(join(root,'docs/plans/actual.md'));git(['add','docs/plans/actual.md']);git(['commit','--quiet','-m','remove referenced plan']);
 const invalid=spawnSync(process.execPath,['kit/scripts/asks.mjs','check','--all'],{cwd:root,encoding:'utf8'});
 assert.notEqual(invalid.status,0,'An empty Git index must not hide a committed dead ask target');
 assert.match(invalid.stderr,/existing ask|plan/u);
 writeFileSync(join(root,'docs/HOST-BAR.md'),'lint/listed-view-code.json');
 writeFileSync(join(root,'src/read-doc.mjs'),"import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';assert.ok(readFileSync('docs/HOST-BAR.md','utf8').includes('lint/listed-view-code.json'));");
 git(['add','src/read-doc.mjs','docs/HOST-BAR.md']);git(['commit','--quiet','-m','document consumer']);
 execFileSync(process.execPath,['src/read-doc.mjs'],{cwd:root});const before=git(['rev-parse','HEAD']);
 writeFileSync(join(root,'docs/HOST-BAR.md'),'missing authority');git(['add','docs/HOST-BAR.md']);git(['commit','--quiet','-m','break documented contract']);
 assert.notEqual(spawnSync(process.execPath,['src/read-doc.mjs'],{cwd:root,stdio:'pipe'}).status,0);
 assert.equal(pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root).mode,'full','A Markdown filesystem input is code coverage, not skippable copy');
 console.log(JSON.stringify({committedAskChecked:true,emptyIndexCannotHideTarget:true,markdownConsumerRunsFull:true}));
}finally{rmSync(root,{recursive:true,force:true});}
