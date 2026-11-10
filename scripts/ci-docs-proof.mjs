// Run the workflow's real classification command against Git and a local Actions API double.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const directory=resolvePath(process.argv[2]??'tmp/ci-docs-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),workflow=readFileSync('.github/workflows/ci.yml','utf8');
const block=workflow.slice(workflow.indexOf('        id: paths'),workflow.indexOf('\n  static:'));
const multiline=/ {8}run: \|\n([\s\S]*)/u.exec(block);
const command=multiline===null?/ {8}run: (.+)/u.exec(block)?.[1]:multiline[1].split('\n').map(line=>line.replace(/^ {10}/u,'')).join('\n');
assert.ok(command,'The workflow publishes docs through its paths step');
/** @type {{id:number,head_sha:string,status:string,conclusion:string,event:string}[]} */
let runs=[];
let badApi=false;
const complete=['changes','static','plan','tests (1)','e2e'].map(name=>({name,status:'completed',conclusion:'success'}));
const server=createServer((request,response)=>{
 response.setHeader('content-type','application/json');
 if(badApi){response.statusCode=503;response.end('{}');return;}
 const url=request.url??'';
 if(url.includes('/workflows/ci.yml/runs'))response.end(JSON.stringify({workflow_runs:runs}));
 else if(url.includes('/runs/1/jobs'))response.end(JSON.stringify({jobs:complete}));
 else if(url.includes('/runs/2/jobs'))response.end(JSON.stringify({jobs:complete.map(job=>({name:job.name,status:job.status,conclusion:['changes','static'].includes(job.name)?'success':'skipped'}))}));
 else {response.statusCode=404;response.end('{}');}
});
/** @type {Promise<void>} */
const listening=new Promise(resolve=>{server.listen(0,'127.0.0.1',()=>resolve());});
await listening;
const address=server.address();assert.ok(address!==null&&typeof address!=='string');
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Selection proof','-c','user.email=proof@example.test',...args],{cwd:work,encoding:'utf8'}).trim();
/** @param {string} before @param {string} sha */
const classify=async(before,sha)=>{
 const output=join(work,'outputs');writeFileSync(output,'');
 const child=spawn('bash',['-c',command],{cwd:work,env:{...process.env,BASE_SHA:before,GITHUB_SHA:sha,GITHUB_RUN_ID:'99',GITHUB_EVENT_NAME:'push',GITHUB_REF_NAME:'main',GITHUB_REPOSITORY:'proof/engine',GH_TOKEN:'fixture-capability',GITHUB_API_URL:`http://127.0.0.1:${address.port}`,GITHUB_OUTPUT:output},stdio:['ignore','pipe','pipe']});
 let text='';child.stdout.on('data',data=>{text+=data;});child.stderr.on('data',data=>{text+=data;});
 const code=await new Promise(resolve=>{child.once('exit',resolve);});assert.equal(code,0,text);
 return readFileSync(output,'utf8').includes('docs=true');
};
try{
 git(['init','--quiet','--initial-branch=main']);mkdirSync(join(work,'scripts'));mkdirSync(join(work,'src'));mkdirSync(join(work,'test'));mkdirSync(join(work,'docs'));
 for(const name of ['push-selection.mjs','ci-selection.mjs','lift-pending.mjs','renderer-revision.mjs','shardfile-validation-revision.mjs','source-input-proof.mjs','input-hash-memo.mjs'])if(existsSync(`scripts/${name}`))copyFileSync(`scripts/${name}`,join(work,'scripts',name));
 symlinkSync(resolvePath('node_modules'),join(work,'node_modules'),'dir');
 writeFileSync(join(work,'src/value.ts'),'export const value=1;');writeFileSync(join(work,'test/value.mjs'),"import assert from 'node:assert/strict';import {value} from '../src/value.ts';assert.equal(value,1);");
 writeFileSync(join(work,'docs/note.md'),'base');git(['add','scripts','src','test','docs']);git(['commit','--quiet','-m','proved code']);const proved=git(['rev-parse','HEAD']);
 execFileSync(process.execPath,['test/value.mjs'],{cwd:work,stdio:'pipe'});
 writeFileSync(join(work,'src/value.ts'),'export const value=2;');git(['add','src/value.ts']);git(['commit','--quiet','-m','broken code']);const broken=git(['rev-parse','HEAD']);
 assert.throws(()=>execFileSync(process.execPath,['test/value.mjs'],{cwd:work,stdio:'pipe'}));
 writeFileSync(join(work,'docs/note.md'),'docs after broken code');git(['add','docs/note.md']);git(['commit','--quiet','-m','docs']);const docs=git(['rev-parse','HEAD']);
 runs=[{id:1,head_sha:proved,status:'completed',conclusion:'success',event:'push'},{id:3,head_sha:broken,status:'completed',conclusion:'failure',event:'push'}];
 assert.equal(await classify(broken,docs),false,'A docs push must not certify red code');
 const cancelled=runs[1];assert.ok(cancelled);cancelled.conclusion='cancelled';assert.equal(await classify(broken,docs),false,'A cancelled code run proves nothing');
 runs=[{id:2,head_sha:broken,status:'completed',conclusion:'success',event:'push'},runs[0]];
 assert.equal(await classify(broken,docs),false,'A docs-only success does not prove code');
 writeFileSync(join(work,'src/value.ts'),'export const value=1;');git(['add','src/value.ts']);git(['commit','--quiet','-m','fixed code']);const fixed=git(['rev-parse','HEAD']);execFileSync(process.execPath,['test/value.mjs'],{cwd:work,stdio:'pipe'});
 writeFileSync(join(work,'docs/note.md'),'docs after proved fix');git(['add','docs/note.md']);git(['commit','--quiet','-m','safe docs']);const safe=git(['rev-parse','HEAD']);
 runs=[{id:1,head_sha:fixed,status:'completed',conclusion:'success',event:'push'}];
 assert.equal(await classify(fixed,safe),true,'A real code-proving predecessor permits the optimization');
 mkdirSync(join(work,'.github/workflows'),{recursive:true});writeFileSync(join(work,'.github/workflows/proof.yml'),'name: actual workflow input\non: push\n');git(['add','.github/workflows/proof.yml']);git(['commit','--quiet','-m','change hosted workflow']);const workflowHead=git(['rev-parse','HEAD']);
 assert.equal(await classify(safe,workflowHead),false,'The local workflow exemption must never skip hosted code-proving CI');
 badApi=true;assert.equal(await classify(fixed,safe),false,'An unavailable proof runs full');badApi=false;
 // The real saved Git policy expired since the API's green run. Its restored
 // file genuinely fails now, even though the next commit changes only docs.
 const admitted=new Date((Math.floor(Date.now()/1000)-7200)*1000),deadline=new Date(admitted.getTime()+3600000).toISOString();
 const pending=`${JSON.stringify(['test/expired.test.mjs'],null,2)}\n`;
 writeFileSync(join(work,'test/expired.test.mjs'),"import assert from 'node:assert/strict';assert.fail('newly required inherited test');");
 writeFileSync(join(work,'test/lift-pending.json'),pending);
 writeFileSync(join(work,'test/lift-pending-policy.json'),JSON.stringify({schema:1,owner:'codex-proof',registeredAt:admitted.toISOString(),deadline,inventorySha256:createHash('sha256').update(pending).digest('hex'),reason:'Actual inherited migration fixture restores its required test after the fixed original deadline.'}));
 git(['add','test/expired.test.mjs','test/lift-pending.json','test/lift-pending-policy.json']);
 execFileSync('git',['-c','user.name=Selection proof','-c','user.email=proof@example.test','commit','--quiet','-m','policy before its deadline'],{cwd:work,env:{...process.env,GIT_COMMITTER_DATE:admitted.toISOString()}});
 const beforeExpiry=git(['rev-parse','HEAD']);
 const expired=JSON.parse(execFileSync(process.execPath,['scripts/lift-pending.mjs'],{cwd:work,encoding:'utf8'}));
 assert.equal(expired.excluded,0);assert.equal(expired.files.length,1);
 assert.throws(()=>execFileSync(process.execPath,['test/expired.test.mjs'],{cwd:work,stdio:'pipe'}));
 runs=[{id:1,head_sha:beforeExpiry,status:'completed',conclusion:'success',event:'push'}];
 writeFileSync(join(work,'docs/note.md'),'docs after inherited exclusion expires');git(['add','docs/note.md']);git(['commit','--quiet','-m','docs after expiry']);const afterExpiry=git(['rev-parse','HEAD']);
 assert.equal(await classify(beforeExpiry,afterExpiry),false,'An old green code run cannot hide newly required failing tests after expiry');
 console.log(JSON.stringify({redCodeRefused:true,cancelledCodeRefused:true,docsSuccessInsufficient:true,provedDocsAllowed:true,apiFailureRunsFull:true,expiredInheritedTestsRunFull:true}));
}finally{await new Promise(resolve=>{server.close(resolve);});rmSync(work,{recursive:true,force:true});}
