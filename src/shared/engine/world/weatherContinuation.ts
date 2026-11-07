import * as v from 'valibot';
import type { WeatherProgram } from '@wildshard/format/weatherProgram';
import { audioMixValue } from '../audio/audioProfiles';
import { Rng } from '../core/rng';
import { TickScheduler } from '../app/scheduler';
import { Weather, type WeatherNumbers, type WeatherProfile } from './weather';
import { clockGust, fieldGustAt } from './windField';

/** Required mechanical outputs plus any authored numeric channels. */
export type WeatherValues = WeatherNumbers & Record<string,number>;
const finite = v.pipe(v.number(),v.finite());
const GustSaved: v.GenericSchema<BoundedGustSaveInput, BoundedGustSave> = v.strictObject({version:v.literal(1),time:v.pipe(finite,v.minValue(0)),gust:v.pipe(finite,v.minValue(0),v.maxValue(1))});
const Saved = v.strictObject({version:v.literal(1),weather:v.unknown(),wind:v.unknown(),cadence:v.pipe(v.string(),v.maxLength(16384)),boost:v.pipe(finite,v.minValue(0),v.maxValue(1))});
const Time = v.object({time:finite});

/** A numeric publication, retaining identity across silent checkpoint restore. */
export class GustContinuation {
  private readonly state = {time:0,gust:0.5};
  readonly rows:NonNullable<WeatherProgram['air']>;
  constructor(rows:NonNullable<WeatherProgram['air']>) { this.rows=rows; }
  get current():Readonly<{time:number;gust:number}> { return this.state; }
  advance(dt:number,boost:number):void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid gust clock delta');
    this.state.time += dt; this.state.gust = clockGust(this.state.time,boost);
  }
  vecAt<T extends {x:number;y:number;z:number}>(x:number,z:number,out:T):T {
    const speed=this.rows.base+this.rows.scale*fieldGustAt(x,z,this.state.time,this.state.gust,this.rows.field);
    out.x=this.rows.field.x*speed;out.z=this.rows.field.z*speed;return out;
  }
  snapshot():v.InferOutput<typeof GustSaved> { return {version:1,...this.state}; }
  prepareRestore(value:unknown):()=>void { const saved=v.parse(GustSaved,value);return ()=>{this.state.time=saved.time;this.state.gust=saved.gust;}; }
}

function profile(rows:WeatherProgram):WeatherProfile<string,WeatherValues> {
  const evaluate=(state:string,mode:string,t:number,u:number,dt:number,clock:number,prev:Readonly<Record<string,number>>):WeatherValues=>{
    const values:Record<string,number>={t,u,dt,clock};
    const read=(id:string):number=>{
      if(id.startsWith('state.'))return Number(state===id.slice(6));
      if(id.startsWith('mode.'))return Number(mode===id.slice(5));
      const value=id.startsWith('prev.')?prev[id.slice(5)]:values[id];
      if(value===undefined)throw new Error(`Missing weather numeric input: ${id}`);return value;
    };
    for(const [id,expr] of rows.values)values[id]=audioMixValue(expr,read);
    const output:WeatherValues={overcast:0,rain:0,wet:0,wind:0,fog:0};
    for(const [id,expr] of Object.entries(rows.outputs))output[id]=audioMixValue(expr,read);
    return output;
  };
  const {forceWet, ...settings}=rows;
  return {...settings, initial:()=>({overcast:0,rain:0,wet:0,wind:0,fog:0,...rows.initial}),
    numbers:frame=>evaluate(frame.state,frame.mode,frame.t,frame.u,frame.dt,frame.clockPhase,frame.prev),
    ...(forceWet===undefined?{}:{forceWet:(state:string,t:number,wet:number):number=>audioMixValue(forceWet,id=>{
      if(id==='t')return t;if(id==='prev.wet')return wet;if(id.startsWith('state.'))return Number(state===id.slice(6));throw new Error(`Missing weather force input: ${id}`);
    })})};
}

