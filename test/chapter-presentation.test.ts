import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import type {HeadlessCommand,HeadlessEffect} from '../src/shared/host/tickProtocol';
import {createNalatiChapterPresentation,nalatiChapterPresentationOf} from './fixtures/nalati-chapter-presentation';

function fixture(){
  const scope=new Scope('chapter-panel'),steps=new Map<string,(dt:number)=>void>(),clock={now:0},effects:HeadlessEffect[]=[];
  let commands:HeadlessCommand[]=[];
  const host={scope,clock,hasStep:(id:string)=>steps.has(id),onStep:(id:string,run:(dt:number)=>void)=>{steps.set(id,run);return ()=>{steps.delete(id);};}};
  const panel=createNalatiChapterPresentation(host,{commands:()=>commands,emit:effect=>{effects.push(effect);}},()=>1);
  const step=(value:number,dt=1/60):void=>{commands=[{kind:'script',actorId:'nalati.chapter.reading',value}];clock.now+=dt;for(const run of steps.values())run(dt);};
  return {host,panel,effects,step,close:()=>{scope.dispose();}};
}
test('the native panel retains the real dialogue clock, original keyboard gate and ungated tap',()=>{
  const f=fixture();try{
    expect(f.panel.snapshot()).toBeUndefined();
    f.panel.ports.reading({kind:'reading',title:'Stone',lines:['abcd','ef']});
    f.panel.ports.reading({kind:'reading',title:'ignored',lines:['cannot replace an open panel']});
    f.step(1,.1);expect(f.panel.snapshot()?.clock.index).toBe(0);
    f.step(1,.06);expect(f.panel.snapshot()?.clock.index).toBe(1);
    f.step(2);expect(nalatiChapterPresentationOf(f.host)?.reading()).toBe(false);
    expect(f.panel.snapshot()?.rows).toEqual([{kind:'reading',title:'Stone',lines:['abcd','ef'],opened:true},
      {kind:'reading',title:'ignored',lines:['cannot replace an open panel'],opened:false}]);
  }finally{f.close();}
});
test('quiet restore retains every offered row and full clock without re-emitting or sharing saved arrays',()=>{
  const a=fixture(),b=fixture();try{
    a.panel.ports.toast('actual carving');a.panel.ports.reading({kind:'reading',title:'Stone',lines:['one','two']});
    const saved=a.panel.snapshot();expect(saved).toBeDefined();if(saved===undefined)throw new Error('Missing entered panel');
    b.panel.restore(saved);expect(b.panel.snapshot()).toEqual(a.panel.snapshot());expect(b.effects).toEqual([]);
    saved.clock.lines[0]='foreign';expect(a.panel.snapshot()?.clock.lines[0]).toBe('one');expect(b.panel.snapshot()?.clock.lines[0]).toBe('one');
    for(const value of [2,2,2,2]){a.step(value);b.step(value);expect(b.panel.snapshot()).toEqual(a.panel.snapshot());}
    const before=b.panel.snapshot();expect(()=>b.panel.restore({...before,openedAt:1000})).toThrow('clock');expect(b.panel.snapshot()).toEqual(before);
    expect(()=>b.panel.restore({...before,clock:{version:2}})).toThrow();expect(b.panel.snapshot()).toEqual(before);
  }finally{a.close();b.close();}
});
test('missing entered state, invalid input, competing installation and retired loans refuse',()=>{
  const f=fixture();f.panel.ports.toast('real');const owner=nalatiChapterPresentationOf(f.host);expect(owner).toBeDefined();
  expect(()=>f.panel.restore(undefined)).toThrow('Missing');expect(()=>f.step(99)).toThrow('Unknown');
  expect(()=>createNalatiChapterPresentation(f.host,{commands:()=>[],emit:()=>undefined},()=>0)).toThrow('already');
  f.close();expect(()=>owner?.reading()).toThrow('retired');expect(()=>f.panel.ports.toast('late')).toThrow('retired');
});
