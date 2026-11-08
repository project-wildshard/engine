// Outside hook/test globs: real process success, refusal and descendant cleanup.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parallelChecks} from '../.githooks/push-checks.mjs';
import {pushSelection} from './push-selection.mjs';

const out=resolvePath(process.argv[2]??'tmp/prepush-proof');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-'));
  /** @param {string} name @param {string} source */
  const write=(name,source)=>{const path=join(work,name);writeFileSync(path,source);return path;};
try{
  const repository=join(work,'repo');mkdirSync(repository);
  /** @param {string[]} args */
  const git=args=>execFileSync('git',['-c','user.name=Push proof','-c','user.email=proof@example.test',...args],{cwd:repository,encoding:'utf8'}).trim();
  git(['init','--quiet']);writeFileSync(join(repository,'start.md'),'start');git(['add','start.md']);git(['commit','--quiet','-m','base']);
  let previous=git(['rev-parse','HEAD']);
  for(const [path,mode] of [['note.md','docs'],['source.ts','related'],['package.json','full']]){
    writeFileSync(join(repository,path),path==='package.json'?'{}':'export const value=1;');git(['add',path]);git(['commit','--quiet','-m',mode]);
    const current=git(['rev-parse','HEAD']);assert.equal(pushSelection(`refs/heads/main ${current} refs/heads/main ${previous}`,repository).mode,mode);previous=current;
  }
  assert.equal(pushSelection(undefined,repository).mode,'full');
  const green=write('green.mjs',"import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],'proved');");
  const pass=await parallelChecks([{name:'first',commands:[[process.execPath,green,join(work,'first')]]},{name:'second',commands:[[process.execPath,green,join(work,'second')]]}]);
  assert.equal(pass.ok,true);assert.equal(readFileSync(join(work,'first'),'utf8'),'proved');assert.equal(readFileSync(join(work,'second'),'utf8'),'proved');
  const pid=join(work,'child.pid');
  const hold=write('hold.mjs',`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pid)},String(child.pid));setInterval(()=>{},1000);`);
  const fail=write('fail.mjs',`import{existsSync}from'node:fs';while(!existsSync(${JSON.stringify(pid)}))await new Promise(r=>setTimeout(r,10));process.exitCode=1;`);
  const refused=await parallelChecks([{name:'owned child',commands:[[process.execPath,hold]]},{name:'real refusal',commands:[[process.execPath,fail]]}]);
  assert.equal(refused.ok,false);assert.ok(refused.seconds<2,`Cleanup took ${refused.seconds}s`);
  const child=Number(readFileSync(pid,'utf8'));let alive=true;
  for(let turn=0;turn<20&&alive;turn++){try{process.kill(child,0);await new Promise(resolve=>{setTimeout(resolve,20);});}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;alive=false;}}
  assert.equal(alive,false,'Refused task must not leave its detached child alive');
  console.log(JSON.stringify({selection:['docs','related','full'],green:pass.ok,refused:!refused.ok,cleanupSeconds:refused.seconds,orphan:false}));
}finally{rmSync(work,{recursive:true,force:true});}
