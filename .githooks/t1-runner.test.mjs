import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureScratch} from '../src/test/.kit/owned-scratch.mjs';
import {runT1Child} from '../src/scripts/t1-runner.mjs';

test('an owned child ignoring TERM is killed and returns a failed receipt result',async()=>{
 const root=fixtureScratch('t1-runner'),script=join(root,'ignore.mjs'),pidFile=join(root,'pid');
 writeFileSync(script,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
 const result=await runT1Child([process.execPath,script],process.env,{timeoutMs:1000,graceMs:50});
 assert.notEqual(result.signal,null);assert.notEqual(result.status,0);
 const pid=Number(readFileSync(pidFile,'utf8'));
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
test('ordinary failed status is preserved for report-only or blocking policy to judge',async()=>{
 const result=await runT1Child([process.execPath,'-e','process.exit(7)'],process.env);
 assert.equal(result.status,7);assert.equal(result.signal,null);
});

test('an exited leader cannot hide a surviving TERM-resistant descendant',async()=>{
 const root=fixtureScratch('t1-descendant'),script=join(root,'leader.mjs'),pidFile=join(root,'pid');
 writeFileSync(script,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"],{stdio:['ignore','ignore','ignore','ipc']});
 child.once('message',()=>{writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.disconnect();child.unref();process.exit(0);});`);
 let pid;
 try{
  const result=await runT1Child([process.execPath,script],process.env);
  pid=Number(readFileSync(pidFile,'utf8'));
  const state=spawnSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).stdout.trim();
  assert.equal(result.status,0);assert.ok(state===''||state.startsWith('Z'),`owned descendant remains alive: ${state}`);
 }finally{if(pid!==undefined)try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
});
