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
 let closedAt:number|null=null;
 const off=bot.transport.onClose(()=>{closedAt=performance.now();});
 return {
  read:()=>{
   const frame=bot.client.latest,owner=frame===null?null:bot.client.owner(frame);
   return {tick:frame?.tick??null,stand:owner===null?null:{x:Number(owner['px']),z:Number(owner['pz'])},
    coins:frame===null?null:bot.coins(OWNED_ROW.coins),closed:bot.closed,closedAt};
  },
  move:()=>{bot.thumb=tick=>({viewTick:0,steer:{keyX:0,keyY:1,stickX:0,stickY:0},yaw:tick/90,pitch:0,buttons:0});},
  close:()=>{off();bot.drop();},
 };
}
