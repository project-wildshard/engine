import * as v from 'valibot';
import {DialogueClock} from '../../src/shared/engine/quest/dialogueClock';
import type {SimHost} from '../../src/server/engine/sim';
import type {HeadlessRuntimeInstallation} from '../../src/server/host/headlessRuntime';
import type {QuestPresentationPorts} from '../../src/shared/game/quest/effectPresentation';
import type {Scope} from '../../src/shared/engine/app/scope';

interface PresentationHost {
  readonly scope:Scope;readonly clock:Pick<SimHost['clock'],'now'>;
  readonly hasStep:(id:string)=>boolean;
  readonly onStep:(id:string,run:(dt:number)=>void)=>()=>void;
}

const finite=v.pipe(v.number(),v.finite(),v.minValue(0)),text=v.pipe(v.string(),v.maxLength(8192));
const Row=v.variant('kind',[
  v.strictObject({kind:v.literal('toast'),text}),v.strictObject({kind:v.literal('sting'),name:text}),
  v.strictObject({kind:v.literal('reading'),title:text,lines:v.pipe(v.array(text),v.maxLength(128)),opened:v.boolean()}),
]);
const Saved=v.strictObject({version:v.literal(1),title:text,openedAt:finite,clock:v.unknown(),
  rows:v.pipe(v.array(Row),v.minLength(1),v.maxLength(128))});
type PresentationSaved=Omit<v.InferOutput<typeof Saved>,'clock'>&{clock:ReturnType<DialogueClock['snapshot']>};
const owners=new WeakMap<PresentationHost,{readonly reading:()=>boolean}>();
export function nalatiChapterPresentationOf(host:PresentationHost):{readonly reading:()=>boolean}|undefined{return owners.get(host);}

/** The existing dialogue panel's numeric clock and ordered presentation
 * outbox. Tap/use/back are input presses; none can publish a quest outcome. */
export function createNalatiChapterPresentation(host:PresentationHost,context:Pick<HeadlessRuntimeInstallation,'commands'|'emit'>,
  observe:QuestPresentationPorts['observe']):{
    readonly ports:QuestPresentationPorts;readonly snapshot:()=>PresentationSaved|undefined;readonly restore:(input:unknown)=>void;
  } {
  if(owners.has(host)||host.hasStep('nalati.chapter.reading'))throw new Error('Chapter presentation already entered');
  const clock=new DialogueClock(),rows:v.InferOutput<typeof Row>[]=[];let title='',openedAt=0;
  const live=():void=>{if(host.scope.disposed||host.scope.disposing)throw new Error('Chapter presentation retired');};
  const offer=(input:v.InferOutput<typeof Row>):void=>{live();if(rows.length>=128)throw new Error('Chapter presentation outbox exceeded');rows.push(v.parse(Row,input));};
  const reading=():boolean=>{live();return clock.isOpen;};owners.set(host,{reading});
  host.scope.onDispose(()=>{owners.delete(host);rows.length=0;clock.close();});
  host.onStep('nalati.chapter.reading',dt=>{
    live();for(const command of context.commands())if(command.kind==='script'&&command.actorId==='nalati.chapter.reading'){
      if(command.value!==1&&command.value!==2&&command.value!==-1)throw new Error('Unknown chapter reading input');
      if(command.value===-1)clock.close();
      else if(command.value===2||host.clock.now-openedAt>=.15)clock.advance();
    }
    clock.update(dt);
  });
  return {ports:{observe:source=>{live();return observe(source);},toast:value=>{offer({kind:'toast',text:value});context.emit({kind:'hint',text:value});},
    sting:name=>{offer({kind:'sting',name});},reading:effect=>{
      const opened=!clock.isOpen;offer({kind:'reading',title:effect.title,lines:[...effect.lines],opened});
      if(opened){title=effect.title;openedAt=host.clock.now;clock.open(effect.lines);}
    }},snapshot:()=>{live();if(rows.length===0)return undefined;
      const saved:PresentationSaved={version:1,title,openedAt,clock:clock.snapshot(),rows:rows.map(row=>v.parse(Row,row))};v.parse(Saved,saved);return saved;},restore:input=>{
      live();if(input===undefined){if(rows.length>0)throw new Error('Missing entered chapter presentation');return;}
      const saved=v.parse(Saved,input);if(saved.openedAt>host.clock.now)throw new Error('Chapter presentation exceeds its restored clock');
      const restoreClock=clock.prepareRestore(saved.clock);restoreClock();title=saved.title;openedAt=saved.openedAt;rows.splice(0,rows.length,...saved.rows);
    }};
}
