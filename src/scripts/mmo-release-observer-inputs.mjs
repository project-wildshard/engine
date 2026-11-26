// E7.2c.b.1: verified, bounded observation inputs. No socket or service mutation.
import { agentFetch as fetch } from './agent-requests.mjs';
import {createHash} from 'node:crypto';
import {readReleaseFile} from '../server/host/dedicated/releaseFile.ts';
import {botTarget,STAGING_SOCKET} from '../../test/fixtures/dedicated/mmoBotsGuard.ts';

const RELEASE='https://packs.wildshard.io/releases/staging.json';
const HEALTH='https://wildshard.tailb41b20.ts.net:8443/health';
const BUNDLES='https://github.com/project-wildshard/engine/releases/download';
const BUILD=/^[0-9a-f]{40}$/u,SEGMENT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/u;
/** @param {URL} url */
const loopback=url=>url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
/** @param {unknown} value @returns {value is number} */
const whole=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

/** Invalid authenticated inputs are fatal; ordinary network outages remain retryable. */
export class ObservationRefusedError extends Error{
 /** @param {string} code @param {unknown} [cause] */
 constructor(code,cause){super(`Observation refused: ${code}`,{cause});this.name='ObservationRefusedError';this.code=code;}
}

/** One response must fit the budget even when Content-Length is absent or false.
 * @param {string|URL} url @param {number} maximum @param {AbortSignal} signal @param {boolean} [artifact] */
async function bounded(url,maximum,signal,artifact=false){
 const response=await fetch(url,{cache:'no-store',signal,redirect:artifact?'follow':'error'});
 if(!response.ok){await response.body?.cancel();throw new Error(`Observation input refused HTTP ${response.status}`);}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/u.test(length)||!whole(Number(length))||Number(length)>maximum)){
  await response.body?.cancel();throw new ObservationRefusedError('input-bytes');
 }
 if(response.body===null)throw new ObservationRefusedError('empty-input');
 const reader=response.body.getReader();
 /** @type {Uint8Array[]} */const chunks=[];
 let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>maximum){await reader.cancel();throw new ObservationRefusedError('input-bytes');}
   chunks.push(value);
  }
 }catch(error){await reader.cancel().catch(()=>{/* The original read failure takes precedence. */});throw error;}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}

/**
 * The CLI uses the fixed staging addresses. Loopback overrides are for signed local controls only.
 * @param {{publicKey:string,releaseUrl?:string,healthUrl?:string,bundleOrigin?:string,
 * timeoutMs?:number,maxArtifactBytes?:number,signal?:AbortSignal}} options
 */
export function observationInputs(options){
 const releaseUrl=new URL(options.releaseUrl??RELEASE),healthUrl=new URL(options.healthUrl??HEALTH);
 const bundleOrigin=new URL(options.bundleOrigin??BUNDLES);
 const local=loopback(releaseUrl);
 if(local){
  if(!loopback(healthUrl)||healthUrl.origin!==releaseUrl.origin||!loopback(bundleOrigin)||bundleOrigin.origin!==releaseUrl.origin)
   throw new Error('Local observation inputs must share their loopback origin');
 }else if(releaseUrl.href!==RELEASE||healthUrl.href!==HEALTH||bundleOrigin.href!==BUNDLES)
  throw new Error('Observation inputs are staging only');
 for(const url of [releaseUrl,healthUrl,bundleOrigin])if(url.username!==''||url.password!==''||url.hash!==''||url.search!=='')
  throw new Error('Observation input has unexpected URL credentials or parameters');
 const timeoutMs=options.timeoutMs??30000,maxArtifactBytes=options.maxArtifactBytes??134217728;
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>120000||!Number.isSafeInteger(maxArtifactBytes)||maxArtifactBytes<1||maxArtifactBytes>134217728)
  throw new Error('Invalid observation input bounds');
 /** @type {Set<string>} */const verified=new Set();
 return {
  /** Verify signature, destination, artifact and health before any native hello.
   * @param {AbortSignal} [signal] @param {readonly number[]} [liveGenerations] */
  async read(signal,liveGenerations=[]){
   if(liveGenerations.length>2||liveGenerations.some(serial=>!whole(serial)))throw new Error('Invalid observer live generations');
   const signals=[AbortSignal.timeout(timeoutMs)];
   if(options.signal!==undefined)signals.push(options.signal);
   if(signal!==undefined)signals.push(signal);
   const deadline=AbortSignal.any(signals);
   const text=(await bounded(releaseUrl,262144,deadline)).toString('utf8');
   /** @type {import('../shared/host/releaseRows').ReleaseFile} */let release;
   try{release=readReleaseFile(text,options.publicKey);}catch(error){throw new ObservationRefusedError('signed-release',error);}
   if(release.channel!=='staging'||!BUILD.test(release.engineBuild)||!whole(release.serial)||!whole(release.saveEpoch)||release.saveEpoch<1||release.bundle===undefined||release.socket===undefined)
    throw new ObservationRefusedError('release-metadata');
   let target;
   try{target=botTarget(release.socket,'own',2);}catch(error){throw new ObservationRefusedError('socket-target',error);}
   if(local!==target.loopback||(!local&&target.url.origin!==STAGING_SOCKET)||
    (local&&(target.url.hostname!==releaseUrl.hostname||target.url.pathname!=='/'||target.url.search!==''||target.url.hash!=='')))
    throw new ObservationRefusedError('socket-target');
   const pieces=release.bundle.name.split('/');
   if(pieces.length!==2||pieces.some(piece=>!SEGMENT.test(piece)))throw new ObservationRefusedError('bundle-path');
   const key=JSON.stringify([release.engineBuild,release.bundle.name,release.bundle.sha256]);
   if(!verified.has(key)){
    const bytes=await bounded(`${bundleOrigin.href.replace(/\/$/u,'')}/${release.bundle.name}`,maxArtifactBytes,deadline,true);
    if(createHash('sha256').update(bytes).digest('hex')!==release.bundle.sha256)throw new ObservationRefusedError('bundle-hash');
    if(verified.size===8){const oldest=verified.values().next().value;if(oldest!==undefined)verified.delete(oldest);}
    verified.add(key);
   }
   const healthText=(await bounded(healthUrl,65536,deadline)).toString('utf8');
   /** @type {Record<string,unknown>} */let health;
   try{health=JSON.parse(healthText);}catch(error){throw new ObservationRefusedError('health-metadata',error);}
   if(typeof health!=='object'||health===null||typeof health.build!=='string'||!BUILD.test(health.build)||!whole(health.serial)||!whole(health.players)||!whole(health.cells)||!whole(health.workers))
    throw new ObservationRefusedError('health-metadata');
   const joining=2-liveGenerations.filter(serial=>serial===release.serial).length;
   const reason=health.build!==release.engineBuild?'health-build':health.serial!==release.serial?'health-serial':
    health.cells===0||health.workers===0?'health-starting':health.players+joining+4>16?'seats':null;
   return {release,health:{build:health.build,serial:health.serial,players:health.players,cells:health.cells,workers:health.workers},ready:reason===null,reason,verifiedBundle:true};
  },
 };
}
