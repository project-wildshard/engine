// Outside-hook public Vitest discovery proof. It never executes a test body.
import assert from 'node:assert/strict';
import {createVitest} from 'vitest/node';

const now=Date.now;
const argv=process.argv;
try{
 process.argv=[argv[0]??process.execPath,argv[1]??'scripts/lift-pending-proof.mjs','list'];
 const {readLiftPending}=await import('./lift-pending.mjs');
 const policy=readLiftPending();
 assert.equal(policy.owner,'codex-mock');
 assert.ok(Date.parse(policy.originalDeadline)<=Date.parse('2026-11-10T18:00:00Z'));
 assert.equal(policy.batches.length,48);
 assert.equal(policy.batches.flatMap(batch=>batch.files).length,policy.files.length);
 assert.equal(policy.excluded.length,policy.files.length,'Registration has not claimed these files executed');
 Date.now=()=>Date.parse('2026-11-13T18:00:00Z');
 const context=await createVitest({root:process.cwd(),run:true,watch:false},{logLevel:'silent'});
 try{
  const files=new Set((await context.getRelevantTestSpecifications()).map(spec=>spec.moduleId));
  const pending=policy.files;
  const hidden=pending.filter(file=>!files.has(`${process.cwd()}/${file}`));
  console.log(JSON.stringify({afterDeadline:'2026-11-13T18:00:00Z',pending:pending.length,stillHidden:hidden.length}));
  assert.equal(hidden.length,pending.length,'J237 preserves each exclusion until its own dated batch expires');
 }finally{await context.close();}
 Date.now=()=>Date.parse('2026-11-14T18:00:00Z');
 await assert.rejects(()=>createVitest({root:process.cwd(),run:true,watch:false},{logLevel:'silent'}),/CI21 batch deadline missed/u,'Actual Vitest startup must fail on the first missed batch');
}finally{Date.now=now;process.argv=argv;}
