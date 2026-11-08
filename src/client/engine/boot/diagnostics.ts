import type {BootTiming} from '../../../shared/engine/boot/timing';

/** Clipboard is a trust boundary. The local collector stays complete; only this
 * explicit projection may leave it. URLs become per-report IDs and arbitrary
 * error/detail/worker/input strings never become export labels. */
const OPERATIONS=new Set([
  'document:navigation-and-html','app:html-script-start','app:collector-installed','app:document-and-module-graph',
  'app:dom-content-loaded','app:shell-dom-ready','app:first-paint-opportunity','app:entry-body','app:loading-adopt',
  'app:tables-import-and-prepare','app:tier-menu-download-imports','app:three-import','app:yield-before-main','app:main-import',
  'app:selected-discovery','app:session-code','app:common-service-imports','app:script-memory-reservation',
  'app:product-source-and-read','app:product-admission','app:control-ready','app:game-stage-start',
  'app:first-game-step-end','app:loader-complete','app:loader-failed','app:navigation-decision','app:first-frame-work-count',
  'worker:constructor','worker:fetch-evaluate-start','worker:constructor-to-first-message','worker:clock-roundtrip',
  'worker:module-body','worker:code-ready','worker:configuration-received','server:world-boot','server:booted-send',
  'server:booted-receive','server:first-rows','server:identity-module','server:storage-module','server:shell-module',
  'server:product-inputs','server:previous-session-close','server:indexed-saves-open','server:page-save-carry','server:reward-reconcile',
  'sw:cache-open','sw:cache-match','sw:body-and-cache-publication','sw:navigation-handler-and-delivery',
]);
const STEPS=new Set(['modules','admission','models','world','loadout','gameplay','hud','server','readyFrame','spawnPrograms',
  'worldPrograms','renderer','sky','terrain','cards','forest','physics','edge','grass','cabins','props','animals','weapon',
  'assembly','menu','shaders','firstFrame','audio','finish']);
const RESULTS=['pending','complete','failed','observed','settled','unresolved-at-loader-complete','first-message-observed',
  'unsupported','unavailable','timeout','error','cancelled','other'] as const;
const UNITS=['steps','files','messages','decoded-body-bytes','verified-input-bytes','bytes','units','other'] as const;
const DETAIL_NUMBERS=['done','total','count','bytes','loaded','files','p0','w1','w2','p3','workerTimeOrigin','pageTimeOrigin',
  'roundTrip','handling','transitAndQueue','scoped','duration','tick','rows','at','received','wall','decision','newTimeOrigin','validatedAt','validated'] as const;
const RESOURCE_NUMBERS=['startTime','workerStart','fetchStart','redirectStart','redirectEnd','domainLookupStart','domainLookupEnd',
  'connectStart','connectEnd','secureConnectionStart','requestStart','responseStart','responseEnd','duration','transferSize',
  'encodedBodySize','decodedBodySize','pageStart','pageEnd','timeOrigin','unloadEventStart','unloadEventEnd','domInteractive',
  'domContentLoadedEventStart','domContentLoadedEventEnd','domComplete','loadEventStart','loadEventEnd','redirectCount'] as const;
const record=(value:unknown):Readonly<Record<string,unknown>>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Readonly<Record<string,unknown>>:{};
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const list=(value:unknown):readonly unknown[]=>Array.isArray(value)?value:[];
function oneOf<T extends string>(value:unknown,allowed:readonly T[],fallback:T):T{return allowed.find(entry=>entry===value)??fallback;}
function numbers(value:unknown,keys:readonly string[]):Record<string,number|boolean|null>{
  const source=record(value),out:Record<string,number|boolean|null>={};
  for(const key of keys)if(Object.hasOwn(source,key)){const next=source[key];out[key]=typeof next==='boolean'?next:number(next);}
  return out;
}
const realm=(value:unknown):string=>typeof value==='string'&&/^(?:page|service-worker|worker:[0-9]{1,5})$/u.test(value)?value:'other';
/** Only build-system shaped public IDs are labels; arbitrary identifiers are not. */
export const diagnosticBuild=(value:unknown):string=>typeof value==='string'&&/^[a-f0-9]{7,40}-[a-z0-9]{6,16}$/u.test(value)?value:'unknown';
/** Authored/custom names and details remain local. Known engine stage keys remain useful. */
export function diagnosticStep(value:string,index:number):string{return STEPS.has(value)?value:`Step ${index}`;}

/** Preserve every event/resource/counter and its numeric facts, without exporting
 * arbitrary object payloads. No input is mutated and no network/storage is used. */
