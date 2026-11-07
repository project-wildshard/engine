import * as v from 'valibot';
import {MountCompanions,companionToName} from '../../src/shared/game/riding/companions';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import {nativeTamingOf} from '../../src/server/game/riding/nativeTaming';
import {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import {ClientRidingSessionSchema,cleanMountName} from '@wildshard/format/riding';
import {pickPrompt} from '../../src/shared/engine/world/interact/prompts';
import type {AnimalSim} from '../../src/shared/engine/entities/AnimalSim';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareProductPlan as prepareNalati} from './headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite());
const id=v.pipe(v.string(),v.minLength(1),v.maxLength(128));
const Saved=v.strictObject({version:v.literal(1),names:v.record(id,v.pipe(v.string(),v.maxLength(128))),
  rows:v.pipe(v.array(v.strictObject({id,name:v.pipe(v.string(),v.maxLength(128)),rest:finite,bolting:v.boolean(),come:finite})),v.maxLength(64)),
  open:v.nullable(id),draft:v.pipe(v.string(),v.maxLength(512)),clock:finite,
  candidate:v.nullable(id),point:v.tuple([finite,finite,finite]),radius:finite,lastCalled:v.nullable(id),calledDistance:finite});

/** Bind the page's actual companion, naming-rail and typed-name laws over
 * the existing native mounts. Inputs carry key code points, never a name or
 * whistle-state assignment. Newly bonded horses must come from real taming. */
