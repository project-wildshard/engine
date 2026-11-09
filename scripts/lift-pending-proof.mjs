// Outside-hook public Vitest discovery proof. It never executes a test body.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVitest} from 'vitest/node';

const now=Date.now;
const argv=process.argv;
try{
 process.argv=[argv[0],argv[1],'list'];
 const {readLiftPending}=await import('./lift-pending.mjs');
 const policy=readLiftPending();
 assert.equal(policy.owner,'codex-mock');
 assert.ok(Date.parse(policy.deadline)<=Date.parse('2026-11-10T18:00:00Z'));
 assert.equal(policy.excluded.length,policy.files.length,'Registration has not claimed these files executed');
 Date.now=()=>Date.parse('2026-11-11T18:00:00Z');
 const context=await createVitest({root:process.cwd(),run:true,watch:false},{logLevel:'silent'});
 try{
  const files=new Set((await context.getRelevantTestSpecifications()).map(spec=>spec.moduleId));
  /** @type {string[]} */const pending=JSON.parse(readFileSync('test/lift-pending.json','utf8'));
  const hidden=pending.filter(file=>!files.has(`${process.cwd()}/${file}`));
  console.log(JSON.stringify({afterDeadline:'2026-11-11T18:00:00Z',pending:pending.length,stillHidden:hidden.length}));
  assert.equal(hidden.length,0,'Every inherited pending file must return to blocking discovery after its deadline');
 }finally{await context.close();}
}finally{Date.now=now;process.argv=argv;}
