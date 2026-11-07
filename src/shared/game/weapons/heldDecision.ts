import * as v from 'valibot';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import type {Scope} from '@wildshard/engine/app/scope';
import { ReturnProgram } from '../population/returnProgram';
/** Admitted scalar weapon projection, capped at ten snapshots per second.
 * Inputs accumulate in the native action owner until a snapshot is consumed. */
export class HeldDecision {
 private elapsed=0;
 readonly program:ReturnProgram;
 private readonly signal:string;
 constructor(input:unknown,owner?:Scope){const {signal,...program}=v.parse(v.strictObject({...ReturnProgramSchema.entries,signal:v.optional(v.string(),'step')}),input);this.signal=signal;this.program=ReturnProgram.page(program,owner);}
 /** The complete cadence cursor; restoring it performs no projection. */
 snapshot():number{return this.elapsed;}
 restore(input:unknown):void{this.elapsed=v.parse(v.pipe(v.number(),v.finite(),v.minValue(0)),input);}
 update(dt:number,observed:Readonly<Record<string,number>>,candidates:readonly Readonly<Record<string,number>>[]=[]):Readonly<Record<string,number>>|null{
  this.elapsed+=dt;if(this.elapsed<.1-1e-9)return null;
  const result=this.program.project(this.signal,{...observed,dt:this.elapsed,count:candidates.length},undefined,candidates);
  this.elapsed=0;return result;
 }
}