/** DATA-only seeded weather policy on Weather's existing phase loop. Optional cadence/wind checkpoint keeps old v1 saves. */
export class WeatherContinuation extends Weather<string,WeatherValues> {
  readonly gust:GustContinuation|null;
  private cadence=TickScheduler.isolated();
  /** Plain numeric registers; authored actions run without invoking shard functions. */
  readonly registers:Record<string,number>;
  /** The same stream as phase lengths: native mechanics preserve historical draw order. */
  readonly random:Rng;
  private readonly system;
  readonly rows:WeatherProgram;
  constructor(rows:WeatherProgram,options:{seed:number;mode?:string}) {
    const random=new Rng(options.seed ^ rows.salt);
    super(profile(rows),random);
    this.random=random;this.registers={...rows.registers};
    this.rows=rows;
    this.gust=rows.air===undefined?null:new GustContinuation(rows.air);
    this.system={id:rows.air?.system??'',phase:'update' as const,tick:rows.air?.tick??'',run:():void=>undefined};
    if(options.mode!==undefined)this.setMode(options.mode);
  }
  /** Evaluate one bounded authored action list, in order, on this owner's RNG. */
  applyActions(event:string,dt=0):void {
    const read=(id:string):number=>{
      if(id==='t')return this.phaseT;if(id==='u')return this.phaseT/this.phaseLen;if(id==='dt')return dt;
      if(id.startsWith('state.'))return Number(this.state===id.slice(6));
      if(id.startsWith('mode.'))return Number(this.mode===id.slice(5));
      const value=id.startsWith('register.')?this.registers[id.slice(9)]:id.startsWith('output.')?this.n[id.slice(7)]:undefined;
      if(value===undefined)throw new Error(`Missing weather action input: ${id}`);return value;
    };
    for(const action of this.rows.actions?.[event]??[]){
      if(action.when!==undefined&&!audioMixValue(action.when,read))continue;
      const value=action.value;
      this.registers[action.target]=typeof value==='object'&&'range' in value
        ?this.random.range(audioMixValue(value.range[0],read),audioMixValue(value.range[1],read)):audioMixValue(value,read);
    }
  }
  protected override entered(_state:string):void { this.applyActions('enter'); }
  protected override afterForce(_state:string):void { this.applyActions('force'); }
  protected override outputs(dt:number,phase:number):void { super.outputs(dt,phase);this.applyActions('tick',dt); }
  /** Compatibility view of the same weather owner, never a second clock. */
  get weather():this { return this; }
  step(dt:number,dayPhase:number):void {
    if(!Number.isFinite(dayPhase))throw new RangeError('Invalid weather day phase');
    this.cadence.beginFrame(dt);const due=this.cadence.systemDt(this.system,dt);
    this.gust?.advance(dt,this.registers['boost']??0);if(due>0)this.update(due,dayPhase);this.applyActions('step',dt);
  }
  captureContinuation():{version:1;weather:ReturnType<Weather['captureWeather']>;wind:v.InferOutput<typeof GustSaved>;cadence:string;boost:number} {
    if(this.gust===null)throw new Error('Weather has no wind continuation');
    return {version:1,weather:this.captureWeather(),wind:this.gust.snapshot(),cadence:this.cadence.captureIsolated(this.system),boost:this.registers['boost']??0};
  }
  prepareContinuationRestore(value:unknown):()=>void {
    if(this.gust===null)throw new Error('Weather has no wind continuation');
    const saved=v.parse(Saved,value),weather=this.prepareWeatherRestore(saved.weather),wind=this.gust.prepareRestore(saved.wind),cadence=TickScheduler.isolated();
    cadence.restoreIsolated(this.system,saved.cadence);
    if(v.parse(Time,saved.wind).time!==v.parse(Time,JSON.parse(saved.cadence)).time)throw new RangeError('Incompatible weather wind clock');
    return ()=>{weather();wind();this.cadence=cadence;this.registers['boost']=saved.boost;};
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedGustSaveInput = BoundedGustSave;
interface BoundedGustSaveFields {
    version: 1;
    time: number;
    gust: number;
}
type BoundedGustSave = { [Key in keyof BoundedGustSaveFields]: BoundedGustSaveFields[Key] };
