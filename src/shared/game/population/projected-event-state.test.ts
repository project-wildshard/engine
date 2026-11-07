import { expect,test } from 'vitest';
import { ProjectedState,type NumericProjection } from './returnProgram';
import { onFault,type Fault } from '@wildshard/engine/core/faults';
import { Rng } from '@wildshard/engine/core/rng';

const rows={initial:{value:0,step:0,tell:-0},retain:{value:'value'},signals:{step:'advance',tell:'draw',other:'other'},retainEvents:{step:{mask:'step'},tell:{mask:'tell'}}};
const declared={script:{signals:{a:'advance',b:'draw',c:'other'},channels:{a:'value',b:'mask'}}};

test('event snapshots commit only at their declared slot and reset without losing signed zero',()=>{
  let accepted=0;const calls:string[]=[];
  const program:NumericProjection={project:()=>{throw new Error('prepared only');},prepare:(signal,frame)=>{
    calls.push(signal);return {values:{value:frame['next']??1,mask:frame['mask']??-0},accept:()=>{accepted++;}};
  }};
  ProjectedState.preflight(rows,declared);const state=new ProjectedState(rows,program);
  state.event('step',{next:2,mask:7});expect(state.state).toStrictEqual({value:2,step:7,tell:-0});
  state.event('other',{next:3,mask:9});expect(state.state).toStrictEqual({value:3,step:7,tell:-0});
  state.event('tell',{next:4,mask:-0});expect(Object.is(state.value('tell'),-0)).toBe(true);
  expect(state.value('step')).toBe(7);expect(accepted).toBe(3);expect(calls).toStrictEqual(['advance','other','draw']);
  state.reset();expect(state.state).toStrictEqual(rows.initial);
});

test('invalid events, channels, slots and conflicting retention refuse before allocating a program',()=>{
  for(const row of [
    {...rows,retainEvents:{missing:{mask:'step'}}},
    {...rows,retainEvents:{step:{missing:'step'}}},
    {...rows,retainEvents:{step:{mask:'absent'}}},
    {...rows,retainEvents:{step:{mask:'value'}}},
    {...rows,retainEvents:{step:{value:'step'}}},
    {...rows,signals:{...rows.signals,other:'unknown'}},
    {...rows,outputs:['unknown']},
    {...rows,outputsEvents:{missing:['value']}},
    {...rows,outputsEvents:{step:['unknown']}},
  ])expect(()=>ProjectedState.preflight(row,declared)).toThrow();
  expect(()=>ProjectedState.preflight({...rows,initial:{...rows.initial,value:Number.NaN}},declared)).toThrow('Invalid projection state');
});

test('missing event outputs and a corrupt retained bank refuse before RNG/state acceptance',()=>{
  let accepted=0,output:Readonly<Record<string,number>>={value:2};
  const state=new ProjectedState(rows,{project:()=>output,prepare:()=>({values:output,accept:()=>{accepted++;}})});
  const before={...state.state};expect(()=>state.event('step')).toThrow('Missing required');
  expect(state.state).toStrictEqual(before);expect(accepted).toBe(0);
  output={value:2,mask:4};state.state.tell=Number.NaN;expect(()=>state.event('step')).toThrow('Invalid projection state');
  expect(state.state.step).toBe(0);expect(state.state.value).toBe(0);expect(accepted).toBe(0);
  state.reset();state.event('step');expect(accepted).toBe(1);expect(state.state).toStrictEqual({value:2,step:4,tell:-0});
});


test('event output banks validate before acceptance without requiring another event bank',()=>{
  let accepted=0,output:Readonly<Record<string,number>>={value:2,mask:-0};
  const row={initial:{value:0},signals:{member:'advance',damage:'draw'},outputsEvents:{member:['value','mask'],damage:['mask']}};
  ProjectedState.preflight(row,declared);
  const state=new ProjectedState(row,{project:()=>output,prepare:()=>({values:output,accept:()=>{accepted++;}})});
  state.event('member');expect(state.value('value')).toBe(2);expect(accepted).toBe(1);
  output={mask:.5};state.event('damage');expect(state.value('value')).toBe(2);expect(accepted).toBe(2);
  for(const bad of [{value:3},{value:3,mask:Number.NaN},{value:3,mask:Number.POSITIVE_INFINITY}]){
    output=bad;expect(()=>state.event('member')).toThrow('Missing required projection output');
    expect(state.value('value')).toBe(2);expect(accepted).toBe(2);
  }
  output={value:-0,mask:-0};const result=state.event('member');
  expect(Object.is(state.value('value'),-0)).toBe(true);expect(Object.is(result['mask'],-0)).toBe(true);
  expect(accepted).toBe(3);state.reset();expect(state.value('value')).toBe(0);
});

test('nonfinite or negative frame time skips without poisoning the pending sample',()=>{
  const faults:Fault[]=[],off=onFault(fault=>{faults.push(fault);});
  let calls=0,observed=0;
  const state=new ProjectedState(rows,{project:(_signal,frame)=>{calls++;observed=frame['dt']??0;return {value:2,mask:4};}});
  try{
    expect(state.step(.04,{})).toEqual({dt:0,values:{}});
    for(const dt of [Number.NaN,Infinity,-Infinity,-1])expect(state.step(dt,{})).toEqual({dt:0,values:{}});
    expect(state.state).toStrictEqual(rows.initial);expect(calls).toBe(0);expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({system:'projection.step',verdict:'retry',error:{message:'Invalid projection frame delta'}});
    expect(state.step(.06,{})).toEqual({dt:.1,values:{value:2,mask:4}});
    expect(calls).toBe(1);expect(observed).toBe(.1);expect(state.state).toStrictEqual({value:2,step:4,tell:-0});
  }finally{off();}
});

test('a rejected frame restores borrowed RNG and state while another owner and later frames run',()=>{
  const faults:Fault[]=[],off=onFault(fault=>{faults.push(fault);}),random=new Rng(517),before=random.snapshot();
  let bad=true,calls=0;
  const state=new ProjectedState(rows,{project:(_signal,_frame,stream)=>{calls++;stream?.next();return bad?{value:2}:{value:2,mask:4};}});
  const healthy=new ProjectedState(rows,{project:()=>({value:8,mask:9})});
  try{
    state.step(.04,{},random);expect(state.step(.06,{},random)).toEqual({dt:0,values:{}});
    expect(state.state).toStrictEqual(rows.initial);expect(random.snapshot()).toStrictEqual(before);
    expect(state.step(0,{},random)).toEqual({dt:0,values:{}});expect(calls).toBe(2);expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({verdict:'retry',error:{message:'Missing required projection output'}});
    expect(healthy.step(.1,{})).toEqual({dt:.1,values:{value:8,mask:9}});
    bad=false;expect(state.step(0,{},random)).toEqual({dt:.1,values:{value:2,mask:4}});
    const expected=new Rng(517);expected.next();expect(random.snapshot()).toStrictEqual(expected.snapshot());
    expect(state.state).toStrictEqual({value:2,step:4,tell:-0});expect(faults).toHaveLength(1);
  }finally{off();}
});
