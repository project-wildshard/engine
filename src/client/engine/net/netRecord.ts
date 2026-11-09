import {Scope} from '../../../shared/engine/app/scope';
import {diagnosticNow} from '../../../shared/engine/core/clock';
import type {NetCorrection,NetRecord} from '../../../shared/engine/net/measurements';
import type {NetClient} from './client';
import type {LinkState} from './redial';

export interface NetRecordsOptions{readonly build:string;readonly install:string;readonly session:string;readonly level:string;readonly tag?:string;readonly send:(record:NetRecord)=>void;readonly correction?:(row:NetCorrection)=>void;readonly now?:()=>number}

/** Bounded five-minute observations. Counters are deltas, never cumulative duplicates. */
export class NetRecords{
 private readonly scope=new Scope('net.records');
 private readonly client:NetClient;
 private readonly options:NetRecordsOptions;
 private readonly now:()=>number;
 private started:number;
 private frames=0;private packets=0;private reconnects=0;private reconnectMs=0;private disconnected:number|null=null;private maxOffset=0;
 private rtts:number[]=[];private readonly corrections={foot:0,board:0,swim:0,ride:0};
 private live=false;private ended=false;
 constructor(client:NetClient,options:NetRecordsOptions){
  this.client=client;this.options=options;this.now=options.now??diagnosticNow;this.started=this.now();
  this.scope.onDispose(client.onFrame(()=>{this.packets++;if(!this.live){this.live=true;this.started=this.now();}}));
  this.scope.onDispose(client.onRender(()=>{this.frames++;}));
  this.scope.onDispose(client.onCorrection(row=>{this.corrections[row.mode]++;this.maxOffset=Math.max(this.maxOffset,row.offset);options.correction?.({...row,kind:'correction',session:options.session});}));
  this.scope.interval(1000,()=>{const rtt=client.stats.rttMs;if(this.live&&Number.isFinite(rtt)&&rtt>0){this.rtts.push(rtt);if(this.rtts.length>300)this.rtts.shift();}});
  this.scope.interval(300_000,()=>{this.flush();});
 }
 link(state:LinkState):void{
  if(this.ended)return;
  if(state==='ended'){this.dispose();return;}
  if(this.live&&state!=='live'&&this.disconnected===null)this.disconnected=this.now();
  if(state==='live'&&this.disconnected!==null){this.reconnects++;this.reconnectMs+=Math.max(0,this.now()-this.disconnected);this.disconnected=null;}
 }
 flush():void{
  if(this.ended||!this.live)return;
  const now=this.now(),seconds=Math.max(0,(now-this.started)/1000);if(seconds===0)return;
  const sorted=[...this.rtts].sort((a,b)=>a-b),latest=this.client.stats.rttMs,rttMs=sorted[Math.floor(sorted.length/2)]??(latest>0?latest:null),rttP95=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]??rttMs;
  const {build,install,session,level,tag,send}=this.options;
  send({kind:'net',build,install,session,level,...(tag===undefined?{}:{tag}),seconds,frames:this.frames,fps:this.frames/seconds,packets:this.packets,rttMs,rttP95,reconnects:this.reconnects,reconnectMs:this.reconnectMs,maxOffset:this.maxOffset,corrections:{...this.corrections}});
  this.started=now;this.frames=0;this.packets=0;this.reconnects=0;this.reconnectMs=0;this.maxOffset=0;this.rtts=[];
  for(const mode of ['foot','board','swim','ride'] as const)this.corrections[mode]=0;
 }
 dispose():void{if(this.ended)return;this.flush();this.ended=true;this.scope.dispose();}
}
