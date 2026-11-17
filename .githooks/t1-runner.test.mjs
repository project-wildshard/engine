import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureScratch} from '../test/tooling/owned-scratch.mjs';
import {runT1Child} from '../scripts/t1-runner.mjs';

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
