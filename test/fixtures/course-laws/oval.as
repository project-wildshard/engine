import { Signal, Field, Channel, Read, Do, Params } from './generated/nalatiKokpar';
@inline function get(field:i32):f64 {return Read.field(0,field);}
/** The elevated practice oval shares the admitted quest module. */
export function courseSignal(signal:i32):bool {
  if(signal!=Signal.courseReset&&signal!=Signal.courseStep)return false;
  const x=get(Field.courseX),z=get(Field.courseZ),now=get(Field.courseTime);
  let lap=get(Field.lap),started=get(Field.started),running=get(Field.running),half=get(Field.half);
  let best=get(Field.best),last=get(Field.last),previous=get(Field.prevX),event=0.0;
  if(signal==Signal.courseReset){lap=0;started=0;running=0;half=0;last=-1;}
  else {
    if(Math.abs(z-Params.courseRadius)<Params.courseWidth/2+2&&previous<Params.courseLine&&x>=Params.courseLine&&get(Field.courseMounted)!=0){
      if(running!=0&&half!=0){last=now-started;best=best<0?last:Math.min(best,last);event=1;}
      running=1;half=0;lap++;started=now;
    }
    if(Math.abs(z+Params.courseRadius)<Params.courseWidth/2+2&&previous>Params.courseLine&&x<=Params.courseLine&&running!=0&&half==0){half=1;event=2;}
  }
  Do.channel(Channel.lap,lap);Do.channel(Channel.started,started);Do.channel(Channel.running,running);Do.channel(Channel.half,half);
  Do.channel(Channel.best,best);Do.channel(Channel.last,last);Do.channel(Channel.prevX,x);
  Do.channel(Channel.courseEvent,event);Do.channel(Channel.courseFell,get(Field.courseY)<-12?1:0);
  return true;
}
