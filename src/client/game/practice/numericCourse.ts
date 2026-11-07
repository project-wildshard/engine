import type { PlaygroundHost } from '@wildshard/engine/practice/playground/Playground';
import { ProjectedState, type ReturnProgram } from '../../../shared/game/population/returnProgram';

/** Shared numeric presenter for real mounted and grapple rooms. AS retains the
 * course law; native owners lend their player, origin and finite observations. */
export class NumericCourse {
  private readonly law;
  private pending = 0;
  constructor(private readonly host: PlaygroundHost, private readonly origin: { x:number;y:number;z:number },
    private readonly rows: { frame?:Readonly<Record<string,number>>; sampleEpsilon:number }, program:ReturnProgram, private readonly now:()=>number) {
    this.law=new ProjectedState({initial:{lap:0,started:0,running:0,half:0,best:-1,last:-1,prevX:0,phase:0,elapsed:0,checkpoint:0,visited:0}},
      program);
  }
  get state(): typeof this.law.state { return this.law.state; }
  get best(): number|null { return this.state.best<0?null:this.state.best; }
  time(now:number):number { return this.state.running?now-this.state.started:this.state.elapsed; }
  private project(signal:string,values:Readonly<Record<string,number>>):Readonly<Record<string,number>> {
    const player=this.host.player,p=player.position,o=this.origin;
    return this.law.event(signal,{...this.rows.frame,now:values['now']??this.now(),x:p.x-o.x,y:p.y-o.y,z:p.z-o.z,grounded:Number(player.onGround),mounted:0,...values});
  }
  reset():void { this.pending=0;this.law.reset({...this.state});this.place(this.project('restart',{})); }
  step(delta:number,values:Readonly<Record<string,number>>={}):Readonly<Record<string,number>> {
    // Capture time before the cadence check, as both original presenters did.
    const now=values['now']??this.now();this.pending+=delta;
    if(this.pending+this.rows.sampleEpsilon<.1)return {};
    this.pending=0;return this.project('step',{...values,now});
  }
  place(out:Readonly<Record<string,number>>):void {
    if(out['spawnX']===undefined)return;
    const value=(key:string):number=>{const n=out[key];if(n===undefined)throw new Error('Missing practice spawn channel');return n;};
    const o=this.origin,p=this.host.player;p.spawn(o.x+value('spawnX'),o.z+value('spawnZ'),value('spawnYaw'),o.y+value('spawnY'));
    // Only checkpoint fall/reset rows request the original explicit velocity clear.
    if(out['fell']!==undefined)p.velocity.set(0,0,0);p.pitch=value('spawnPitch');
  }
}
