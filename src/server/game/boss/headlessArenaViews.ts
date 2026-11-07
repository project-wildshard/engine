import {Euler,Vector3} from 'three';
import {bindArenaPoseView} from './headlessArenaPose';
import type {OpenArenaPresentation} from './openArenaNative';
import type {ArenaScriptData} from '@wildshard/format/arenaScriptRows';
import type {SimHost} from '@wildshard/engine/sim';
import {parsePrivateScene} from '@wildshard/format/clientChannels';
import {HeadlessCloudBody} from './headlessCloudBody';
import {ArenaWhirls} from '@wildshard/engine/game/boss/arenaWhirls';
import type {ArenaDraw,ArenaTell,OpenArenaViews} from '../../../shared/game/boss/openArenaFight';
import {sayFightView} from '@wildshard/engine/sim/shardRows';
import {ARENA_TELL_CALLS,OPEN_ARENA_VIEW,arenaTellSlot} from '../../../shared/game/shardfile/wirePrompts';

/** Only the drawing ports are silent, and a tell says what it would draw. Heart matrices, pose feedback and every
 * whirlwind decision run their real owners. No drawn object is a target. */
export function openArenaNativeViews(host:SimHost,data:ArenaScriptData):OpenArenaViews<ArenaDraw> {
  // Said each frame it stands, for a page that came late; a hide once.
  const tell=(slot:number):ArenaTell=>{
    let up=false;
    const say=(call:typeof ARENA_TELL_CALLS[number],args:readonly number[]):void=>{sayFightView(host,OPEN_ARENA_VIEW.tell,[slot,ARENA_TELL_CALLS.indexOf(call),...args]);};
    return {ring:(...args)=>{up=true;say('ring',args);},lane:(...args)=>{up=true;say('lane',args);},wedge:(...args)=>{up=true;say('wedge',args);},hide:()=>{if(up)say('hide',[]);up=false;}};
  };
  const tells=new Map(Object.entries(data.geometry.arena.tells).map(([id,row],kind)=>[id,Array.from({length:row.count},(_,index)=>tell(arenaTellSlot(kind,index)))]));
  const geometry=data.geometry,tier=geometry.phone;
  const scene=parsePrivateScene(geometry.arena.scene);
  const capacities=new Map<string,number>([['smoke',data.arenaFire.smokeCount[0]],['flames',data.arenaFire.flameCount]]);
  for(const node of scene.nodes)if(node.kind==='mesh'&&node.instances!==undefined)capacities.set(node.id,node.instances);
  const draws=new Map<string,ArenaDraw>();
  const instances=(id:string):ArenaDraw=>{
    const capacity=capacities.get(id);if(capacity===undefined)throw new Error(`Missing admitted arena draw ${id}`);
    let draw=draws.get(id);if(draw===undefined){draw={count:capacity};draws.set(id,draw);}
    return draw;
  };
  return {
    body:pose=>new HeadlessCloudBody({...geometry.body,geometry:{...geometry.body.geometry,eyes:geometry.eyes},
      poses:geometry.poses,puffs:{...geometry.body.puffs,rows:tier.puffs}},pose,
      new Map([['place',{...data.arena.body,ground:host.groundHeightAt(data.arena.ground.x,data.arena.ground.z)}]])),
    arena:()=>({tell:(id,index=0)=>{const row=tells.get(id)?.[index];if(row===undefined)throw new Error(`Missing admitted arena tell ${id}`);return row;},
      tells:id=>{const rows=tells.get(id);if(rows===undefined)throw new Error(`Missing admitted arena tells ${id}`);return rows;},
      instances,mesh:()=>{throw new Error('Native arena has no drawn mesh borrower');},update:()=>undefined}),
    whirls:(_arena,wind,author,scope)=>{
      const law=new ArenaWhirls(data.whirls,wind,author,scope,(x,z)=>host.groundHeightAt(x,z));
      const hits:Vector3[]=[];
      return {arm:mask=>{law.arm(mask);},reset:()=>{law.reset();},bindView:()=>undefined,drawn:law.drawn,drawHeard:()=>undefined,
        update:(dt,t,live,thinkDt,frame)=>{const points=law.update(dt,t,live,thinkDt,frame);
          points.forEach((point,index)=>{const at=hits[index]??new Vector3();at.set(point.x,point.y,point.z);hits[index]=at;});
          hits.length=points.length;return hits;},snapshot:()=>law.snapshot(),restore:saved=>{law.restore(saved);}};
    },
    whirlsPreflight:(rows,bindings)=>{ArenaWhirls.preflight(rows,bindings);},
    fire:()=>({update:()=>undefined,smoke:instances('smoke'),flames:instances('flames')}),
  };
}

/** What a server lends an open arena: its silent views, its pose lane and a camera nothing draws through. */
export const HEADLESS_ARENA:OpenArenaPresentation={views:openArenaNativeViews,pose:bindArenaPoseView,camera:()=>({position:new Vector3(),rotation:new Euler()})};
