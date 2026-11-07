import {carriedPropFiles} from './fixtures/carriedPropFiles';
import {lendNalatiKokpar} from './fixtures/nalati-return-modules';
import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import {SkyRig} from '../src/client/engine/world/skyRig';
import {WorldRegistry} from '../src/client/engine/world/registry';
import {Flags} from '../src/shared/engine/world/interact/flags';
import {QuestState} from '../src/shared/engine/quest/core';
import {CarriedQuestProp} from '../src/client/game/quest/carriedProp';
import {publishBoundQuest} from '../src/shared/game/quest/boundState';
import {parseCarriedQuest} from '@wildshard/format/questSteps';
import {parseDecisionScripts} from '@wildshard/format/decisionScripts';
import * as terrain from '../src/shared/engine/world/terrainHeight';
import * as riding from '../src/client/game/riding/client';
import type {ShardContext} from '../src/client/game/plugin/context';
import {carriedQuestRows} from './fixtures/nalati-carried-quest';

function fixture(){
  const construction=new Scope('delivery construction'),scope=new Scope('delivery entered'),sky:unknown=Object.create(SkyRig.prototype),quest:unknown=Object.create(QuestState.prototype);
  if(!(sky instanceof SkyRig)||!(quest instanceof QuestState))throw new Error('Fixture concrete owners missing');
  lendNalatiKokpar(scope);
  Reflect.set(sky,'csm',{lights:[]});Reflect.set(sky,'sunDir',new THREE.Vector3(0,1,0));vi.spyOn(sky,'setupMaterial').mockImplementation(()=>undefined);
  vi.spyOn(terrain,'terrainHeight').mockImplementation((x,z)=>x*.001+z*.002);
  const player={position:new THREE.Vector3(4,0,6),velocity:new THREE.Vector3(2,0,0),yaw:.4},events:string[]=[],flags=new Flags('orchard-delivery');
  Object.assign(quest,{flags,def:{id:'orchard'}});publishBoundQuest(scope,quest);
  const world={sky,registry:new WorldRegistry(),player},play={hud:{toast:(text:string)=>{events.push(text);}},music:{sting:()=>undefined}},runtime={world,play};
  // Concrete fixture services, with no application construction or asynchronous boot.
  const ctx={} as ShardContext;Object.assign(ctx,{scope,game:{runtime}});
  const script=parseDecisionScripts([carriedQuestRows.program.script])[0];
  if(script===undefined)throw new Error('Missing fixture script');
  const rows={...carriedQuestRows,quest:'orchard',objectName:'delivery-crate',carrier:{kind:'player',minimumSpeed:1},home:{x:4,z:6},goals:[{x:12,z:6},{x:-4,z:6}],
    program:{...carriedQuestRows.program,script:{...script,id:'orchard.delivery',params:{...script.params,homeX:4,homeZ:6,goal0X:12,goal0Z:6,goal1X:-4,goal1Z:6}}},
    warning:[],events:[{value:1,effects:[{kind:'toast',text:'Loaded'}]},{value:5,effects:[{kind:'toast',text:'Too slow'}]},{value:7,effects:[{kind:'toast',text:'Delivered'},{kind:'flag',flag:'delivery:won'}]}]};
  const create=()=>construction.run(()=>new CarriedQuestProp(ctx,rows,carriedPropFiles));
  return {construction,scope,ctx,world,play,runtime,quest,flags,player,events,rows,create,dispose:()=>{scope.dispose();construction.dispose();vi.restoreAllMocks();}};
}

