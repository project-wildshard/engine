import * as v from 'valibot';
import type {OpenArenaFightSnapshot} from '../../../shared/game/boss/openArenaFight';
import type {BossContinuation} from '@wildshard/engine/ai/BossBrain';

const finite=v.pipe(v.number(),v.finite()),natural=v.pipe(finite,v.integer(),v.minValue(0));
const numbers=v.record(v.string(),finite),projection=v.strictObject({state:numbers,elapsed:finite});
const vector=v.tuple([finite,finite,finite]);
const fight:v.GenericSchema<unknown,OpenArenaFightSnapshot>=v.strictObject({life:projection,clocks:projection,support:projection,
  field:v.strictObject({modes:v.array(natural),lifetimes:v.array(finite),elapsed:finite,clock:finite,contactElapsed:finite,contact:v.nullable(projection)}),
  whirls:v.strictObject({gate:projection,laws:v.array(projection),drawn:v.array(v.strictObject({k:finite,shown:finite,x:finite,y:finite,z:finite}))}),
  pose:numbers,spear:vector,fireOn:v.boolean(),fireClear:v.boolean(),burnt:v.array(natural),hazardDt:finite,
  boundary:v.strictObject({mask:finite,effect:v.nullable(numbers)}),riders:v.array(v.strictObject({site:natural,law:projection})),
  body:v.strictObject({visible:v.boolean(),alpha:finite,flash:finite,dome:v.boolean()}),
  heart:v.strictObject({position:vector,alive:v.boolean()}),
  view:v.nullable(v.strictObject({bend:finite,raise:finite,castL:finite,struck:finite,alpha:finite}))});
const boss:v.GenericSchema<unknown,BossContinuation>=v.strictObject({state:v.picklist(['dormant','armed','intro','fight','beat','victory']),
  phase:natural,checkpoint:natural,attempts:natural,t:finite,skipT:finite,short:v.boolean(),
  saved:v.strictObject({defeated:v.boolean(),rewardTaken:v.boolean(),kills:natural}),director:v.exactOptional(v.string())});
/** Continuation values are admitted before any fresh encounter mutates. The
 * production owners retain their own row-specific validation on restore. */
export interface OpenArenaContinuation { version: 1; fight: OpenArenaFightSnapshot; boss: BossContinuation; locked: boolean; reward: boolean; rewardPoint: [number, number, number] | null; bar: boolean;
  prompt: { radius: number; label: string }; support: [number, string][]; toasts: string[]; feeds: string[]; contacts: number; engaged?: number; earned?: string[] }
export const OpenArenaSaved: v.GenericSchema<unknown, OpenArenaContinuation> = v.strictObject({version:v.literal(1),fight,boss,locked:v.boolean(),reward:v.boolean(),rewardPoint:v.optional(v.nullable(vector),null),bar:v.boolean(),
  prompt:v.strictObject({radius:finite,label:v.string()}),support:v.array(v.tuple([natural,v.string()])),
  toasts:v.array(v.string()),feeds:v.array(v.string()),contacts:natural,engaged:v.exactOptional(natural),earned:v.exactOptional(v.array(v.string()))});
