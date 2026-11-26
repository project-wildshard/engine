#!/usr/bin/env node
// node --import ./src/scripts/bake-loader.mjs src/scripts/mmo-release-observer.mjs staging --seconds 180 --work-dir tmp/<lane>/observer
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import NodeWebSocket from 'ws';
import {observationInputs,ObservationRefusedError} from './mmo-release-observer-inputs.mjs';
import {prepareObserverClient} from './mmo-observer-client.mjs';
import {observeRelease} from '../../test/fixtures/dedicated/releaseObserver.ts';
import {CHANNELS} from './page-release/flow.mjs';
import {agentHeaders} from './agent-marker.mjs';
import {openReleaseRun} from './release-run.mjs';

const ROOT=resolve(import.meta.dirname,'..', '..');
/** @param {string[]} args @param {string} [root] */
export function observerArguments(args,root=ROOT){
 const [mode,...rest]=args;
 if(mode!=='staging')throw new Error('usage: mmo-release-observer.mjs staging --seconds 180 --work-dir tmp/<lane>/observer');
 const {values}=parseArgs({args:rest,strict:true,options:{seconds:{type:'string',default:'180'},'work-dir':{type:'string'}}});
 const seconds=Number(values.seconds);
 if(!Number.isInteger(seconds)||seconds<5||seconds>3600||values['work-dir']===undefined)throw new Error('Observer needs --seconds 5..3600 and --work-dir');
 const base=resolve(root,values['work-dir']),tmp=resolve(root,'tmp');
 if(!base.startsWith(`${tmp}/`))throw new Error('Observer --work-dir stays below this checkout tmp/');
 return {seconds,base};
}
/** Private identities persist between bounded runs so a later run can read a real durable baseline.
 * @param {string} base @returns {[string,string]} */
export function observerIdentities(base){
 const path=join(base,'identities.json');
 if(!existsSync(path)){
  const devices=[`device:observer-${randomUUID()}`,`device:observer-${randomUUID()}`];
  writeFileSync(path,JSON.stringify(devices),{mode:0o600,flag:'wx'});
 }
 const file=lstatSync(path);
 if(!file.isFile()||file.isSymbolicLink()||file.size>512||(file.mode&0o077)!==0||file.uid!==process.getuid?.())
  throw new Error('Observer identity file must be an owned private regular file');
 const devices=JSON.parse(readFileSync(path,'utf8'));
 if(!Array.isArray(devices)||devices.length!==2||devices.some(value=>typeof value!=='string'||!/^device:observer-[a-f0-9-]{36}$/u.test(value))||devices[0]===devices[1])
  throw new Error('Observer identity file is invalid');
 return [devices[0],devices[1]];
}
/** @param {string[]} args @param {string} [root] */
export async function runObserver(args,root=ROOT){
 const {seconds,base}=observerArguments(args,root);
 mkdirSync(join(root,'tmp'),{recursive:true});
 const tmp=realpathSync(join(root,'tmp'));
 if(!tmp.startsWith(`${realpathSync(root)}/`))throw new Error('Observer scratch resolves outside checkout');
 let ancestor=base;while(!existsSync(ancestor))ancestor=dirname(ancestor);
 const existing=realpathSync(ancestor);
 if(existing!==tmp&&!existing.startsWith(`${tmp}/`))throw new Error('Observer scratch resolves outside checkout tmp/');
 mkdirSync(base,{recursive:true});
 const realBase=realpathSync(base);
 if(!realBase.startsWith(`${tmp}/`))throw new Error('Observer scratch resolves outside checkout tmp/');
 const publicKey=/^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(readFileSync(join(root,'src/scripts/vps/setup.sh'),'utf8'))?.[1];
 if(publicKey===undefined)throw new Error('No pinned release public key');
 const inputs=observationInputs({publicKey}),cancel=new AbortController();
 const id=randomUUID(),scratch=openReleaseRun(root,'observer');
 const work=scratch.work,reportPath=join(realBase,`report-${id}.json`);
 const stop=()=>{cancel.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const report=await observeRelease({read:(signal,liveGenerations)=>inputs.read(signal,liveGenerations),
   prepare:async(snapshot,signal)=>{try{
    const clientWork=join(work,`native-${snapshot.release.engineBuild}`);
    mkdirSync(clientWork,{mode:0o700});
    return await prepareObserverClient(snapshot,signal,{root,work:clientWork});
   }
    catch(error){if(signal.aborted)throw signal.reason;throw new ObservationRefusedError('client-prepare',error);}},
   devices:observerIdentities(realBase),
   labels:[`E7-${id.slice(0,6)}-0`,`E7-${id.slice(0,6)}-1`],durationMs:seconds*1000,signal:cancel.signal,requireDurableBaseline:true,reloadClient:true,
   retryMs:60_000,
   event:phase=>{console.log(JSON.stringify({at:'release-observer',phase}));}});
  writeFileSync(reportPath,`${JSON.stringify(report,null,2)}\n`,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:report.status,reason:report.reason,from:report.from,to:report.to,continuity:report.continuity,report:reportPath}));
  return report.status==='observed'?0:report.status==='refused'||report.status==='failed'?1:report.status==='cancelled'?130:75;
 }finally{
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  scratch.close();
 }
}
// The staging door requires its page Origin. Node's global WebSocket does not supply it.
export class StagingSocket extends NodeWebSocket {
 /** @param {string} url @param {string[]} protocols */
 constructor(url,protocols){
  if(new URL(url).href!==new URL(CHANNELS.staging.socket).href)throw new Error('Observer socket must be the public staging door');
  super(url,protocols,{origin:CHANNELS.staging.origin,headers:agentHeaders()});
  // The browser-style close event drives recovery. ws emits a Node error first.
  this.on('error', () => undefined);
 }
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const native=globalThis.WebSocket;
 globalThis.WebSocket=/** @type {typeof native} */ (/** @type {unknown} */ (StagingSocket));
 try{process.exitCode=await runObserver(process.argv.slice(2));}finally{globalThis.WebSocket=native;}
}