it('delivers a player-carried crate without a riding owner and keeps the AS cadence/effect order',()=>{
  const f=fixture(),mount=vi.spyOn(riding,'pageRidingMount').mockImplementation(()=>{throw new Error('No riding in this page');});
  try{
    const prop=f.create();
    prop.update(.05);expect(prop.carrying).toBe(false);prop.update(.05);expect(prop.carrying).toBe(true);expect(f.events).toEqual(['Loaded']);
    f.player.position.set(6,3,6);f.player.yaw=.8;prop.update(.01);
    expect(prop.object.position.x).toBe(6+Math.cos(.8)*f.rows.poses.attached.out);expect(prop.object.rotation.y).toBe(.8+f.rows.poses.attached.yaw);
    f.player.position.set(12,3,6);prop.update(.1);expect(prop.carrying).toBe(false);expect(f.events).toEqual(['Loaded','Delivered']);expect(f.flags.has('delivery:won')).toBe(true);
    expect(prop.object.position.x).toBe(12);expect(prop.object.position.y).toBe(12*.001+6*.002+f.rows.poses.delivered.height);
    expect(mount).not.toHaveBeenCalled();
  }finally{f.dispose();}
});

it('uses declared player movement eligibility and never reads a rendered pose as a law coordinate',()=>{
  const f=fixture();try{
    const prop=f.create();prop.object.position.set(999,999,999);prop.update(.1);expect(prop.carrying).toBe(true);
    f.player.velocity.set(0,0,0);prop.update(2.5);expect(prop.carrying).toBe(true);prop.update(.1);
    expect(prop.carrying).toBe(false);expect(f.events).toEqual(['Loaded','Too slow']);expect(prop.object.position.x).toBe(4);
  }finally{f.dispose();}
});

it('refuses replaced concrete owners before guest state, pose or effects change',()=>{
  const f=fixture();try{
    const prop=f.create(),before=prop.object.position.clone();
    f.runtime.world={...f.world};expect(()=>prop.update(.1)).toThrow('owner changed');expect(prop.carrying).toBe(false);expect(prop.object.position.equals(before)).toBe(true);expect(f.events).toEqual([]);
    f.runtime.world=f.world;f.play.hud={toast:()=>{throw new Error('Replacement must not run');}};expect(()=>prop.win()).toThrow('owner changed');expect(f.events).toEqual([]);
  }finally{f.dispose();}
});

it('keeps construction and entered lifetime independent, refusing sliced retirement of either ancestor',()=>{
  for(const retire of ['construction','entered'] as const){
    const f=fixture(),parent=new Scope('retiring parent');try{
      const child=new Scope('entered child',parent);
      if(retire==='entered'){Object.assign(f.ctx,{scope:child});publishBoundQuest(child,f.quest);lendNalatiKokpar(child);}
      const prop=retire==='construction'?child.run(()=>new CarriedQuestProp(f.ctx,f.rows,carriedPropFiles)):f.create();
      parent.onDispose(()=>undefined);const steps=parent.disposeSteps();steps.next();
      expect(child.disposing).toBe(true);expect(()=>prop.update(.1)).toThrow('owner changed');expect(f.events).toEqual([]);
      expect(()=>child.run(()=>new CarriedQuestProp(f.ctx,f.rows,carriedPropFiles))).toThrow('live entered owners');
      for(const step of steps)expect(step.scope.length).toBeGreaterThan(0);
    }finally{parent.dispose();f.dispose();}
  }
});

it('refuses getters and unknown carrier fields before reading data or allocating a prop',()=>{
  const f=fixture();try{
    expect(Object.hasOwn(parseCarriedQuest(carriedQuestRows),'carrier')).toBe(false);
    expect(parseCarriedQuest({...f.rows,carrier:{kind:'mount'}}).carrier).toEqual({kind:'mount'});
    let reads=0;const input={...f.rows};Object.defineProperty(input,'carrier',{enumerable:true,get:()=>{reads++;return {kind:'player',minimumSpeed:0};}});
    expect(()=>f.construction.run(()=>new CarriedQuestProp(f.ctx,input))).toThrow('JSON data');expect(reads).toBe(0);
    for(const carrier of [{kind:'other'},{kind:'player',minimumSpeed:-1},{kind:'player',minimumSpeed:Infinity},{kind:'player',minimumSpeed:101},{kind:'mount',speed:1}])expect(()=>parseCarriedQuest({...f.rows,carrier})).toThrow();
    f.scope.dispose();expect(()=>f.create()).toThrow('live entered owners');expect(f.events).toEqual([]);
  }finally{f.dispose();}
});
