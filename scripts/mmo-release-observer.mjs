#!/usr/bin/env node
// node --experimental-transform-types --import ./scripts/bake-loader.mjs scripts/mmo-release-observer.mjs staging --seconds 180 --work-dir tmp/<lane>/observer
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {observationInputs,ObservationRefusedError} from './mmo-release-observer-inputs.mjs';
import {prepareObserverClient} from './mmo-observer-client.mjs';
import {observeRelease} from '../test/fixtures/dedicated/releaseObserver.ts';

const ROOT=resolve(import.meta.dirname,'..');
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
 if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0||file.uid!==process.getuid?.())
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
 const id=randomUUID(),work=join(realBase,id),owner=process.env.CODEX_THREAD_ID??process.env.WS_LANE_NAME??`observer-${process.pid}`;
 mkdirSync(work,{mode:0o700});
 writeFileSync(join(work,'.owner'),`${JSON.stringify({session:owner,lane:process.env.WS_LANE_NAME??'mmo-release-observer',purpose:'Bounded signed staging observation',started:new Date().toISOString()})}\n`,{flag:'wx'});
 const publicKey=/^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(readFileSync(join(root,'scripts/vps/setup.sh'),'utf8'))?.[1];
 if(publicKey===undefined)throw new Error('No pinned release public key');
 const inputs=observationInputs({publicKey}),cancel=new AbortController();
 const stop=()=>{cancel.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const report=await observeRelease({read:signal=>inputs.read(signal),
   prepare:async(snapshot,signal)=>{try{return await prepareObserverClient(snapshot,signal,{root,work});}
    catch(error){if(signal.aborted)throw signal.reason;throw new ObservationRefusedError('client-prepare',error);}},
   devices:observerIdentities(realBase),
   labels:[`E7-${id.slice(0,6)}-0`,`E7-${id.slice(0,6)}-1`],durationMs:seconds*1000,signal:cancel.signal,
   event:phase=>{console.log(JSON.stringify({at:'release-observer',phase}));}});
  writeFileSync(join(work,'report.json'),`${JSON.stringify(report,null,2)}\n`,{mode:0o600});
  console.log(JSON.stringify({status:report.status,reason:report.reason,from:report.from,to:report.to,continuity:report.continuity,report:join(work,'report.json')}));
  return report.status==='observed'?0:report.status==='refused'||report.status==='failed'?1:report.status==='cancelled'?130:75;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 process.exitCode=await runObserver(process.argv.slice(2));
