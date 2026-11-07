import * as v from 'valibot';
import {StealthRowsSchema} from '@wildshard/format/stealth';
import {StealthCrouch,sampleStealthSources} from '../../src/shared/game/stealth/stealthLaw';
import {nativeGroupCollection} from '../../src/server/game/shardfile/groupRuntime';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import {nativeTamingOf} from '../../src/server/game/riding/nativeTaming';
import {practiceRoom} from '../../src/client/engine/core/practiceRoom';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareProductPlan as prepareNalati} from './headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite()),truth=v.boolean();
const Threat=v.strictObject({x:finite,z:finite,awareness:finite,alert:finite,hunting:finite});
const Observation=v.strictObject({grass:finite,mounted:truth,forced:truth,threats:v.pipe(v.array(Threat),v.maxLength(8))});
const Saved=v.object({law:v.strictObject({detection:v.strictObject({state:v.record(v.string(),finite),elapsed:finite}),
  state:v.string(),cover:finite,threat:finite,inLongGrass:truth,canCrouch:truth,latched:truth,threatX:finite,threatZ:finite,
  pendingToggle:truth,pendingCancel:truth,toggleWas:truth,shotUntil:finite,t:finite,hinted:truth,observation:Observation}),
  answer:v.strictObject({allowed:truth,latched:truth}),hints:v.pipe(finite,v.integer(),v.minValue(0))});

/** Observe actual native grass/groups and drive the page's stealth law from
 * real crouch, sprint, jump and disc inputs. No awareness/cover is supplied. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareNalati(preparation),rows=v.parse(StealthRowsSchema,preparation.product.section('player/stealth'));
  const sources=rows.observations;if(sources===undefined)throw new Error('Stealth requires its admitted observation sources');
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const groups=nativeGroupCollection(host,'nalati.groups'),grass=groups.environment,mounted=mountedPlayerOf(host),taming=nativeTamingOf(host);
    if(grass===undefined||mounted===undefined||taming===undefined)throw new Error('Stealth requires actual native grass and riding owners');
    const law=new StealthCrouch(rows,host.scope);let answer={allowed:false,latched:false},hints=0;
    host.onStep('nalati.stealth',dt=>{
      const commands=context.commands();let player:Extract<(typeof commands)[number],{kind:'player'}>|undefined;
      for(const command of commands)if(command.kind==='player')player=command;
      for(const command of commands)if(command.kind==='script'&&command.actorId==='nalati.stealth.toggle'){
        if(command.value!==1)throw new Error('Invalid crouch disc input');law.press();
      }
      const forward=player?.steer===undefined?0:player.steer.keyY+player.steer.stickY;
      const feet=leadPlayer(host).position;
      law.step(dt,{sprint:player?.sprint===true&&forward>0,jump:player?.jump===true,hover:leadPlayer(host).board.on,
        swimming:leadPlayer(host).swim.on,practice:practiceRoom.open,crouching:mounted.rider.crouching,x:feet.x,z:feet.z});
      answer=law.answer({want:player?.crouch===true,via:'hold'});
      const observation=sampleStealthSources(sources,leadPlayer(host),{population:groups,riding:{mounted:mounted.mounted,taming:{view:taming.view}},grass});
      law.observe(host.clock.now,observation);
      if(law.takeHint()){hints++;context.emit({kind:'hint',text:rows.hint});}
    },{
      snapshot:()=>JSON.stringify({law:law.snapshot(),answer,hints,label:rows.labels[law.state]??rows.labels['visible']??'',hint:rows.hint,
        crouching:mounted.rider.crouching,grass:grass.grassStandingAt(leadPlayer(host).position.x,leadPlayer(host).position.z)}),
      restore:input=>{const saved=v.parse(Saved,typeof input==='string'?JSON.parse(input):input);law.restore(saved.law);answer=saved.answer;hints=saved.hints;},
    },'afterBodies');
  }};
};
