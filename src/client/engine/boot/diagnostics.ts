import type {BootTiming} from '../../../shared/engine/boot/timing';

/** Clipboard is a trust boundary. The local collector stays complete; only this
 * explicit projection may leave it. LD3 (J208): this page's own files are named by their path (they are public, and a
 * `resource-N` the reader cannot map found no cause in Jake's 52 s reload); another origin's URL becomes a per-report ID,
 * a query keeps only a content `v`, and arbitrary error/detail/worker/input strings never become export labels. */
const OPERATIONS=new Set([
  'document:navigation-and-html','app:html-script-start','app:collector-installed','app:document-and-module-graph','app:entry-and-session-preparation','app:page-entry-import',
  'app:dom-content-loaded','app:shell-dom-ready','app:first-paint-opportunity','app:entry-body','app:loading-adopt',
  'app:tables-import-and-prepare','app:tier-menu-download-imports','app:three-import','app:yield-before-main','app:main-import',
  'app:selected-discovery','app:session-code','app:common-service-imports','app:script-memory-reservation',
  'app:product-source-and-read','app:product-admission','app:control-ready','app:game-stage-start',
  'app:first-game-step-end','app:loader-complete','app:loader-failed','app:navigation-decision','app:first-frame-work-count',
  'worker:constructor','worker:fetch-evaluate-start','worker:constructor-to-first-message','worker:clock-roundtrip',
  'worker:module-body','worker:code-ready','worker:configuration-received','server:world-boot','server:booted-send',
  'server:booted-receive','server:first-rows','server:first-owner-adopted','server:first-owner-unadopted','server:identity-module','server:storage-module','server:shell-module',
  'server:product-inputs','server:previous-session-close','server:indexed-saves-open','server:page-save-carry','server:reward-reconcile',
  'sw:request','sw:handler-received','sw:cache-hit','sw:cache-miss','sw:cache-match-ignore-search','sw:discard-html',
  'sw:shared-cache-open','sw:shared-cache-match','sw:discard-shared-html','sw:legacy-cache-list','sw:legacy-cache-open',
  'sw:legacy-cache-match','sw:legacy-copy-publication','sw:network-fetch-to-headers','sw:response-delivery-decision','sw:buffer-overflow',
  'sw:cache-open','sw:cache-match','sw:body-and-cache-publication','sw:navigation-handler-and-delivery',
]);
const STEPS=new Set(['product','manifest.load','level.data','ktx2','audio.preload','level.world','level.kit','level.play','roster','modules','admission','models','world','loadout','gameplay','hud','server','readyFrame','spawnPrograms',
  'runtimeModules','data','audioFiles','spawnDetail','worldFrame','home','homePrograms','road','colliders','enter','warm',
  'prepare','boundary','checkpoint','commit','activate','worldPrograms','renderer','sky','terrain','cards','forest','physics','edge','grass','cabins','props','animals','weapon',
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
/** LD3: engine operations named in a paste beyond OPERATIONS: an explicit list (Codex review of ca3c1d8: a pattern let
 *  any `app:<text>` through). A name not listed here or in OPERATIONS still becomes `operation-N`. */
const NAMED_OPERATIONS=new Set(['download:cache-check','app:session-code-ready','app:session-start','app:first-game-step-start',
  'app:first-game-frame-opportunity','app:first-game-frame-submitted','app:shader-work-count','worker:configuration-send',
  // NINE-DRAGON-BENCHMAX NB3: the readyFrame spawn view's parts (game/shardfile/tileDriver.ts, controlRefinement.ts)
  'app:spawn-view-frame','app:spawn-view-tiles','app:spawn-view-fence','app:ready-minimap','app:ready-horizon',
  ...['await-booted','boot-configuration','descriptor-read-and-verification','first-authoritative-frame','first-body-links',
    'first-body-preparation-end','first-body-preparation-start','hello-send','launch-complete','rapier-held-bytes','rapier-initialize',
    'ready-received','ready-send','road-collision-inputs','road-physics-and-collision','simulation-and-collision-create',
    'welcome-receive','worker-bootstrap-ready','worker-runtime-import'].map(name=>`server:${name}`)]);
/** LD3: the loading waits a paste may name, exactly as the engine writes them; `GLTF decode <url>` and `Image decode
 *  <url>` name their file the way every resource is named. Any other label stays private. */
const WAIT_LABELS=new Set(['GLTF decode (owned bytes)','GLTF decode pacing','Grid road grain','Grid road signs','Horizon paintings',
  'Material texture transcode','Minimap','Read Model data','Read Product data','Read Product data section','Read Product descriptor','Read Program data',
  'Read Texture data','Read grid session module','Spawn download','Spawn view','Startup stylesheets']);
const SAFE_SEGMENT=/^[A-Za-z0-9._-]{1,96}$/u, CONTENT_V=/^[a-f0-9]{8,64}$/u;
/** LD3: the build's public routes. Same origin alone does not make a file public (Codex review of ca3c1d8). */
const PUBLIC_DIRECTORIES=new Set(['b','assets','shardfiles','basis','fonts','programs','sw-core','calibration']);
const PUBLIC_FILES=new Set(['/','/index.html','/sw.js','/version.json','/manifest.webmanifest','/favicon.png','/apple-touch-icon.png',
  '/icon-192.png','/icon-512.png','/catalogue.json','/asset-index.json','/asset-manifest.json','/clear-cache.json']);
/** LD3: this page's own public file as its path (opaque segments elided), or null for another origin, a route outside
 *  the build's public files, a credential or a non-http URL: those keep a per-report ID. */
export function diagnosticPath(value:string,origin:string|undefined=typeof location==='undefined'?undefined:location.origin):string|null{
  if(origin===undefined||!/^https?:/u.test(origin))return null;
  let parsed:URL;try{parsed=new URL(value,origin);}catch{return null;}
  if(!/^https?:$/u.test(parsed.protocol)||parsed.origin!==origin||parsed.username!==''||parsed.password!=='')return null;
  const segments=parsed.pathname.split('/').slice(1);
  if(!PUBLIC_FILES.has(parsed.pathname)&&!(segments.length>1&&PUBLIC_DIRECTORIES.has(segments[0]??'')))return null;
  const path=`/${segments.map(segment=>segment===''||SAFE_SEGMENT.test(segment)?segment:'…').join('/')}`;
  const version=parsed.searchParams.get('v');
  return `${path}${version!==null&&CONTENT_V.test(version)?`?v=${version}`:''}`.slice(0,200);
}
/** Authored/custom names and details remain local. Known engine stage keys remain useful. */
export function diagnosticStep(value:string,index:number):string{return STEPS.has(value)?value:`Step ${index}`;}

/** What the export keeps: this page's own paths; other URLs, errors and free text stay on the device. */
export const DIAGNOSTIC_PRIVACY='own-paths-other-urls-and-free-text-removed';
interface SummaryEntry {readonly realm:string;readonly operation:string;readonly start:number|null;readonly end:number|null}
interface SummaryResource {readonly realm:string;readonly url:string|null;readonly startTime?:number|boolean|null}
/** Spans that only repeat other spans (the whole Start, the document) never name the slowest step. */
const UMBRELLAS=new Set(['app:entry-and-session-preparation','app:document-and-module-graph','game-stage:modules','document:navigation-and-html']);
const secondsText=(ms:number):string=>`${(ms/1000).toFixed(1)} s`;
/** LD3 (J208): the paste's first lines, for a human. The slowest page step, the longest page span inside it, and the
 *  longest stretch inside it in which no page request started. Only collector facts, named as the export names them;
 *  page clock only (a service worker's or worker's clock has its own origin). */
export function diagnosticSummary(entries:readonly SummaryEntry[],resources:readonly SummaryResource[]):string[]{
  const spans=entries.flatMap(row=>row.realm==='page'&&row.start!==null&&row.end!==null&&row.end>row.start?[{operation:row.operation,start:row.start,end:row.end,ms:row.end-row.start}]:[]);
  const steps=spans.filter(row=>/^(?:app|game-stage):/u.test(row.operation)&&!UMBRELLAS.has(row.operation)).sort((a,b)=>b.ms-a.ms);
  const slowest=steps[0];
  if(slowest===undefined)return ['summary: no completed page step'];
  const lines=[`summary: slowest step ${slowest.operation} · ${secondsText(slowest.ms)} (${secondsText(slowest.start)} → ${secondsText(slowest.end)})`];
  const inside=spans.filter(row=>row!==slowest&&row.start>=slowest.start&&row.end<=slowest.end&&row.ms<slowest.ms).sort((a,b)=>b.ms-a.ms)[0];
  if(inside!==undefined)lines.push(`  longest inside it: ${inside.operation} · ${secondsText(inside.ms)} (${secondsText(inside.start)} → ${secondsText(inside.end)})`);
  const starts=resources.flatMap(row=>row.realm==='page'&&typeof row.startTime==='number'&&row.startTime>=slowest.start&&row.startTime<=slowest.end?[{at:row.startTime,url:row.url}]:[]).sort((a,b)=>a.at-b.at);
  let gap={from:slowest.start,to:slowest.end,next:null as string|null};
  for(let index=0,from=slowest.start;index<=starts.length;index++){
    const next=starts[index],to=next?.at??slowest.end;
    if(to-from>gap.to-gap.from||index===0)gap={from,to,next:next?.url??null};
    from=to;
  }
  if(gap.to-gap.from>=1000)lines.push(`  no page request started for ${secondsText(gap.to-gap.from)} (${secondsText(gap.from)} → ${secondsText(gap.to)})${gap.next===null?'':`; the next was ${gap.next}`}`);
  const others=steps.slice(1,4).map(row=>`${row.operation} ${secondsText(row.ms)}`);
  if(others.length>0)lines.push(`  next slowest: ${others.join(' · ')}`);
  return lines;
}

/** Preserve every event/resource/counter and its numeric facts, without exporting
 * arbitrary object payloads. No input is mutated and no network/storage is used. */
export function safeBootDiagnostics(timing:BootTiming|undefined):Readonly<Record<string,unknown>>|null{
  if(timing===undefined)return null;
  const source=record(timing),references=new Map<string,string>(),named=new Map<string,string>(),taken=new Set<string>();
  // LS4: a path is a lossy name (a segment over 96 characters, like LD6's longest chunk names, is elided; a query keeps
  // only `v`), and counters are keyed by it, so two of this page's files never share one: the second and later files of
  // one path read `<path>#2`, `#3` …, and the same file keeps its one name
  const url=(value:unknown):string|null=>{
    if(typeof value!=='string'||value==='')return null;
    const own=diagnosticPath(value);
    if(own!==null){
      const held=named.get(value);if(held!==undefined)return held;
      let label=own;for(let index=2;taken.has(label);index++)label=`${own}#${index}`;
      taken.add(label);named.set(value,label);return label;
    }
    const held=references.get(value);if(held!==undefined)return held;
    const id=`resource-${references.size+1}`;references.set(value,id);return id;
  };
  const operation=(value:unknown,fallback:string):string=>{
    if(typeof value!=='string')return fallback;
    if(OPERATIONS.has(value)||/^worker:[0-9]{1,5}:messages-received$/u.test(value)
      ||/^(?:worker:[0-9]{1,5}:)?(?:atomic:completed|resource:completed|server:verified-input-bytes)$/u.test(value))return value;
    if(value.startsWith('game-stage:')&&STEPS.has(value.slice(11)))return value;
    if(NAMED_OPERATIONS.has(value)||/^(?:game-)?stage:/u.test(value)&&STEPS.has(value.replace(/^(?:game-)?stage:/u,'')))return value;
    if(/^(?:worker:[0-9]{1,5}:)?server:verified-input:[a-f0-9]{64}$/u.test(value))return value; // a content hash
    if(value.startsWith('wait:')){
      const label=value.slice(5),decode=/^(GLTF|Image) decode (https?:\/\/\S+)$/iu.exec(label);
      if(WAIT_LABELS.has(label)||/^Link [0-9]{1,4} shader programs$/u.test(label))return value;
      if(decode!==null)return `wait:${decode[1]?.toLowerCase()==='image'?'Image':'GLTF'} decode ${url(decode[2])??'resource'}`;
    }
    const part=/^((?:worker:[0-9]{1,5}:)?(?:download:|server:fetch-headers:|server:read-body:|server:verified-input:))(.+)$/u.exec(value);
    return part===null?fallback:`${part[1]??''}${url(part[2])??'resource'}`;
  };
  const input=(value:unknown):Readonly<Record<string,unknown>>=>{
    const row=record(value);return {...numbers(row,['eventTimeStamp','handlerEntry','timeOrigin']),
      event:oneOf(row['event'],['pointerup','click','keydown','other'] as const,'other')};
  };
  const detail=(value:unknown):Readonly<Record<string,unknown>>=>{
    const sourceDetail=record(value),out:Record<string,unknown>=numbers(value,DETAIL_NUMBERS);
    const reference=url(sourceDetail['url']);if(reference!==null)out['resource']=reference;
    if(Array.isArray(sourceDetail['phases']))out['phases']=list(sourceDetail['phases']).map((phase,index)=>{
      const row=record(phase);return {operation:operation(row['operation'],`phase-${index+1}`),
        start:number(row['start']),end:number(row['end']),result:oneOf(row['result'],RESULTS,'other')};
    });
    return out;
  };
  const entries=list(source['entries']).map((value,index)=>{const row=record(value);return {
    id:number(row['id']),build:diagnosticBuild(row['build']),realm:realm(row['realm']),operation:operation(row['operation'],`operation-${index+1}`),
    start:number(row['start']),end:number(row['end']),result:oneOf(row['result'],RESULTS,'other'),detail:detail(row['detail']),
  };});
  const resources=list(source['resources']).map((value,index)=>{const row=record(value);return Object.assign(numbers(row,RESOURCE_NUMBERS),{
    id:index+1,url:url(row['url']),realm:realm(row['realm']),
    initiator:oneOf(row['initiator'],['fetch','xmlhttprequest','script','css','link','img','image','other'] as const,'other'),
  });});
  // LS4: every counter survives, whatever two names its export may share (a wait label folds case, say)
  const counters:Record<string,unknown>={};
  for(const [index,[key,value]] of Object.entries(record(source['counters'])).entries()){
    const row=record(value),name=operation(key,`counter-${index+1}`);
    let label=name;for(let next=2;Object.hasOwn(counters,label);next++)label=`${name}#${next}`;
    counters[label]=Object.assign(numbers(row,['loaded','total','at','events']),{unit:oneOf(row['unit'],UNITS,'other')});
  }
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
  return {version:1,exportPrivacy:DIAGNOSTIC_PRIVACY,summary:diagnosticSummary(entries.map(row=>({realm:row.realm,operation:row.operation,start:row.start,end:row.end})),resources),build:diagnosticBuild(source['build']),attemptCount:number(source['attemptCount']),
    timeOrigin:number(source['timeOrigin']),entries,resources,counters,realms,navigation:numbers(source['navigation'],RESOURCE_NUMBERS),
    lifecycle,paints:list(source['paints']).map(value=>{const row=record(value);return {name:oneOf(row['name'],['first-paint','first-contentful-paint','unavailable','other'] as const,'other'),start:number(row['start'])};}),
    overflow:Object.values(record(source['overflow'])).map(value=>typeof value==='boolean'?value:number(value)),
    largestGap:{...numbers(gap,['before','after','ms']),visibility:oneOf(gap['visibility'],['visible','hidden','prerender','other'] as const,'other')},
    active:list(source['active']).map((value,index)=>{const row=record(value);return Object.assign(numbers(row,['id','ageMs']),{realm:realm(row['realm']),operation:operation(row['operation'],`active-${index+1}`)});}),
    serviceWorker:{controller:url(worker['controller'])},lastInput:input(source['lastInput']),
    handoff:{...numbers(handoff,['timeOrigin',...DETAIL_NUMBERS]),input:input(handoff['input'])},
  };
}
