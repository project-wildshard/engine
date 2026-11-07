import {admissionPage} from './fixtures/nalati-admission-loan';
import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {NativeEliteProjection,type NativeEliteFrame} from '../src/server/engine/ai/eliteRoster';

const rows={bondedState:'bonded',signal:'argymaqTick',states:{flaunt:1,rush:2,yield:3}};
const frame:NativeEliteFrame={state:'flaunt',phase2:false,engaged:true,bonded:false,same:true,health:1,at:[1,2,3],player:[4,5,6]};
test('orchard herd encounter rows preserve cadence, native commands and the historical continuation',()=>{
  const scope=new Scope('orchard.herd-elite'),program=admissionPage(scope);
  const law=new NativeEliteProjection(rows,program,scope),restored=new NativeEliteProjection(rows,program,scope);
  try{
    expect(law.advance(.05,frame)).toEqual({signature:false,lead:false,adopt:false});restored.restore(law.snapshot());
    const effect=law.advance(.05,frame);expect(effect).toEqual({signature:true,lead:false,adopt:false});expect(restored.advance(.05,frame)).toEqual(effect);
    expect(law.snapshot().laneT).toBeCloseTo(1.1);expect(law.snapshot()).toMatchObject({runT:0,lastState:'flaunt',elapsed:0,laneFrom:[1,2,3],laneTo:[4,5,6]});
    expect(law.advance(.1,{...frame,state:'rush',phase2:true})).toEqual({signature:false,lead:true,adopt:false});
    const saved=law.snapshot();restored.restore(saved);
    const bonded={...frame,state:'yield',phase2:true,bonded:true,same:false};
    expect(restored.advance(.1,bonded)).toEqual(law.advance(.1,bonded));expect(law.snapshot()).toEqual(restored.snapshot());
    expect(law.advance(.1,bonded).adopt).toBe(true);
    expect(()=>law.restore({...saved,laneFrom:[1,2]})).toThrow();
    const {elapsed,...legacy}=saved;expect(elapsed).toBe(0);restored.restore(legacy);expect(restored.snapshot().elapsed).toBe(0);
    expect(()=>new NativeEliteProjection({...rows,tick:()=>undefined},program,scope)).toThrow();
  }finally{scope.dispose();}
});


test('native projection refuses accessor rows before invoking their values', () => {
  const scope = new Scope('quarry.projection'), program = admissionPage(scope); let reads = 0;
  try {
    expect(() => new NativeEliteProjection({ ...rows, get signal() { reads++; return rows.signal; } }, program, scope)).toThrow('plain JSON');
    expect(reads).toBe(0);
  } finally { scope.dispose(); }
});
