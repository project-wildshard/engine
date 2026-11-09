// oxlint-disable-next-line import/no-nodejs-modules -- Operator-only JSONL stays on the server.
import {appendFile,mkdir} from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- The directory is operator-configured, never client input.
import {join} from 'node:path';
import type {NetCorrection,HitRewind} from '@wildshard/engine/net/measurements';

export interface PlaytestHit {readonly kind:'hit';readonly tick:number;readonly amount:number;readonly network:boolean;readonly rewind:HitRewind}
export type PlaytestRow=NetCorrection|PlaytestHit;
export interface PlaytestOptions{readonly directory:string;readonly build:string;readonly tag?:string;readonly log:(row:Record<string,unknown>)=>void}

/** No tick awaits disk. Overflow or disk failure is explicit, never a success receipt. */
export class PlaytestFile{
 private readonly pending:{file:string;line:string}[]=[];
 private flying:Promise<void>|undefined;
 private ended=false;private failed=0;private written=0;
 private readonly options:PlaytestOptions;
 constructor(options:PlaytestOptions){this.options=options;}
 append(row:PlaytestRow):void{
  if(this.ended)return;
  if(this.pending.length>=4096){this.failed++;if(this.failed===1)this.options.log({at:'playtest.failed',reason:'bounded backlog',dropped:this.failed});return;}
  const at=new Date().toISOString(),{build,tag,directory}=this.options;
  this.pending.push({file:join(directory,`playtest-${at.slice(0,10)}.jsonl`),line:`${JSON.stringify({at,build,...(tag===undefined?{}:{tag}),...row})}\n`});
  this.start();
 }
 private start():void{
  if(this.flying!==undefined)return;
  this.flying=this.write().finally(()=>{this.flying=undefined;if(this.pending.length>0)this.start();});
 }
 private async write():Promise<void>{
  let writing=0;
  try{
   await mkdir(this.options.directory,{recursive:true,mode:0o700});
   while(this.pending.length>0){
    const first=this.pending[0];if(first===undefined)break;
    let count=0;while(this.pending[count]?.file===first.file&&count<256)count++;
    const rows=this.pending.splice(0,count);writing=rows.length;await appendFile(first.file,rows.map(row=>row.line).join(''),{mode:0o600});this.written+=writing;writing=0;
   }
  }catch(error){this.failed+=this.pending.splice(0).length+writing;this.options.log({at:'playtest.failed',error:String(error),dropped:this.failed});}
 }
 async close():Promise<boolean>{this.ended=true;while(this.flying!==undefined)await this.flying;this.options.log({at:'playtest.closed',written:this.written,dropped:this.failed});return this.failed===0;}
}