export function withNalatiCompanions(prepare:PrepareHeadlessRuntime):PrepareHeadlessRuntime {return async preparation=>{
  const base=await prepare(preparation);
  const rows=v.parse(ClientRidingSessionSchema,await preparation.product.json('riding/session.json'));
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const mounted=mountedPlayerOf(host),taming=nativeTamingOf(host);
    if(mounted===undefined||taming===undefined)throw new Error('Companion inputs require actual native riding and taming owners');
    const names:Record<string,string>={},companions=new MountCompanions<AnimalSim,{label:string;radius:number}>(
      {names,restAt:rows.rest,speeds:rows.profile.speeds});
    const rules=ReturnProgram.native(host,rows.programs.riding);
    let open:string|null=null,draft='',clock=0,candidate:AnimalSim|null=null,radius=0,lastCalled:string|null=null,calledDistance=0;
    const point={x:0,y:0,z:0};
    const sync=():void=>{
      if(mounted.mountables.length>64)throw new Error('Companion roster exceeds its original bound');
      for(let index=companions.list.length-1;index>=0;index--){
        const entry=companions.list[index];if(entry!==undefined&&!mounted.mountables.includes(entry.a))companions.remove(entry.a);
      }
      for(const actor of mounted.mountables){
        const bonded=actor===taming.companion;
        const fallback=bonded?rows.taming.binding.names[Number(taming.upgraded)]:rows.preset.mountableLabel;
        if(fallback===undefined)throw new Error('Missing admitted companion name');
        companions.add(actor,fallback,undefined,name=>({label:`Mount ${name}`,radius:3.3}));
      }
    };
    sync();
    host.onStep('nalati.companions',dt=>{
      sync();
      companions.update(dt,leadPlayer(host).position,{ridden:()=>mounted.horse,now:()=>host.clock.now,
        throwRider:()=>{
          mounted.dismount(true);
          host.combat.hit({source:'env',sourceTags:['env.ride'],target:leadPlayer(host).health,amount:rows.profile.thrownDamage,
            point:leadPlayer(host).position,dir:mounted.rider.velocity,cause:{kind:'env.ride',label:rows.profile.thrownLabel,text:rows.profile.thrownLabel}});
        },bolted:()=>{ /* The page owns its bolt sound and caption. */ }});
      clock+=dt;
      if(clock+1e-9>=.1){
        clock=0;candidate=null;radius=0;
        if(!mounted.mounted&&open===null){
          const selected=companionToName(companions.list,(signal,frame)=>rules.project(signal,frame),rows.taming.rail,leadPlayer(host).position);
          if(selected!==null){candidate=selected.actor;point.x=selected.row['x']??candidate.position.x;point.z=selected.row['z']??candidate.position.z;
            point.y=host.groundHeightAt(point.x,point.z)+1.5;radius=selected.row['radius']??0;}
        }
      }
      for(const command of context.commands()){
        if(command.kind!=='script')continue;
        if(command.actorId==='nalati.name.open'){
          if(command.value!==1)throw new Error('Invalid name-open input');
          const at=leadPlayer(host).position;
          const namePrompt={position:point,radius},mountPrompts=companions.list.map(entry=>({position:entry.a.position,radius:entry.it.radius}));
          const selected=pickPrompt([...mountPrompts,namePrompt],{x:at.x,y:at.y+1.68,z:at.z},host.physics);
          if(open===null&&!mounted.mounted&&candidate!==null&&selected===namePrompt){open=candidate.entityId;draft=companions.nameOf(open)??candidate.label;}
        }else if(command.actorId==='nalati.name.character'){
          if(!Number.isInteger(command.value)||command.value<0||command.value>0x10ffff)throw new Error('Invalid typed name code point');
          if(open!==null){if(command.value===8)draft=Array.from(draft).slice(0,-1).join('');
            else{const next=draft+String.fromCodePoint(command.value);if(next.length>512)throw new Error('Native name draft exceeds its input bound');draft=next;}}
        }else if(command.actorId==='nalati.name.submit'){
          if(command.value!==1)throw new Error('Invalid name-submit input');
          const actor=open===null?undefined:host.entities.get(open),name=cleanMountName(draft,rows.naming.maximum);
          if(actor!==undefined&&name.length>0){companions.rename(actor,name);context.emit({kind:'hint',text:rows.naming.notice+name});}
        }else if(command.actorId==='nalati.name.close'){
          if(command.value!==1)throw new Error('Invalid name-close input');open=null;draft='';
        }else if(command.actorId==='nalati.whistle'){
          if(command.value!==1)throw new Error('Invalid whistle input');
          const called=mounted.mounted?null:companions.whistle(leadPlayer(host).position,actor=>actor.alive&&companions.free(actor));
          lastCalled=called?.entityId??null;calledDistance=called?.position.distanceTo(leadPlayer(host).position)??0;
        }else if(command.actorId==='nalati.companion.use'){
          if(command.value!==1)throw new Error('Invalid companion-use input');
          if(mounted.mounted){mounted.dismount();continue;}
          const prompts=companions.list.map(entry=>({entry,position:entry.a.position,radius:entry.it.radius})),at=leadPlayer(host).position;
          const selected=pickPrompt(prompts,{x:at.x,y:at.y+1.68,z:at.z},host.physics);
          if(selected!==undefined&&companions.free(selected.entry.a))mounted.mount(selected.entry.a.entityId);
        }
      }
    },{
      snapshot:()=>({version:1,names:{...names},rows:companions.list.map(entry=>({id:entry.a.entityId,name:entry.name,
        rest:entry.restT,bolting:entry.bolting,come:entry.comeT})),open,draft,clock,candidate:candidate?.entityId??null,
        point:[point.x,point.y,point.z],radius,lastCalled,calledDistance}),
      restore:input=>{
        sync();const saved=v.parse(Saved,input),byId=new Map(companions.list.map(entry=>[entry.a.entityId,entry]));
        if(saved.rows.length!==byId.size||new Set(saved.rows.map(entry=>entry.id)).size!==byId.size
          ||saved.rows.some(entry=>!byId.has(entry.id)||entry.rest<-.1||entry.rest>180||entry.come<-.1||entry.come>30)
          ||saved.clock<0||saved.clock>.1||saved.radius<0||saved.radius>4||saved.calledDistance<0||saved.calledDistance>=150
          ||saved.open!==null&&!byId.has(saved.open)||saved.candidate!==null&&!byId.has(saved.candidate))throw new Error('Invalid native companion continuation');
        for(const key of Object.keys(names))delete names[key];Object.assign(names,saved.names);
        for(const row of saved.rows){const entry=byId.get(row.id);if(entry===undefined)throw new Error('Missing native companion');
          entry.name=row.name;entry.a.label=row.name;entry.restT=row.rest;entry.bolting=row.bolting;entry.comeT=row.come;}
        open=saved.open;draft=saved.draft;clock=saved.clock;candidate=saved.candidate===null?null:byId.get(saved.candidate)?.a??null;
        [point.x,point.y,point.z]=saved.point;radius=saved.radius;lastCalled=saved.lastCalled;calledDistance=saved.calledDistance;
      },
    });
  }};
};}

export const prepareHeadlessRuntime:PrepareHeadlessRuntime=withNalatiCompanions(prepareNalati);
