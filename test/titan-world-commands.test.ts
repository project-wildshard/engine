import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {Rng} from '../src/shared/engine/core/rng';
import {V2_ACTION_OPS,type V2ActionBinding} from '@wildshard/format/scriptActionsV2';
import {parseReturnProjectionV2} from '@wildshard/format/returnProjectionV2';
import {ProjectedState,ReturnProgram} from '../src/shared/game/population/returnProgram';
import {prepareV2WorldActions,type V2WorldActionLoan} from '../src/shared/game/shardfile/worldActionsV2';
import {titanPrograms as programs} from './fixtures/titanInlineWitness';

function binding(kind:'cell-field'|'mount'):ReadonlyMap<number,V2ActionBinding>{
  return new Map([[1,{identity:'arena',handle:1,targets:new Map([[1,{identity:kind,kind}]]),operations:new Set([kind==='cell-field'?V2_ACTION_OPS.ignite:V2_ACTION_OPS.dismount]),maxCommands:1,bounds:{coordinate:Number.MAX_VALUE,velocity:0}}]]);
}

test('selected-only command names append without renumbering any original binding',()=>{
  const {script,v2}=programs.attack;
  expect(v2.additional).toStrictEqual({fields:['zzzzIntroT',...Array.from({length:8},(_,i)=>['K','On','Shown'].map(key=>`zzzzWhirl${i}${key}`)).flat()],signals:['zzzzDismount','zzzzIgnite','zzzzIntroClock','zzzzWhirlArm','zzzzWhirlGate'],channels:['zzzzIntroT','zzzzIntroTick',...Array.from({length:8},(_,i)=>['K','On','Shown'].map(key=>`zzzzWhirl${i}${key}`)).flat()]});
  for(const kind of ['fields','signals','channels'] as const){
    const original=Object.values(script[kind]).sort();expect(v2[kind].slice(0,original.length)).toStrictEqual(original);
  }
  const owner=new Scope('titan.selected-names');
  try{
    const first=ReturnProgram.page(programs.attack,owner);
    expect(first.signalName(v2.signals.indexOf('zzzzIgnite')+1)).toBe('zzzzIgnite');
    expect(ReturnProgram.page(programs.attack,owner)).toBe(first);
    const bindings=ReturnProgram.projectionBindings(programs.attack);expect(bindings.script.signals['zzzzIgnite']).toBe('zzzzIgnite');
  }finally{owner.dispose();}
});

test('the actual selected Titan emits only its declared same-call field and mount effects',()=>{
  const owner=new Scope('titan.world-commands'),random=new Rng(381),before=random.snapshot(),calls:unknown[]=[];
  const source=ReturnProgram.page(programs.attack,owner),project=source.prepareWorld;
  if(project===undefined)throw new Error('Missing world projection');
  let mounted=true;
  const field={activate:(x:number,z:number):void=>{calls.push(['ignite',x,z]);}};
  const mount={get mounted():boolean{return mounted;},dismount:(thrown?:boolean):void=>{calls.push(['dismount',thrown]);mounted=false;}};
  const loans:V2WorldActionLoan[]=[{binding:'arena',target:'cell-field',scope:owner,kind:'cell-field',owner:field},{binding:'arena',target:'mount',scope:owner,kind:'mount',owner:mount}];
  try{
    for(const [signal,frame,kind]of [['zzzzIgnite',{x:-0,z:2**40+.125},'cell-field'],['zzzzDismount',{},'mount'],['zzzzDismount',{},'mount']] as const){
      const prepared=project(signal,frame,binding(kind),[],random);expect(prepared.values).toStrictEqual({});expect(prepared.actions).toHaveLength(1);
      const effects=prepareV2WorldActions(prepared.actions,loans);effects.validate();prepared.accept();for(const apply of effects.operations)apply();
    }
    expect(calls).toStrictEqual([['ignite',-0,2**40+.125],['dismount',true]]);expect(random.snapshot()).toStrictEqual(before);
    expect(()=>project('zzzzIgnite',{x:1,z:2},binding('mount'),[],random)).toThrow('Undeclared v2 world action');
    expect(()=>project('zzzzDismount',{},new Map(),[],random)).toThrow('Undeclared v2 world action');
    expect(calls).toHaveLength(2);expect(random.snapshot()).toStrictEqual(before);
  }finally{owner.dispose();}
});

