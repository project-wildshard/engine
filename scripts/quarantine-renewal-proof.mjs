// Real policy CLI, rename history and one immutable J200 decision; outside hooks.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const mode=process.argv[2]??'readd',base=resolvePath(process.argv[3]??'tmp/quarantine-renewal-proof');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-')),addedAt=new Date(Math.floor((Date.now()-3_600_000)/1000)*1000).toISOString();
const entry={file:'test/first.test.ts',owner:'codex-mock',addedAt,deadline:new Date(Date.parse(addedAt)+47*3_600_000).toISOString(),reason:'Two recorded fixture failures'};
/** @param {string[]} args */const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
/** @param {string} at */const commit=at=>{git(['add','test']);execFileSync('git',['-c','user.name=Policy proof','-c','user.email=proof@example.test','commit','--quiet','-m','policy change'],{cwd:root,env:{...process.env,GIT_AUTHOR_DATE:at,GIT_COMMITTER_DATE:at}});};
/** @param {unknown[]} entries */const policy=entries=>writeFileSync(join(root,'test/quarantine.json'),JSON.stringify({schema:1,entries}));
const check=()=>spawnSync(process.execPath,['scripts/test-quarantine.mjs','--check-history'],{cwd:root,encoding:'utf8'});
try{
 mkdirSync(join(root,'scripts'));mkdirSync(join(root,'test'));copyFileSync('scripts/test-quarantine.mjs',join(root,'scripts/test-quarantine.mjs'));
 git(['init','--quiet','--initial-branch=main']);writeFileSync(join(root,entry.file),'unchanged actual test content');policy([entry]);commit(addedAt);
 assert.equal(check().status,0);
 const later=new Date(Date.parse(addedAt)+600_000).toISOString();
 if(mode==='readd'){
  policy([]);commit(new Date(Date.parse(addedAt)+300_000).toISOString());entry.addedAt=later;entry.deadline=new Date(Date.parse(later)+47*3_600_000).toISOString();policy([entry]);commit(later);
  assert.notEqual(check().status,0,'Removal and re-admission must not reset the first clock');
 }else if(mode==='rename'){
  git(['mv',entry.file,'test/renamed.test.ts']);entry.file='test/renamed.test.ts';entry.addedAt=later;entry.deadline=new Date(Date.parse(later)+47*3_600_000).toISOString();policy([entry]);commit(later);
  assert.notEqual(check().status,0,'An actual Git rename must not renew the clock');
 }else{
  const extension={reason:'J200 once-only reasoned extension',grantedAt:later,decidedBy:'codex-pinefix2',deadline:new Date(Date.parse(entry.deadline)+48*3_600_000).toISOString()};
  policy([{...entry,extension}]);commit(later);assert.equal(check().status,0,check().stderr);
  const active=spawnSync(process.execPath,['--input-type=module','-e',`import{activeQuarantineFiles}from'./scripts/test-quarantine.mjs';console.log(JSON.stringify(activeQuarantineFiles(${Date.parse(entry.deadline)+1})));`],{cwd:root,encoding:'utf8'});
  assert.equal(active.status,0,active.stderr);assert.deepEqual(JSON.parse(active.stdout),[entry.file],'One recorded extension must be effective');
  policy([{...entry,extension:{...extension,reason:'A disguised second decision',grantedAt:new Date(Date.parse(later)+60_000).toISOString()}}]);commit(new Date(Date.parse(later)+60_000).toISOString());
  assert.notEqual(check().status,0,'The first extension decision cannot be rewritten');
 }
 console.log(JSON.stringify({mode,firstAdmissionPreserved:true,oneRecordedExtension:mode==='extension'}));
}finally{rmSync(root,{recursive:true,force:true});}
