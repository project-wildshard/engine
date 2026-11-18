// Run the workflow's real classification command against Git and a local Actions API double.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=resolvePath(process.argv[2]??'tmp/ci-docs-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),workflow=readFileSync('.github/workflows/ci.yml','utf8');
const start=workflow.indexOf('        id: paths'),block=workflow.slice(start,workflow.indexOf('\n      - ',start));
const multiline=/ {8}run: \|\n([\s\S]*)/u.exec(block);
const command=multiline===null?/ {8}run: (.+)/u.exec(block)?.[1]:multiline[1].split('\n').map(line=>line.replace(/^ {10}/u,'')).join('\n');
assert.ok(command,'The workflow publishes docs through its paths step');
const scanStart=workflow.indexOf('      - name: Scan the complete incoming history');
const scanBlock=workflow.slice(scanStart,workflow.indexOf('\n      - ',scanStart+1));
const scanCommand=/ {8}run: \|\n([\s\S]*)/u.exec(scanBlock)?.[1]?.split('\n').map(line=>line.replace(/^ {10}/u,'')).join('\n');
assert.ok(scanCommand,'The workflow has a packed history scan');
/** @type {{id:number,head_sha:string,status:string,conclusion:string,event:string}[]} */
let runs=[];
let badApi=false;
const complete=['changes','static','plan','tests (1)','e2e'].map(name=>({name,status:'completed',conclusion:'success'}));
const packedStep={name:'Run this job\'s packed share',status:'completed',conclusion:'success'};
const scanned={name:'Scan the complete incoming history',status:'completed',conclusion:'success'};
const server=createServer((request,response)=>{
 response.setHeader('content-type','application/json');
 if(badApi){response.statusCode=503;response.end('{}');return;}
 const url=request.url??'';
 if(url.includes('/workflows/ci.yml/runs'))response.end(JSON.stringify({workflow_runs:runs}));
 else if(url.includes('/runs/1/jobs'))response.end(JSON.stringify({jobs:complete}));
 else if(url.includes('/runs/2/jobs'))response.end(JSON.stringify({jobs:complete.map(job=>({name:job.name,status:job.status,conclusion:['changes','static'].includes(job.name)?'success':'skipped'}))}));
 else if(url.includes('/runs/4/jobs')||url.includes('/runs/5/jobs'))response.end(JSON.stringify({jobs:[
  {name:'tests (1)',status:'completed',conclusion:'success',steps:[packedStep,{...scanned,conclusion:url.includes('/runs/4/jobs')?'success':'skipped'}]},
 ]}));
 else {response.statusCode=404;response.end('{}');}
});
/** @type {Promise<void>} */
const listening=new Promise(resolve=>{server.listen(0,'127.0.0.1',()=>resolve());});
await listening;
const address=server.address();assert.ok(address!==null&&typeof address!=='string');
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Selection proof','-c','user.email=proof@example.test',...args],{cwd:work,encoding:'utf8'}).trim();
/** @param {string} script @param {string} before @param {string} sha @param {string} [event] */
const runWorkflow=async(script,before,sha,event='push')=>{
 const output=join(work,'outputs');writeFileSync(output,'');
 const child=spawn('bash',['-c',script],{cwd:work,env:{...process.env,NODE_OPTIONS:`--import=${pathToFileURL(join(work,'test/cold-ci.mjs')).href}`,BASE_SHA:before,GITHUB_SHA:sha,GITHUB_RUN_ID:'99',GITHUB_EVENT_NAME:event,GITHUB_REF:'refs/heads/main',GITHUB_REF_NAME:'main',GITHUB_REPOSITORY:'proof/engine',GH_TOKEN:'fixture-capability',GITHUB_API_URL:`http://127.0.0.1:${address.port}`,GITHUB_OUTPUT:output},stdio:['ignore','pipe','pipe']});
 let text='';child.stdout.on('data',data=>{text+=data;});child.stderr.on('data',data=>{text+=data;});
 const code=await new Promise(resolve=>{child.once('exit',resolve);});assert.equal(code,0,text);
 return {text,outputs:readFileSync(output,'utf8')};
};
/** @param {string} before @param {string} sha */
const classify=async(before,sha)=>(await runWorkflow(command,before,sha)).outputs.includes('docs=true');
try{
 git(['init','--quiet','--initial-branch=main']);mkdirSync(join(work,'scripts'));mkdirSync(join(work,'src'));mkdirSync(join(work,'test'));mkdirSync(join(work,'docs'));
 for(const name of ['push-selection.mjs','ci-selection.mjs','ci-proof-jobs.mjs','release-gate.mjs','ci-exact-reuse.mjs','test-quarantine.mjs','renderer-revision.mjs','shardfile-validation-revision.mjs','source-input-proof.mjs','input-hash-memo.mjs'])if(existsSync(`scripts/${name}`))copyFileSync(`scripts/${name}`,join(work,'scripts',name));
 mkdirSync(join(work,'.githooks'));
 for(const name of ['check-push.mjs','lib.mjs'])copyFileSync(`.githooks/${name}`,join(work,'.githooks',name));
 // Refuse package resolution even if a developer's ancestor node_modules could
 // otherwise hide CI's pre-install environment. Native Node builtins stay real.
 writeFileSync(join(work,'test/cold-ci.mjs'),"import{isBuiltin,registerHooks}from'node:module';registerHooks({resolve(specifier,context,next){if(!isBuiltin(specifier)&&!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.startsWith('file:')&&!specifier.startsWith('internal/'))throw Error('Cold CI attempted installed package: '+specifier);return next(specifier,context);}});");
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
 const zero='0'.repeat(40),fullCount=git(['rev-list','--count',safe]);
 runs=[{id:5,head_sha:fixed,status:'completed',conclusion:'success',event:'push'},{id:4,head_sha:docs,status:'completed',conclusion:'success',event:'push'}];
 assert.match((await runWorkflow(scanCommand,zero,safe,'workflow_dispatch')).text,/2 outgoing commits?/u);
 runs.splice(1);
 assert.ok((await runWorkflow(scanCommand,zero,safe,'workflow_dispatch')).text.includes(`${fullCount} outgoing commit(s)`),'A green pack without a green history scan cannot narrow the scan');
 badApi=true;
 assert.ok((await runWorkflow(scanCommand,zero,safe,'workflow_dispatch')).text.includes(`${fullCount} outgoing commit(s)`),'A missing API proof scans all history');
 assert.ok((await runWorkflow(scanCommand,fixed,safe)).text.includes('1 outgoing commit(s)'),'A push retains its exact before SHA');
 console.log(JSON.stringify({coldPreinstallNoPackages:true,hostedWorkflowStillFull:true,redCodeRefused:true,cancelledCodeRefused:true,docsSuccessInsufficient:true,provedDocsAllowed:true,apiFailureRunsFull:true,dispatchHistoryProof:true,pushKeepsBefore:true}));
}finally{await new Promise(resolve=>{server.close(resolve);});rmSync(work,{recursive:true,force:true});}
