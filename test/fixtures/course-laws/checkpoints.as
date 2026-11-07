import { Signal, Field, Channel, Read, Do } from './generated/ninePractice';
@inline function f(id:i32):f64 { return Read.field(0,id); }
// The ten sorted numeric pad fields are contiguous in the admitted alias table.
@inline function p(index:i32,field:i32):f64 { return f(Field.pad00Depth+index*10+field); }
const DEPTH:i32=0,ELIGIBLE:i32=1,PITCH:i32=2,START_PITCH:i32=3,START_YAW:i32=4,TOP:i32=5,WIDTH:i32=6,X:i32=7,YAW:i32=8,Z:i32=9;
function place(index:i32,atStart:bool):void {
  const x=p(index,X),z=p(index,Z)+(atStart?p(index,DEPTH)/2-3:0);
  const yaw=p(index,atStart?START_YAW:YAW),pitch=p(index,atStart?START_PITCH:PITCH);
  Do.channel(Channel.spawnX,x);Do.channel(Channel.spawnZ,z);Do.channel(Channel.spawnY,p(index,TOP));
  Do.channel(Channel.spawnYaw,yaw);Do.channel(Channel.spawnPitch,pitch);
}
@inline function onPad(i:i32,x:f64,y:f64,z:f64):bool {
  return Math.abs(x-p(i,X))<=p(i,WIDTH)/2&&Math.abs(z-p(i,Z))<=p(i,DEPTH)/2&&Math.abs(y-p(i,TOP))<0.35;
}
// Two ordered probes per bounded iteration keep all eleven pads inside the original fuel allowance.
function currentPad(count:i32,x:f64,y:f64,z:f64):i32 {
  for(let i:i32=0;i<count;i+=2) {
    if(onPad(i,x,y,z))return i;
    if(i+1<count&&onPad(i+1,x,y,z))return i+1;
  }
  return -1;
}
/** Course rules run on requests sampled no faster than 10 Hz. Native player movement consumes only the numeric result. */
export function onSignal(signal:i32,value:f64,source:i32):void {
  let phase=f(Field.phase),started=f(Field.started),elapsed=f(Field.elapsed),best=f(Field.best),checkpoint=f(Field.checkpoint);
  let visited=i32(f(Field.visited));
  let finish:f64=0,visit:f64=-1;
  const count=i32(f(Field.padCount)),x=f(Field.x),y=f(Field.y),z=f(Field.z),start=i32(f(Field.startPad));
  const pad=signal==Signal.step&&f(Field.grounded)!=0?currentPad(count,x,y,z):-1;
  if(signal==Signal.reset) { phase=0;elapsed=0;checkpoint=start;visited=0;place(start,true); }
  else if(signal==Signal.step) {
    if(pad>=0) { checkpoint=pad;if(p(pad,ELIGIBLE)!=0){visit=pad;visited|=i32(p(pad,ELIGIBLE));} }
    if(phase==0&&z<p(start,Z)-p(start,DEPTH)/2&&x>p(start,X)-p(start,WIDTH)/2-1) {
      phase=1;started=f(Field.now);
    }
    if(phase==1) {
      elapsed=f(Field.now)-started;
      if(pad==i32(f(Field.finishPad))) { phase=2;best=best<0?elapsed:Math.min(best,elapsed);finish=1; }
    }
  } else return;
  const fell=signal==Signal.step&&y<f(Field.lowest)-f(Field.fallY);
  if(fell)place(i32(checkpoint),checkpoint==start);
  Do.channel(Channel.phase,phase);Do.channel(Channel.started,started);Do.channel(Channel.elapsed,elapsed);
  Do.channel(Channel.best,best);Do.channel(Channel.checkpoint,checkpoint);Do.channel(Channel.visit,visit);Do.channel(Channel.finish,finish);
  Do.channel(Channel.visited,visited);Do.channel(Channel.reached,i32.popcnt(visited));
  Do.channel(Channel.pad,pad);Do.channel(Channel.fell,fell?1:0);
}
