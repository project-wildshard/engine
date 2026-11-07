import {expect,test} from 'vitest';
import {ClientChannels} from '@wildshard/sharddev/clientChannels';
import {parseClientChannels,type ClientChannelProgram} from '@wildshard/format/clientChannels';
import {installChannelPrograms} from '@wildshard/engine/game/plugin/channelPrograms';
import {onFault,type Fault} from '../src/shared/engine/core/faults';

function row(id:string,input:string,target:string,bound?:string):ClientChannelProgram{
 const dag=new ClientChannels(id);dag.output('value',dag.read(input));
 const result=parseClientChannels([{...dag.build(),numeric:{group:'gather',outputs:[{property:'value',target:'root',path:[target],restore:true}],inputs:bound===undefined?[]:[{input,owner:'root',path:[bound]}]}}])[0];
 if(result===undefined)throw new Error('Missing test row');return result;
}

test('aliases preserve first-read order, distinct bindings and signed zero on every frame',()=>{
 let a=0,b=2;const reads:string[]=[];
 const root={get a(){reads.push('a');return a;},get b(){reads.push('b');return b;},x:9,y:9,z:9};
 const host=installChannelPrograms([row('first','same','x','b'),row('second','same','y','a'),row('third','alias','z','b')],'gather',new Map([['root',root]]));
 reads.length=0;host.evaluate({time:0,delta:.1,values:{}});
 expect(reads).toEqual(['b','a']);expect([root.x,root.y,root.z]).toEqual([2,0,2]);
 host.evaluate({time:0,delta:.1,values:{}});expect(reads).toEqual(['b','a','b','a']);
 a=-0;b=3;host.evaluate({time:0,delta:.1,values:{}});
 expect([root.x,root.z]).toEqual([3,3]);expect(Object.is(root.y,-0)).toBe(true);
 expect(()=>host.evaluate({time:0,delta:.1,values:[]})).toThrow('vector differs');
});

test('missing, nonfinite and over-cap reads refuse atomically and recover with unchanged restoration',()=>{
 const root={a:1,b:2,x:3,y:4},faults:Fault[]=[];
 const host=installChannelPrograms([row('first','a','x','a'),row('second','b','y','b')],'gather',new Map([['root',root]])),restore=host.capture();
 const stop=onFault(fault=>{faults.push(fault);});
 try{
  Reflect.deleteProperty(root,'b');expect(()=>host.evaluate({time:0,delta:.1,values:{}})).toThrow('Missing borrowed field b');expect([root.x,root.y]).toEqual([3,4]);
  for(const value of [Number.NaN,Infinity,1e12+1]){root.b=value;host.evaluate({time:0,delta:.1,values:{}});expect([root.x,root.y]).toEqual([3,4]);}
  expect(faults.map(fault=>[fault.system,fault.verdict])).toEqual([['channels.gather','uncaught']]);
  root.b=1e12;host.evaluate({time:0,delta:.1,values:{}});expect([root.x,root.y]).toEqual([1,1e12]);
  restore();expect([root.x,root.y]).toEqual([3,4]);
 }finally{stop();}
});

test('mixed external observations retain the original snapshot and refusal path',()=>{
 const root={a:1,x:0,y:0},host=installChannelPrograms([row('bound','a','x','a'),row('external','delta','y')],'gather',new Map([['root',root]]));
 host.evaluate({time:0,delta:.1,values:{delta:2.5}});expect([root.x,root.y]).toEqual([1,2.5]);
 expect(()=>host.evaluate({time:0,delta:.1,values:[2.5]})).toThrow('vector differs');
});

test('unchanged borrowed values still advance each private recurrence',()=>{
 const dag=new ClientChannels('accumulate'),previous=dag.local(0),next=dag.binary('add',previous,dag.read('a'));
 dag.retain(previous,next);dag.output('value',next);
 const rows=parseClientChannels([{...dag.build(),numeric:{group:'gather',outputs:[{property:'value',target:'root',path:['x']}],inputs:[{input:'a',owner:'root',path:['a']}]}}]);
 const root={a:2,x:0},host=installChannelPrograms(rows,'gather',new Map([['root',root]]));
 host.evaluate({time:0,delta:.1,values:{}});expect(root.x).toBe(2);
 host.evaluate({time:0,delta:.1,values:{}});expect(root.x).toBe(4);
 root.a=0;host.evaluate({time:0,delta:.1,values:{}});host.evaluate({time:0,delta:.1,values:{}});expect(root.x).toBe(4);
});

test('zero-read lanes keep exact empty-vector admission',()=>{
 const dag=new ClientChannels('constant');dag.output('value',dag.constant(8));
 const rows=parseClientChannels([{...dag.build(),numeric:{group:'gather',outputs:[{property:'value',target:'root',path:['x']}]}}]);
 const root={x:0},host=installChannelPrograms(rows,'gather',new Map([['root',root]]));
 host.evaluate({time:0,delta:0,values:[]});expect(root.x).toBe(8);
 expect(()=>host.evaluate({time:0,delta:0,values:[1]})).toThrow('vector differs');
});

test('unchanged borrowed values retain clock refusal and recovery',()=>{
 const dag=new ClientChannels('clock');dag.output('value',dag.binary('add',dag.read('a'),dag.clock('time')));
 const rows=parseClientChannels([{...dag.build(),numeric:{group:'gather',outputs:[{property:'value',target:'root',path:['x']}],inputs:[{input:'a',owner:'root',path:['a']}]}}]);
 const root={a:2,x:0},host=installChannelPrograms(rows,'gather',new Map([['root',root]])),faults:Fault[]=[];
 const stop=onFault(fault=>{faults.push(fault);});
 try{
  host.evaluate({time:1,delta:.1,values:{}});expect(root.x).toBe(3);
  const refused:readonly (readonly [number,number])[]=[[Number.NaN,.1],[1,-.1],[1e13,.1],[1,Number.POSITIVE_INFINITY]];
  for(const [time,delta]of refused){
   host.evaluate({time,delta,values:{}});expect(root.x).toBe(3);
  }
  expect(faults).toHaveLength(1);
  host.evaluate({time:2,delta:.1,values:{}});expect(root.x).toBe(4);
 }finally{stop();}
});

test('getter reentry keeps the existing shared snapshot and first-read order',()=>{
 let reenter=false,a=0;const reads:string[]=[];
 const nested:{run?:()=>void}={};
 const root={get a():number{reads.push('a');return ++a;},get b():number{
  reads.push('b');if(reenter){reenter=false;nested.run?.();}return 2;
 },x:0,y:0,z:0};
 const host=installChannelPrograms([row('first','b','x','b'),row('second','a','y','a'),row('third','alias','z','b')],'gather',new Map([['root',root]]));
 nested.run=()=>host.evaluate({time:0,delta:.1,values:{}});
 reads.length=0;a=0;reenter=true;host.evaluate({time:0,delta:.1,values:{}});
 expect(reads).toEqual(['b','b','a']);expect([root.x,root.y,root.z]).toEqual([2,1,2]);
});
