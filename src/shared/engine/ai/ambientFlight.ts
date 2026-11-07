/** Circling/heading law for ambient flyers. The caller owns the clock, body and wing posing. */
export interface AmbientFlightPose {x:number;y:number;z:number;yaw:number;pitch:number;roll:number}
export interface AmbientOrbit {ox:number;oz:number;orad:number;oalt:number;ow:number;oph:number}
export interface AmbientFlightTuning {wave:number;amplitude:number;pitch:number;pitchRate:number;bank:number;bankLimit:number;bankRate:number;directionEpsilon?:number}
/** Harmonic wheel offsets around a caller's actual flock centre. */
export interface AmbientWheelTuning {xAmplitude:number;xFrequency:number;zScale:number;zAmplitude:number;zFrequency:number;altitudeFrequency:number;altitudeAmplitude:number;detailFrequency:number;detailAmplitude:number}
export interface AmbientWheelOrbit {cx:number;cz:number;r:number;alt:number;w:number;p1:number;p2:number;p3:number;p4:number}
export interface AmbientWheelBody {phase:number;scale:number;altOff:number}
/** Burst/glide response; phase factors preserve the authored multiplication order. */
export interface AmbientBurstTuning {phase:readonly number[];amplitude:number;foldPhase:number;foldAmplitude:number;rest:readonly [number,number];rates:readonly [number,number];glide:readonly [number,number];beats:readonly [number,number]}
export interface AmbientBurstState {flapT:number;burst:number;glide:number}
export interface AmbientBurstRandom {range:(min:number,max:number)=>number;int:(min:number,max:number)=>number}
export class CirclingFlyer {
  private readonly tuning:AmbientFlightTuning;
  private readonly wheelTuning:AmbientWheelTuning|undefined;
  private readonly bursts:Readonly<Record<string,AmbientBurstTuning>>;
  private readonly burstPose:[number,number]=[0,0];
  constructor(tuning:AmbientFlightTuning,wheel?:AmbientWheelTuning,bursts:Readonly<Record<string,AmbientBurstTuning>>={}) {
    this.tuning=tuning;this.wheelTuning=wheel;this.bursts=bursts;
    if(Object.keys(bursts).length>16)throw new Error('Too many ambient wingbeat rows');
    for(const row of Object.values(bursts)){
      if(row.phase.length<2||row.phase.length>3||[...row.phase,row.amplitude,row.foldPhase,row.foldAmplitude,...row.rest,...row.rates,...row.glide,...row.beats].some(value=>!Number.isFinite(value)||Math.abs(value)>1000)||row.phase.some(value=>value<=0)||row.rates.some(value=>value<=0)||row.glide[0]<0||row.glide[0]>row.glide[1]||row.beats.some(value=>!Number.isInteger(value)||value<1||value>64)||row.beats[0]>row.beats[1])throw new Error('Invalid ambient wingbeat tuning');
    }
    if([tuning.wave,tuning.amplitude,tuning.pitch,tuning.pitchRate,tuning.bank,tuning.bankLimit,tuning.bankRate,tuning.directionEpsilon??1e-5].some(value=>!Number.isFinite(value))||tuning.pitchRate<=0||tuning.bankRate<=0||tuning.bankLimit<=0||(tuning.directionEpsilon!==undefined&&tuning.directionEpsilon<=0))throw new Error('Invalid ambient flight tuning');
    if(wheel!==undefined&&[wheel.xAmplitude,wheel.xFrequency,wheel.zScale,wheel.zAmplitude,wheel.zFrequency,wheel.altitudeFrequency,wheel.altitudeAmplitude,wheel.detailFrequency,wheel.detailAmplitude].some(value=>!Number.isFinite(value)||Math.abs(value)>100000))throw new Error('Invalid ambient wheel tuning');
  }
  /** Mutate the caller's wing clock; the returned pose is borrowed until the next call. Fixed ranges draw no RNG. */
  burst(state:AmbientBurstState,dt:number,initialFlap:number,initialFold:number,id:string|number,rng:AmbientBurstRandom,gliding=true):readonly [number,number] {
    let flap=initialFlap,fold=initialFold;
    const row=Object.hasOwn(this.bursts,id)?this.bursts[id]:undefined;if(row===undefined)throw new Error('Missing declared ambient wingbeat');
    if(state.burst>0){
      let phase=dt;for(const factor of row.phase)phase*=factor;state.flapT+=phase;
      flap=Math.sin(state.flapT)*row.amplitude;fold=Math.max(0,-Math.sin(state.flapT-row.foldPhase))*row.foldAmplitude;
      if(state.flapT>=Math.PI*2){state.flapT-=Math.PI*2;state.burst--;if(state.burst===0)state.glide=gliding?(row.glide[0]===row.glide[1]?row.glide[0]:rng.range(...row.glide)):0;}
    }else{
      flap+=(row.rest[0]-flap)*Math.min(1,dt*row.rates[0]);fold+=(row.rest[1]-fold)*Math.min(1,dt*row.rates[1]);state.glide-=dt;
      if(state.glide<=0){state.burst=row.beats[0]===row.beats[1]?row.beats[0]:rng.int(...row.beats);state.flapT=0;}
    }
    this.burstPose[0]=flap;this.burstPose[1]=fold;return this.burstPose;
  }
  face(p:AmbientFlightPose,dx:number,dy:number,dz:number,dt:number,bank: number=this.tuning.bank):void {
    const dh=Math.hypot(dx,dz);if(dh<(this.tuning.directionEpsilon??1e-5))return;
    const turn=Math.atan2(dx,dz)-p.yaw,dyaw=Math.atan2(Math.sin(turn),Math.cos(turn));p.yaw+=dyaw;
    p.pitch+=(Math.atan2(dy,dh)*this.tuning.pitch-p.pitch)*Math.min(1,dt*this.tuning.pitchRate);
    const turnBank=Math.max(-this.tuning.bankLimit,Math.min(this.tuning.bankLimit,dyaw/Math.max(dt,1e-3)*bank));
    p.roll+=(turnBank-p.roll)*Math.min(1,dt*this.tuning.bankRate);
  }
  step(p:AmbientFlightPose,o:AmbientOrbit,dt:number):void {
    o.oph+=o.ow*dt;const x=o.ox+Math.cos(o.oph)*o.orad,z=o.oz+Math.sin(o.oph)*o.orad,y=o.oalt+Math.sin(o.oph*this.tuning.wave)*this.tuning.amplitude;
    this.face(p,x-p.x,y-p.y,z-p.z,dt);p.x=x;p.y=y;p.z=z;
  }
  /** Sample a moving wheel into a borrowed target, also used by takeoff/landing approaches. */
  wheel(o:AmbientWheelOrbit,b:AmbientWheelBody,time:number,out:{x:number;y:number;z:number}):void {
    const tuning=this.wheelTuning;if(tuning===undefined)throw new Error('Missing declared ambient wheel');
    const phase=o.w*time+b.phase,radius=o.r*b.scale;
    out.x=o.cx+radius*(Math.sin(phase+o.p1)+tuning.xAmplitude*Math.sin(tuning.xFrequency*phase+o.p2));
    out.z=o.cz+radius*tuning.zScale*(Math.cos(phase+o.p1)+tuning.zAmplitude*Math.cos(tuning.zFrequency*phase+o.p3));
    out.y=o.alt+b.altOff+tuning.altitudeAmplitude*Math.sin(tuning.altitudeFrequency*phase+o.p4)+tuning.detailAmplitude*Math.sin(tuning.detailFrequency*phase+b.phase);
  }
}
