import {setTimeout as pause} from 'node:timers/promises';
import type {DurableCheckpoint} from '../../../src/server/host/dedicated/checkpointWitness';
import type {ReleaseFile} from '../../../src/shared/host/releaseRows';
import {ObservationRefusedError} from '../../../src/scripts/mmo-release-observer-inputs.mjs';

export interface Stand {readonly x:number;readonly z:number}
export interface NativeReading {
 readonly tick:number|null;readonly stand:Stand|null;readonly coins:number|null;
 readonly checkpoint?:DurableCheckpoint|null;
 readonly closed:string|null;readonly closedAt:number|null;
}
export interface NativeObserverBot {read:()=>NativeReading;move:()=>void;idle:()=>void;quit?:()=>void;close:()=>void}
export interface ObservationSnapshot {
 readonly release:ReleaseFile;readonly ready:boolean;readonly reason:string|null;
 readonly health:{readonly build:string;readonly serial:number;readonly players:number};
}
export interface PreparedObserver {
 readonly sourceBuild:string;
 readonly harness?:Readonly<Record<string,string>>;
 readonly connect:(socket:string,device:string,name:string)=>NativeObserverBot;
 readonly dispose?:()=>Promise<void>;
}
export interface ObserverOptions {
 readonly read:(signal:AbortSignal,liveGenerations?:readonly number[])=>Promise<ObservationSnapshot>;
 readonly prepare:(snapshot:ObservationSnapshot,signal:AbortSignal)=>Promise<PreparedObserver>;
 readonly devices:readonly [string,string];
 readonly labels?:readonly [string,string];
 readonly durationMs:number;readonly pollMs?:number;readonly signal?:AbortSignal;
 readonly retryMs?:number;
 readonly requireDurableBaseline?:boolean;
 readonly reloadClient?:boolean;
 readonly event?:(phase:string)=>void;
}
type Status='observed'|'failed'|'inconclusive'|'refused'|'cancelled';
interface Session {
 readonly label:string;readonly device:string;bot:NativeObserverBot;generation:number;attempts:number;
 nextDialAt:number;prime:'unused'|'waiting'|'done';
 first:NativeReading|null;latest:NativeReading|null;moved:boolean;
 before:NativeReading|null;closeAt:number|null;closeReason:string|null;backMs:number|null;
}
/** A stricter checkpoint comparison may be inconclusive after legitimate progress changes. */
function continuityOf(sessions:readonly Session[],targetSerial:number):{kind:'restored'|'lost'|'unknown';reason:string|null}{
 if(sessions.length!==2)return {kind:'unknown',reason:'missing-durable-witness'};
 let changed=false;
 for(const session of sessions){
  if(session.generation!==targetSerial||session.attempts<2||session.closeAt===null)return {kind:'unknown',reason:'redial-incomplete'};
  const before=session.before,after=session.latest,old=before?.checkpoint,next=after?.checkpoint;
  if(before===null||after===null||old===undefined||old===null||next===undefined||next===null)
   return {kind:'unknown',reason:'missing-durable-witness'};
  if(before.coins===null||after.coins===null)return {kind:'unknown',reason:'missing-native-coins'};
  if(next.shard!==old.shard)return {kind:'unknown',reason:'checkpoint-shard-changed'};
  if(next.seq<old.seq||next.ledgerSerial<old.ledgerSerial||
   (before.coins!==null&&after.coins!==null&&after.coins<before.coins)||
   (next.seq===old.seq&&next.progressHash!==old.progressHash))return {kind:'lost',reason:'checkpoint-progress-lost'};
  if(next.seq===old.seq)return {kind:'unknown',reason:'no-drain-checkpoint'};
  if(next.progressHash!==old.progressHash)changed=true;
 }
 return changed?{kind:'unknown',reason:'checkpoint-progress-changed'}:{kind:'restored',reason:null};
}
const mark=(release:ReleaseFile)=>({serial:release.serial,build:release.engineBuild});
const identity=(release:ReleaseFile):string=>JSON.stringify([release.serial,release.engineBuild,release.saveEpoch,release.socket,release.bundle,release.shards]);

