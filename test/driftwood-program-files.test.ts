import {DRIFTWOOD_GUEST_ROWS,driftwoodGuestFile,RETURN_PROGRAM} from './fixtures/driftwood-guest-programs';
import * as v from 'valibot';
import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {admitScriptContract} from '@wildshard/format/scriptContract';
import {SCRIPT_V2_REVISIONS} from '@wildshard/format/scriptAdmissionV2';
import {driftwoodReturnBytes,lendDriftwoodReturns} from './fixtures/driftwood-return-modules';

const compiled=v.strictObject({source:v.string(),bytes:v.pipe(v.number(),v.safeInteger(),v.minValue(1)),hash:v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u))});
test('both raw files preserve the complete original contracts and admitted executable bytes',()=>{
  const returns=v.parse(v.strictObject({script:v.unknown(),bytes:v.literal(''),compiled}),DRIFTWOOD_GUEST_ROWS.returns);
  const bridge=v.parse(v.strictObject({lane:v.literal('view'),pages:v.literal(1),ioBytes:v.literal(4096),bytes:v.literal(''),compiled}),DRIFTWOOD_GUEST_ROWS.bridge);
  const view=driftwoodGuestFile(bridge.compiled.source);
  expect(driftwoodReturnBytes.byteLength).toBe(returns.compiled.bytes);expect(hashImmutableBytes(driftwoodReturnBytes)).toBe(returns.compiled.hash);
  expect(view.byteLength).toBe(bridge.compiled.bytes);expect(hashImmutableBytes(view)).toBe(bridge.compiled.hash);
  expect(()=>admitScriptContract(driftwoodReturnBytes,{abi:1,pages:1})).not.toThrow();
  expect(()=>admitScriptContract(view,{abi:2,lane:'view',pages:1,ioBytes:4096,compilerRevision:SCRIPT_V2_REVISIONS.compiler,admissionRevision:SCRIPT_V2_REVISIONS.admission})).not.toThrow();
});

test('the original scoped return owner reuses its raw executable and refuses missing or retired loans',()=>{
  const owner=new Scope('raw returns');
  try{
    expect(()=>ReturnProgram.page(RETURN_PROGRAM,owner)).toThrow('Missing admitted raw return module loan');
    lendDriftwoodReturns(owner);
    const program=ReturnProgram.page(RETURN_PROGRAM,owner);
    expect(ReturnProgram.page(structuredClone(RETURN_PROGRAM),owner)).toBe(program);
    expect(program.project('schedule',{now:7,minimum:2,maximum:6,draw:.5})).toEqual({due:11});
    owner.dispose();expect(()=>program.project('schedule',{now:7,minimum:2,maximum:6,draw:.5})).toThrow('disposed');
  }finally{owner.dispose();}
});
