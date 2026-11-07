import * as v from 'valibot';
import type {SimHost} from '../../src/server/engine/sim';
import type {HeadlessRuntimeInstallation,PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import type {QuestData} from '@wildshard/format/quests';
import {DeclaredQuests} from '../../src/shared/game/quest/declared';
import {NpcReading} from '../../src/shared/engine/quest/dialogueClock';
import {pickPrompt} from '../../src/shared/engine/world/interact/prompts';
import {ChapterViewSchema,type ChapterViewRows} from '@wildshard/format/questPageComposition';
import {FigureRowSchema} from '@wildshard/format/figures';
import {parseChapterStoryPresentation} from '@wildshard/format/questStory';
import {createReadingRoster} from '../../src/shared/game/plugin/quests';
import {eyeReaches} from '../../src/shared/game/quest/interactionRows';
import {stepFigureOrbit} from '../../src/client/game/quest/figureOrbit';
import {prepareProductPlan as prepareNalati} from './headless-native';
import {installNalatiMountInputs} from './nalati-mount-inputs';
import {installNalatiChapterObservation} from './nalati-chapter-observation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite());
const FigureSave=v.array(v.strictObject({id:v.string(),x:finite,y:finite,z:finite,phase:finite,ring:finite,idleYaw:finite}));

/** Bind camp readings and the page's same numeric moving-speaker kernel. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareNalati(preparation);
  const content=v.parse(ChapterViewSchema,await preparation.product.json('quests/content.json'));
  const story=parseChapterStoryPresentation(await preparation.product.json('quests/chapters.json'));
  const figures=content.figures;
  if(figures===undefined)throw new Error('Nalati verb readings require admitted figures');
  return {...base,install:(host,context)=>{base.install(host,context);installNalatiMountInputs(host,context);installNalatiReadings(host,context,preparation.shard.quests,content,story);installNalatiChapterObservation(host,story);}};
};

/** Bind the original reading/quest owners without scene or UI construction. */
export function installNalatiReadings(host:SimHost,context:Pick<HeadlessRuntimeInstallation,'commands'|'emit'>,quests:QuestData,content:Pick<ChapterViewRows,'figures'|'npcs'>,story:ReturnType<typeof parseChapterStoryPresentation>):void {
    const figures=content.figures;if(figures===undefined)throw new Error('Nalati readings lack figures');
    if(host.quests.length>0)throw new Error('Nalati verb chapter already has an owner');
    new DeclaredQuests(host,quests,{fact:(name,actorId)=>context.emit({kind:'fact',name,actorId}),coins:(amount,actorId)=>context.emit({kind:'coins',amount,actorId})});
    const admittedFigures=Object.values(figures.figures).map(figure=>({orbit:figure.motion.orbit,phase:figure.phase,moving:figure.moving,row:v.parse(FigureRowSchema,figure.row)}));
    const speakers=story.talks.flatMap((talk,index)=>{
      const figure=admittedFigures.find(row=>row.row.id===(talk.figure??talk.id)),npc=content.npcs[talk.id];
      if(figure===undefined||npc===undefined)throw new Error('Nalati talk lacks its admitted speaker');
      const [x,offset,z]=figure.row.feet,y=host.groundHeightAt(x,z)+offset+figure.row.talkHeight;
      if(figure.moving&&figure.orbit===undefined)throw new Error('Moving speaker lacks its admitted orbit');
      return [{id:talk.id,index,position:{x,y,z},feet:{x,y:host.groundHeightAt(x,z),z},radius:talk.radius,
        orbit:figure.orbit,head:figure.row.talkHeight,npc,
        state:{phase:figure.phase,ring:0,idleYaw:figure.row.yaw,talking:false}}];
    });
    const readers=new Map<string,NpcReading>();
    const readings=createReadingRoster({speakers:Object.fromEntries(speakers.map(row=>[row.id,content.npcs[row.id]])),
      continuation:{bare:'elder',wrapped:speakers.filter(row=>row.id!=='elder').map(row=>row.id)}},
    speakers.map(row=>({kind:row.id,at:row.position,prompt:{...row.position,radius:row.radius}})),
    (npc,at,radius)=>{
      if(npc===undefined)throw new Error('Missing Nalati dialogue');
      const reader=new NpcReading(npc,host.flags,at,radius);readers.set(npc.id,reader);return reader;
    },()=>undefined);
    const moving=speakers.filter(row=>row.orbit!==undefined);
    const publish=(row:typeof speakers[number]):void=>{row.position.x=row.feet.x;row.position.y=row.feet.y+row.head;row.position.z=row.feet.z;};
    host.onStep('nalati.figures',dt=>{
      for(const row of moving){
        if(row.orbit===undefined)throw new Error('Missing moving speaker orbit');
        row.state.phase+=dt;row.state.talking=readers.get(row.npc.id)?.active===true;
        const distance=Math.hypot(leadPlayer(host).position.x-row.feet.x,leadPlayer(host).position.z-row.feet.z);
        stepFigureOrbit(row.orbit,row.state,row.feet,dt,distance,(x,z)=>host.groundHeightAt(x,z));publish(row);
      }
    },{snapshot:()=>moving.map(row=>({id:row.id,...row.feet,phase:row.state.phase,ring:row.state.ring,idleYaw:row.state.idleYaw})),
      restore:input=>{
        const saved=v.parse(FigureSave,input);
        if(saved.length!==moving.length||new Set(saved.map(row=>row.id)).size!==moving.length||saved.some(row=>!moving.some(owner=>owner.id===row.id)))throw new Error('Moving speaker continuation differs');
        for(const row of saved){const owner=moving.find(candidate=>candidate.id===row.id);if(owner===undefined)throw new Error('Missing moving speaker');
          Object.assign(owner.feet,{x:row.x,y:row.y,z:row.z});Object.assign(owner.state,{phase:row.phase,ring:row.ring,idleYaw:row.idleYaw});publish(owner);}
      }});
    host.onStep('nalati.talk',dt=>{
      for(const command of context.commands()){
        if(command.kind!=='script'||command.actorId!=='nalati.talk')continue;
        if(command.value===-1){readings.dismiss();continue;}
        const speaker=speakers.find(row=>row.index===command.value);
        if(speaker===undefined)throw new Error('Unknown Nalati reading speaker');
        const eye={x:leadPlayer(host).position.x,y:leadPlayer(host).position.y+1.68,z:leadPlayer(host).position.z};
        if(readings.active||eyeReaches(leadPlayer(host).position,{...speaker.position,radius:speaker.radius})&&pickPrompt([speaker],eye,host.physics)!==undefined)readings.press(speaker.id);
      }
      readings.advanceReading(dt,leadPlayer(host).position);
    },{snapshot:()=>readings.snapshot(),restore:value=>readings.prepareRestore(value)()});
}