export function safeBootDiagnostics(timing:BootTiming|undefined):Readonly<Record<string,unknown>>|null{
  if(timing===undefined)return null;
  const source=record(timing),references=new Map<string,string>();
  const url=(value:unknown):string|null=>{
    if(typeof value!=='string'||value==='')return null;
    const held=references.get(value);if(held!==undefined)return held;
    const id=`resource-${references.size+1}`;references.set(value,id);return id;
  };
  const operation=(value:unknown,fallback:string):string=>{
    if(typeof value!=='string')return fallback;
    if(OPERATIONS.has(value)||/^worker:[0-9]{1,5}:messages-received$/u.test(value)
      ||/^(?:worker:[0-9]{1,5}:)?(?:atomic:completed|resource:completed|server:verified-input-bytes)$/u.test(value))return value;
    if(value.startsWith('game-stage:')&&STEPS.has(value.slice(11)))return value;
    const part=/^((?:worker:[0-9]{1,5}:)?(?:download:|server:fetch-headers:|server:read-body:|server:verified-input:))(.+)$/u.exec(value);
    return part===null?fallback:`${part[1]??''}${url(part[2])??'resource'}`;
  };
  const input=(value:unknown):Readonly<Record<string,unknown>>=>{
    const row=record(value);return {...numbers(row,['eventTimeStamp','handlerEntry','timeOrigin']),
      event:oneOf(row['event'],['pointerup','click','keydown','other'] as const,'other')};
  };
  const entries=list(source['entries']).map((value,index)=>{const row=record(value);return {
    id:number(row['id']),build:diagnosticBuild(row['build']),realm:realm(row['realm']),operation:operation(row['operation'],`operation-${index+1}`),
    start:number(row['start']),end:number(row['end']),result:oneOf(row['result'],RESULTS,'other'),detail:numbers(row['detail'],DETAIL_NUMBERS),
  };});
  const resources=list(source['resources']).map((value,index)=>{const row=record(value);return Object.assign(numbers(row,RESOURCE_NUMBERS),{
    id:index+1,url:url(row['url']),realm:realm(row['realm']),
    initiator:oneOf(row['initiator'],['fetch','xmlhttprequest','script','css','link','img','image','other'] as const,'other'),
  });});
  const counters=Object.fromEntries(Object.entries(record(source['counters'])).map(([key,value],index)=>{const row=record(value);return [
    operation(key,`counter-${index+1}`),Object.assign(numbers(row,['loaded','total','at','events']),{unit:oneOf(row['unit'],UNITS,'other')}),
  ];}));
  const realms=Object.entries(record(source['realms'])).map(([key,value])=>{const row=record(value),messages=record(row['messages']);return {
    realm:realm(key),url:url(row['url']),timeOrigin:number(row['timeOrigin']),
    precision:oneOf(row['precision'],['browser','other'] as const,'other'),
    instrumentation:oneOf(row['instrumentation'],['parent-only','worker','other'] as const,'other'),
    messages:{...numbers(messages,['count','first','last']),kinds:Object.entries(record(messages['kinds'])).map(([,count],index)=>({kind:index+1,count:number(count)}))},
  };});
  const lifecycle=list(source['lifecycle']).map(value=>{const row=record(value);return Object.assign(numbers(row,['at','persisted']),{
    name:oneOf(row['name'],['visibilitychange','pagehide','pageshow','other'] as const,'other'),
    visibility:oneOf(row['visibility'],['visible','hidden','prerender','other'] as const,'other')});});
  const handoff=record(source['handoff']),worker=record(source['serviceWorker']),gap=record(source['largestGap']);
  return {version:1,exportPrivacy:'urls-and-free-text-removed',build:diagnosticBuild(source['build']),attemptCount:number(source['attemptCount']),
    timeOrigin:number(source['timeOrigin']),entries,resources,counters,realms,navigation:numbers(source['navigation'],RESOURCE_NUMBERS),
    lifecycle,paints:list(source['paints']).map(value=>{const row=record(value);return {name:oneOf(row['name'],['first-paint','first-contentful-paint','unavailable','other'] as const,'other'),start:number(row['start'])};}),
    overflow:Object.values(record(source['overflow'])).map(value=>typeof value==='boolean'?value:number(value)),
    largestGap:{...numbers(gap,['before','after','ms']),visibility:oneOf(gap['visibility'],['visible','hidden','prerender','other'] as const,'other')},
    active:list(source['active']).map((value,index)=>{const row=record(value);return Object.assign(numbers(row,['id','ageMs']),{realm:realm(row['realm']),operation:operation(row['operation'],`active-${index+1}`)});}),
    serviceWorker:{controller:url(worker['controller'])},lastInput:input(source['lastInput']),
    handoff:{...numbers(handoff,['timeOrigin',...DETAIL_NUMBERS]),input:input(handoff['input'])},
  };
}
