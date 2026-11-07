import {expect,test,vi} from 'vitest';
import {FakeGame} from '../../../test/engine/FakeGame';
import {FAULT_BURST,FAULT_STREAK,FAULT_WINDOW_MS,loopState,makeSystem,onFault,recordFault,setLoopState,systemFault,type Fault} from './faults';

test('a repeatedly failing non-core system still runs and reports one uncaught fault',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>undefined);
  const game=new FakeGame(),bad=vi.fn<()=>void>(()=>{throw new Error('bad entity frame');}),healthy=vi.fn<()=>void>(),reports:Fault[]=[];
  const stop=onFault(fault=>{reports.push(fault);});
  game.onUpdate(bad,'test.entity');game.onUpdate(healthy,'test.healthy');
  try{
    for(let frame=0;frame<12;frame++)game.advance(1/60);
    expect(bad).toHaveBeenCalledTimes(12);expect(healthy).toHaveBeenCalledTimes(12);
    expect(game.dead).toBe(false);expect(loopState()).toBe('running');
    expect(reports).toHaveLength(1);expect(reports[0]?.system).toBe('test.entity');expect(reports[0]?.verdict).toBe('uncaught');
  }finally{stop();game.playerScope.dispose();setLoopState('boot');}
});

test('only repeated core failures retain the fatal streak and burst policy',()=>{
  const core=makeSystem(()=>undefined,'test.core',true,'unused');
  for(let frame=0;frame<FAULT_STREAK-1;frame++)expect(recordFault(core,frame,frame*16)).toBe('retry');
  expect(recordFault(core,FAULT_STREAK-1,100)).toBe('fatal');expect(core.on).toBe(false);
  const burst=makeSystem(()=>undefined,'test.burst',true,'unused');
  for(let index=0;index<FAULT_BURST-1;index++)expect(recordFault(burst,index*2,index*100)).toBe('retry');
  expect(recordFault(burst,FAULT_BURST*2,FAULT_WINDOW_MS)).toBe('fatal');
  const ordinary=makeSystem(()=>undefined,'test.ordinary',false,'unused');
  for(let frame=0;frame<20;frame++)expect(recordFault(ordinary,frame,frame)).toBe('retry');
  expect(ordinary.on).toBe(true);
});

test('a core fault opens a recoverable report first and marks the loop dead before its fatal report',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>undefined);
  const core=makeSystem(()=>undefined,'test.core',true,'unused'),reports:{fault:Fault;loop:string}[]=[];
  setLoopState('running');const stop=onFault(fault=>{reports.push({fault,loop:loopState()});});
  try{
    for(let frame=0;frame<FAULT_STREAK;frame++)systemFault(core,new Error('core failure'),frame,frame*16);
    expect(reports.map(row=>[row.fault.verdict,row.loop])).toEqual([['uncaught','running'],['fatal','dead']]);
  }finally{stop();setLoopState('boot');}
});
