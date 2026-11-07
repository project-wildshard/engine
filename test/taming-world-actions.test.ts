import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {layoutV2} from '@wildshard/format/scriptWireV2';
import {readV2WorldActions,V2_ACTION_OPS,type V2ActionBinding} from '@wildshard/format/scriptActionsV2';
import {prepareV2WorldActions,type V2WorldActionLoan} from '../src/shared/game/shardfile/worldActionsV2';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import {tamingRig} from './fixtures/tamingServices';

const layout=layoutV2(1024,1,new Map([[10,16]]));
const binding:V2ActionBinding={identity:'taming',handle:7,targets:new Map([[1,{identity:'service',kind:'taming'}],[16,{identity:'herd',kind:'taming-herd'}],[64,{identity:'horse',kind:'taming-actor'}]]),operations:new Set(Object.values(V2_ACTION_OPS)),maxCommands:16,bounds:{coordinate:1e10,velocity:0}};
function commands(rows:readonly (readonly [number,number,readonly number[]])[]):DataView{
  const view=new DataView(new ArrayBuffer(65536)),region=layout.regions[9];if(region===undefined)throw new Error('Missing commands');
  rows.forEach(([op,target,values],index)=>{const at=layout.io+region.offset+index*64;view.setUint32(at,7,true);view.setUint32(at+4,op,true);view.setUint32(at+8,target,true);values.forEach((value,column)=>view.setFloat64(at+16+column*8,value,true));});return view;
}
const read=(view:DataView,count:number)=>readV2WorldActions(view,layout,count,new Map([[7,binding]]));
function owners(f:ReturnType<typeof tamingRig>):V2WorldActionLoan[]{
  const actor=f.herd.stallion;if(actor===null)throw new Error('Missing actor');
  return [{binding:'taming',target:'service',scope:f.scope,kind:'taming',owner:f.opts,services:f.opts,presentation:f.binding},
    {binding:'taming',target:'herd',scope:f.scope,kind:'taming-herd',owner:f.herd},
    {binding:'taming',target:'horse',scope:f.scope,kind:'taming-actor',owner:actor,services:f.opts,presentation:f.binding}];
}

test('all taming operations resolve declared kinds to the same native owners',()=>{
  const f=tamingRig();f.allowMount();const rows=read(commands([[26,16,[2,1,3]],[27,16,[1]],[28,16,[-0,5]],[29,64,[1]],[30,1,[4]],[31,64,[1,-1,0,1,1,-0]],[23,1,[1]],[34,16,[]],[35,64,[]],[36,64,[]],[32,1,[8,9,.2,1]],[33,64,[1]],[37,1,[0]],[38,1,[2]],[39,1,[-0,-.1]]]),15);
  const prepared=prepareV2WorldActions(rows,owners(f));expect(f.events).toStrictEqual([]);prepared.validate();const results=prepared.operations.map(apply=>apply());
  expect(f.events).toStrictEqual(['trust:2','lead','mount:wild:true','hurt:4','dismount:true','release','hide:wild','remove:wild','retire:wild','spawn:bonded-1','add:bonded-1','write:better-bond','notice:Better bonded','bonded:wild','breaking:false','notice:Thrown','yaw','pitch']);
  expect(results[3]).toEqual({kind:'mounted',accepted:true});expect(results[10]?.kind).toBe('adopted');
  expect(f.herd.alert).toBe(3);expect(f.herd.alertOwned).toBe(true);expect(f.opts.player.pitch).toBe(-.1);expect(Object.is(f.opts.player.yaw,-0)).toBe(true);
  expect(f.herd.stallion?.mem).toMatchObject({buck:1,buckDir:-1,rear:0,kick:1,toss:1});
});

test('undeclared ids, foreign target kinds, nonfinite operands and reserved words refuse whole banks',()=>{
  for(const [op,target,values]of [[40,1,[]],[26,1,[1]],[29,16,[1]],[32,1,[0,0,0,2]],[31,64,[1,0]],[30,1,[Number.NaN]],[26,16,[1,0,-0]],[23,1,[1,0,0,0,0,1]],[26,999,[1]]] as const){
    const f=tamingRig();expect(()=>read(commands([[26,16,[3]], [op,target,values]]),2)).toThrow();expect(f.events).toStrictEqual([]);
  }
  const view=commands([[26,16,[3]]]);expect(()=>readV2WorldActions(view,layout,1,new Map([[7,{...binding,operations:new Set()}]]))).toThrow();
});

test('a missing native loan or replaced service refuses before prefix effects',()=>{
  const f=tamingRig(),rows=read(commands([[26,16,[2]],[30,1,[3]]]),2),loans=owners(f);
  expect(()=>prepareV2WorldActions(rows,loans.filter(row=>row.kind!=='taming'))).toThrow('Unowned');expect(f.events).toStrictEqual([]);
  const prepared=prepareV2WorldActions(rows,loans);f.scope.expose(f.opts,'hurt',()=>{throw new Error('foreign');});expect(()=>prepared.validate()).toThrow('Changed');expect(f.events).toStrictEqual([]);
});

test('retirement by an earlier native effect refuses the next operation',()=>{
  const f=tamingRig();f.binding.onBreaking=()=>{f.scope.dispose();};
  const prepared=prepareV2WorldActions(read(commands([[37,1,[0]],[26,16,[2]]]),2),owners(f));prepared.validate();prepared.operations[0]?.();
  expect(()=>prepared.operations[1]?.()).toThrow('Retired');expect(f.herd.trust).toBe(100);
});

test('taming refuses a sliced ancestor or replaced mount without drawing or projecting',()=>{
  const parent=new Scope('taming.parent');const f=tamingRig(null,'wild',null,'ordinary',1,false,parent.child('entered'));
  parent.onDispose(()=>undefined);const steps=parent.disposeSteps();steps.next();expect(f.scope.disposed).toBe(false);expect(f.scope.disposing).toBe(true);f.events.length=0;
  expect(()=>f.binding.update(.1)).toThrow('Retired');expect(f.events).toStrictEqual([]);steps.return();
  const g=tamingRig();g.scope.expose(g.opts,'mount',{...g.opts.mount});expect(()=>g.binding.forceBreak()).toThrow('Changed');expect(g.events).toStrictEqual([]);
});

test.each(['zzNext','zzCapture','zzUpgraded','zzVEar'])('malformed %s refuses continuation and native prefix before acceptance',key=>{
  const f=tamingRig(),before=f.binding.snapshot(),original:unknown=Reflect.getOwnPropertyDescriptor(ReturnProjectionV2.prototype,'prepare')?.value;
  function projectionMethod(value:unknown):value is ReturnProjectionV2['prepare']{return typeof value==='function';}
  if(!projectionMethod(original))throw new Error('Missing native projection method');
  const spy=vi.spyOn(ReturnProjectionV2.prototype,'prepare').mockImplementation(function altered(this:ReturnProjectionV2,...args){const prepared:ReturnType<ReturnProjectionV2['prepare']>=Reflect.apply(original,this,args);return {...prepared,values:{...prepared.values,[key]:key==='zzNext'?1.25:4}};});
  try{expect(()=>f.binding.forceBreak()).toThrow();expect(f.binding.snapshot()).toBe(before);expect(f.events).toStrictEqual([]);}finally{spy.mockRestore();}
});