test('command operands are detached and retired owners refuse before native application',()=>{
  const parent=new Scope('titan.command-parent'),owner=parent.child('construction'),activate=vi.fn<(x:number,z:number)=>void>();
  const source=ReturnProgram.page(programs.attack,owner),project=source.prepareWorld;
  if(project===undefined)throw new Error('Missing world projection');
  const frame={x:-0,z:7},prepared=project('zzzzIgnite',frame,binding('cell-field'));
  frame.x=20;frame.z=40;
  expect(prepared.actions).toStrictEqual([{binding:'arena',target:'cell-field',kind:'ignite',x:-0,z:7}]);
  const effects=prepareV2WorldActions(prepared.actions,[{binding:'arena',target:'cell-field',scope:owner,kind:'cell-field',owner:{activate}}]);
  const retirement=parent.disposeSteps();retirement.next();
  expect(()=>effects.validate()).toThrow('Retired v2 action owner');expect(()=>prepared.accept()).toThrow('Return owner disposed');
  expect(activate).not.toHaveBeenCalled();for(const step of retirement)void step;
});

test('mismatched or inferred additional name tables refuse before instantiating a module',()=>{
  const scope=new Scope('titan.invalid-additional'),allocate=vi.spyOn(WebAssembly,'Instance');
  try{
    const v2=programs.attack.v2,additional=v2.additional;
    if(additional===undefined)throw new Error('Missing the Titan additional name tables');
    const corruptions=[
      {...v2,additional:undefined},
      {...v2,additional:{...additional,signals:['zzzzIgnite']}},
      {...v2,additional:{...additional,signals:['zzzzIgnite','zzzzDismount']}},
      {...v2,additional:{...additional,signals:[...additional.signals,'zzzzUnknown']}},
      {...v2,additional:{...additional,signals:['bossBegin',...additional.signals]}},
    ];
    for(const selected of corruptions)expect(()=>ReturnProgram.page({...programs.attack,v2:selected},scope)).toThrow();
    expect(allocate).not.toHaveBeenCalled();
    let reads=0;
    expect(()=>parseReturnProjectionV2({...v2,get additional(){reads++;return v2.additional;}})).toThrow('JSON data');expect(reads).toBe(0);
  }finally{allocate.mockRestore();scope.dispose();}
});


test('the selected intro clock preserves the original irregular cadence and reset',()=>{
  const scope=new Scope('titan.intro-clock'),source=ReturnProgram.page(programs.attack,scope);
  const state=new ProjectedState({initial:{zzzzIntroT:-1,zzzzIntroTick:0},signals:{clock:'zzzzIntroClock'},retainEvents:{clock:{zzzzIntroT:'zzzzIntroT',zzzzIntroTick:'zzzzIntroTick'}}},source);
  try{
    for(let pass=0;pass<2;pass++){
      let old=-1;
      for(const t of [-0,.02,.099999998,.099999999,.1,.15,.20001,-.5,-.49,0,.3]){
        const tick=old<0||t-old>=.1-1e-9;if(tick)old=t;
        expect(state.event('clock',{t})).toStrictEqual({zzzzIntroT:old,zzzzIntroTick:Number(tick)});
        expect(Object.is(state.value('zzzzIntroT'),old)).toBe(true);
      }
      state.reset();expect(state.value('zzzzIntroT')).toBe(-1);
    }
  }finally{scope.dispose();}
});


test('projection preflight resolves its default event through the declared aliases',()=>{
  const source=ReturnProgram.projectionBindings(programs.attack);
  expect(()=>ProjectedState.preflight({initial:{},signals:{member:'rider'},signal:'member'},source)).not.toThrow();
  expect(()=>ProjectedState.preflight({initial:{},signals:{member:'rider'},signal:'missing'},source)).toThrow('Missing projection event');
});
