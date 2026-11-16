import type {DurableCheckpoint} from '../../../src/server/host/dedicated/checkpointWitness';
import {RoomBot} from './roomBot';
import {botTarget} from './mmoBotsGuard';
import {OWNED_ROW} from '../../../src/shared/game/loot/ownedRows';
import type {NativeObserverBot} from './releaseObserver';

declare const __BUILD_ID__:string;
/** build-server stamps the exact archived release source; callers cannot relabel the client. */
export const sourceBuild=__BUILD_ID__;

/** Native server rows, never a page predictor or an optimistic save acknowledgement. */
export function connect(socket:string,device:string,name:string):NativeObserverBot{
 botTarget(socket,'own',2);
 const bot=new RoomBot(socket,sourceBuild,device,name);
 let closedAt:number|null=null,checkpoint:DurableCheckpoint|null=null;
 const control=bot.transport.onControl((kind,bytes)=>{if(kind==='world')checkpoint=checkpointFrom(bytes)??checkpoint;});
 const off=bot.transport.onClose(()=>{closedAt=performance.now();});
 return {
  read:()=>{
   const frame=bot.client.latest,owner=frame===null?null:bot.client.owner(frame);
   return {tick:frame?.tick??null,stand:owner===null?null:{x:Number(owner['px']),z:Number(owner['pz'])},
    coins:frame===null?null:bot.coins(OWNED_ROW.coins),checkpoint,closed:bot.closed,closedAt};
  },
  move:()=>{bot.thumb=tick=>({viewTick:0,steer:{keyX:0,keyY:1,stickX:0,stickY:0},yaw:tick/90,pitch:0,buttons:0});},
  close:()=>{control();off();bot.drop();},
 };
}

/** Self-contained so the same entry can compile against an older archived release. */
function checkpointFrom(bytes:ArrayBuffer):DurableCheckpoint|null{
 if(bytes.byteLength>65536)return null;
 try{
  const word=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
  if(typeof word!=='object'||word===null||typeof word['status']!=='object'||word['status']===null)return null;
  const status=word['status'] as Record<string,unknown>;
  if(status['v']!==1||new TextEncoder().encode(JSON.stringify(status)).byteLength>512)return null;
  const checkpoint=status['checkpoint'];
  if(typeof checkpoint!=='object'||checkpoint===null)return null;
  const row=checkpoint as Record<string,unknown>,at=row['at'];
  if(typeof row['seq']!=='number'||!Number.isSafeInteger(row['seq'])||row['seq']<1||
   typeof row['shard']!=='string'||!/^_?[a-z0-9][a-z0-9-]{0,94}$/u.test(row['shard'])||
   typeof row['ledgerSerial']!=='number'||!Number.isSafeInteger(row['ledgerSerial'])||row['ledgerSerial']<0||
   typeof row['progressHash']!=='string'||!/^[a-f0-9]{64}$/u.test(row['progressHash'])||typeof at!=='object'||at===null)return null;
  const stand=at as Record<string,unknown>;
  if(!['x','y','z'].every(key=>typeof stand[key]==='number'&&Number.isFinite(stand[key])))return null;
  return {seq:row['seq'],shard:row['shard'],ledgerSerial:row['ledgerSerial'],progressHash:row['progressHash'],
   at:{x:Number(stand['x']),y:Number(stand['y']),z:Number(stand['z'])}};
 }catch{return null;}
}
