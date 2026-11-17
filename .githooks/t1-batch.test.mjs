import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixtureScratch} from '../test/tooling/owned-scratch.mjs';

function fixture(body){
 const root=fixtureScratch('t1-batch'),log=join(root,'events'),child=join(root,'child.mjs'),driver=join(root,'driver.mjs');
 writeFileSync(log,'');
 writeFileSync(child,`import {appendFileSync,readFileSync} from 'node:fs';
 const log=${JSON.stringify(log)},suite=process.env.WS_T1_SHARD;
 appendFileSync(log,suite+' start\\n');
 ${body}`);
 writeFileSync(driver,`import {runT1Batch} from ${JSON.stringify(pathToFileURL(resolve('scripts/t1-batch.mjs')).href)};
 process.exitCode=await runT1Batch([process.execPath,${JSON.stringify(child)}]);`);
 return {run:()=>spawnSync(process.execPath,[driver],{encoding:'utf8',timeout:10_000}),events:()=>readFileSync(log,'utf8')};
}
test('every suite runs and its ordinary nonzero result survives aggregation',()=>{
 const f=fixture("setTimeout(()=>process.exit(suite==='B'?7:0),50);");
 const result=f.run();
 assert.equal(result.status,1,result.stderr);
 for(const suite of ['A','B','C','D'])assert.match(f.events(),new RegExp(`${suite} start`));
});
test('an interrupted batch refuses success even when every child drains with exit zero',()=>{
 const f=fixture(`process.on('SIGTERM',()=>{appendFileSync(log,suite+' drained\\n');process.exit(0);});
 if(suite==='A'){
  const timer=setInterval(()=>{if(readFileSync(log,'utf8').split(' start').length===5){clearInterval(timer);process.kill(process.ppid,'SIGTERM');}},20);
 }
 setTimeout(()=>process.exit(9),5000);`);
 const result=f.run();
 assert.equal(result.status,1,result.stderr);
 for(const suite of ['A','B','C','D'])assert.match(f.events(),new RegExp(`${suite} drained`));
});