/** Two stable native identities, one bounded observation, no release or service mutation. */
export async function observeRelease(options:ObserverOptions){
 const pollMs=options.pollMs??2000;
 const retryMs=options.retryMs??pollMs;
 if(!Number.isFinite(options.durationMs)||options.durationMs<100||options.durationMs>3600000||
  !Number.isInteger(pollMs)||pollMs<10||pollMs>60000||!Number.isInteger(retryMs)||retryMs<10||retryMs>60000||
  options.devices.length!==2||new Set(options.devices).size!==2||
  options.devices.some(device=>!/^[a-zA-Z0-9._:-]{1,128}$/u.test(device)))
  throw new Error('Invalid bounded observer options');
 if(options.labels!==undefined&&(options.labels.length!==2||new Set(options.labels).size!==2||
  options.labels.some(name=>!/^[A-Za-z0-9._ -]{1,24}$/u.test(name))))throw new Error('Invalid observer display names');
 const started=performance.now(),limit=new AbortController();
 const timeout=setTimeout(()=>{limit.abort();},options.durationMs);
 const signal=options.signal===undefined?limit.signal:AbortSignal.any([limit.signal,options.signal]);
 const sessions:Session[]=[],owned:NativeObserverBot[]=[],faults:string[]=[];
 let baseline:ObservationSnapshot|null=null,target:ObservationSnapshot|null=null,prepared:PreparedObserver|undefined,reloaded:PreparedObserver|undefined;
 const sample=(session:Session):void=>{
  const read=session.bot.read();session.latest=read;
  if(read.tick!==null&&read.stand!==null){
   session.first??=read;
   if(session.first.stand!==null&&session.first.tick!==read.tick&&Math.hypot(read.stand.x-session.first.stand.x,read.stand.z-session.first.stand.z)>.05)
    session.moved=true;
  }
  // A fresh bot may leave to write its first checkpoint before the baseline is armed.
  if(read.closed!==null&&session.before!==null&&session.generation===baseline?.release.serial){
   session.closeAt??=read.closedAt??performance.now();session.closeReason??=read.closed;
  }
  if(target!==null&&session.generation===target.release.serial&&session.moved&&session.backMs===null&&session.closeAt!==null)
   session.backMs=Math.max(0,Math.round(performance.now()-session.closeAt));
 };
 const outcome:{current:{status:Status;reason:string|null;continuity:'restored'|'lost'|'unknown'}|null}={current:null};
 function report(status:Status,reason:string|null,continuity:'restored'|'lost'|'unknown'='unknown'){
 const result={
  status,reason,from:baseline===null?null:mark(baseline.release),to:target===null?null:mark(target.release),
  clientBuild:prepared?.sourceBuild??null,clientHarness:prepared?.harness??null,elapsedMs:Math.round(performance.now()-started),
  ...(reloaded===undefined?{}:{reloadClientBuild:reloaded.sourceBuild,reloadClientHarness:reloaded.harness??null}),
  continuity,failedSaves:null,
  checkpointCoverage:['quest-book','owned-store','ledger','native-coins'] as const,
  saveCompletionTime:null,peerWorkers:{kind:'whole-release' as const,untouchedWorkerEvidence:null},
  bots:sessions.map(session=>({label:session.label,attempts:session.attempts,before:session.before,
   after:session.generation===target?.release.serial?session.latest:null,closeReason:session.closeReason,
   backToMovingObservedMs:session.backMs})),faults,
 };outcome.current=result;return result;
 }
 const read=async():Promise<ObservationSnapshot|null>=>{
  try{return await options.read(signal,sessions.filter(session=>session.latest?.tick!==undefined&&session.latest.tick!==null&&session.latest.closed===null).map(session=>session.generation));}
  catch(error){
   if(error instanceof ObservationRefusedError)throw error;
   if(!signal.aborted&&faults.length<16)faults.push('input-unavailable');
   return null;
  }
 };
 const connect=(session:Session,snapshot:ObservationSnapshot,client=prepared):void=>{
  const socket=snapshot.release.socket;if(socket===undefined||client===undefined)throw new Error('Verified native observer target missing');
  const bot=client.connect(socket,session.device,session.label);owned.push(bot);
  session.bot=bot;session.generation=snapshot.release.serial;session.attempts++;session.first=null;session.latest=null;session.moved=false;
  session.nextDialAt=performance.now()+retryMs;
  bot.move();
 };
 try{
  while(!signal.aborted){
   const snapshot=await read();
   if(snapshot?.ready){baseline=snapshot;break;}
   await pause(pollMs,undefined,{signal});
  }
  if(baseline===null)return report(options.signal?.aborted===true?'cancelled':'inconclusive',options.signal?.aborted===true?'cancelled':'no-baseline');
  prepared=await options.prepare(baseline,signal);
  if(prepared.sourceBuild!==baseline.release.engineBuild)throw new ObservationRefusedError('client-source-build');
  const confirmed=await read();
  if(confirmed===null||!confirmed.ready||identity(confirmed.release)!==identity(baseline.release))return report('inconclusive','baseline-moved-before-join');
  for(const [index,device] of options.devices.entries()){
   const socket=baseline.release.socket;if(socket===undefined)throw new ObservationRefusedError('socket-target');
   const label=options.labels?.[index]??`observer-${index}`;
   const bot=prepared.connect(socket,device,label);owned.push(bot);
   sessions.push({label,device,bot,generation:baseline.release.serial,attempts:1,first:null,latest:null,moved:false,
    nextDialAt:performance.now()+retryMs,prime:'unused',
    before:null,closeAt:null,closeReason:null,backMs:null});bot.move();
  }
  while(!signal.aborted){
   for(const session of sessions){
    sample(session);
    if(session.latest?.closed!==null&&session.latest?.closed!==undefined){
     const primed=session.prime==='waiting';
     if(!primed&&(session.first!==null||options.retryMs===undefined))return report('inconclusive','baseline-link-ended');
     if(!primed&&performance.now()<session.nextDialAt)continue;
     if(session.attempts>=5)return report('inconclusive','baseline-reconnect-budget');
     const current=await read();
     if(current===null||!current.ready||identity(current.release)!==identity(baseline.release))return report('inconclusive','baseline-moved-before-join');
     if(primed)session.prime='done';
     connect(session,current);
    }
    if(options.requireDurableBaseline===true&&session.moved&&session.prime!=='waiting'&&!session.latest?.checkpoint){
     if(session.prime!=='unused'||session.bot.quit===undefined)return report('inconclusive','missing-durable-baseline');
     session.prime='waiting';
     session.bot.quit();
    }
   }
   if(sessions.every(session=>session.moved&&(options.requireDurableBaseline!==true||session.latest?.checkpoint)))break;
   await pause(Math.min(pollMs,100),undefined,{signal});
  }
  if(signal.aborted)throw signal.reason;
 for(const session of sessions){
  session.before=session.latest;
  // Keep the checkpointed bot connected with neutral input during the release wait.
  session.bot.idle();
 }
  options.event?.('baseline-playing');
  while(!signal.aborted){
   for(const session of sessions){
    sample(session);
    if(session.generation===baseline.release.serial&&session.latest?.closed===null)session.before=session.latest;
   }
   const next=await read();
   if(next!==null){
    if(next.release.serial<baseline.release.serial||
     (next.release.serial===baseline.release.serial&&identity(next.release)!==identity(baseline.release)))
     throw new ObservationRefusedError('release-rollback-or-conflict');
    if(next.ready&&next.release.serial>baseline.release.serial){
     if(next.release.saveEpoch!==baseline.release.saveEpoch)throw new ObservationRefusedError('save-epoch-changed');
     if(target!==null&&identity(next.release)!==identity(target.release))return report('inconclusive','multiple-releases');
     if(target===null){target=next;options.event?.('new-release-serving');}
     for(const session of sessions){
      sample(session);
      if(session.latest?.closed!==null&&session.latest?.closed!==undefined){
       if(session.generation===target.release.serial&&performance.now()<session.nextDialAt)continue;
       if(options.reloadClient===true&&session.latest.closed==='reload'&&reloaded===undefined){
        reloaded=await options.prepare(target,signal);
        if(reloaded.sourceBuild!==target.release.engineBuild)throw new ObservationRefusedError('reload-client-source-build');
       }
       if(session.attempts>=5)return report('inconclusive','reconnect-budget');
       connect(session,target,reloaded??prepared);
      }
     }
    }
   }
   for(const session of sessions)sample(session);
   const targetSerial=target?.release.serial;
   if(targetSerial!==undefined&&sessions.every(session=>session.generation===targetSerial&&session.moved&&session.latest?.closed===null))
    {const proof=continuityOf(sessions,targetSerial);
     if(proof.reason!=='missing-durable-witness'&&proof.reason!=='missing-native-coins')
      return report(proof.kind==='restored'?'observed':proof.kind==='lost'?'failed':'inconclusive',proof.reason,proof.kind);
    }
   await pause(pollMs,undefined,{signal});
  }
  return report(options.signal?.aborted===true?'cancelled':'inconclusive',options.signal?.aborted===true?'cancelled':target===null?'no-release-change':'redial-incomplete');
 }catch(error){
  if(error instanceof ObservationRefusedError)return report('refused',error.code);
  if(signal.aborted)return report(options.signal?.aborted===true?'cancelled':'inconclusive',
   options.signal?.aborted===true?'cancelled':baseline===null?'no-baseline':target===null?'no-release-change':continuityOf(sessions,target.release.serial).reason??'redial-incomplete');
  throw error;
 }finally{
  clearTimeout(timeout);
  const errors:unknown[]=[];
  for(const bot of owned.reverse())try{bot.close();}catch(error){errors.push(error);}
  try{await reloaded?.dispose?.();}catch(error){errors.push(error);}
  try{await prepared?.dispose?.();}catch(error){errors.push(error);}
  if(errors.length>0){
   if(outcome.current!==null){outcome.current.status='failed';outcome.current.reason='cleanup-failed';outcome.current.continuity='unknown';faults.push('cleanup-failed');}
   else throw new AggregateError(errors,'Observer cleanup failed');
  }
 }
}
