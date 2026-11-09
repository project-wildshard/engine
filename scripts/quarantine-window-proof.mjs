// Actual policy CLI and committed Git admission dates, outside hooks.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const directory=resolvePath(process.argv[2]??'tmp/quarantine-window-proof');mkdirSync(directory,{recursive:true});
const root=mkdtempSync(join(directory,'run-')),addedAt=new Date(Math.floor((Date.now()-3_600_000)/1000)*1000).toISOString();
const entry={file:'test/actual.test.ts',owner:'codex-mock',addedAt,deadline:new Date(Date.parse(addedAt)+47*3_600_000).toISOString(),reason:'Two recorded real fixture failures'};
const policy=()=>writeFileSync(join(root,'test/quarantine.json'),JSON.stringify({schema:1,entries:[entry]}));
/** @param {string[]} args */
const run=args=>spawnSync(process.execPath,['scripts/test-quarantine.mjs',...args],{cwd:root,encoding:'utf8'});
try{
 mkdirSync(join(root,'scripts'));mkdirSync(join(root,'test'));copyFileSync('scripts/test-quarantine.mjs',join(root,'scripts/test-quarantine.mjs'));policy();
 execFileSync('git',['init','--quiet','--initial-branch=main'],{cwd:root});execFileSync('git',['add','scripts','test'],{cwd:root});
 execFileSync('git',['-c','user.name=Window proof','-c','user.email=proof@example.test','commit','--quiet','-m','admit fixture'],{cwd:root,env:{...process.env,GIT_AUTHOR_DATE:addedAt,GIT_COMMITTER_DATE:addedAt}});
 assert.equal(run(['--list']).status,0);
 entry.deadline=new Date(Date.parse(addedAt)+49*3_600_000).toISOString();policy();
 assert.notEqual(run(['--list']).status,0,'A parseable deadline beyond 48 hours must refuse');
 entry.deadline=new Date(Date.parse(addedAt)+47*3_600_000).toISOString();entry.addedAt=new Date(Date.parse(addedAt)+600_000).toISOString();policy();
 const forged=run(['--check-history']);assert.notEqual(forged.status,0);assert.match(forged.stderr,/admission|introduced|commit/u);
 entry.addedAt=addedAt;policy();const valid=run(['--check-history']);assert.equal(valid.status,0,valid.stderr);
 const expired=spawnSync(process.execPath,['--input-type=module','-e',`import {activeQuarantineFiles} from './scripts/test-quarantine.mjs';console.log(JSON.stringify(activeQuarantineFiles(${Date.parse(entry.deadline)+1})));`],{cwd:root,encoding:'utf8'});
 assert.equal(expired.status,0);assert.deepEqual(JSON.parse(expired.stdout),[]);
 console.log(JSON.stringify({over48HoursRefused:true,forgedAdmissionRefused:true,realCommitDateAccepted:true,expiryRestoresBlocking:true}));
}finally{rmSync(root,{recursive:true,force:true});}
