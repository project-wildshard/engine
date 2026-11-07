// oxlint-disable-next-line import/no-nodejs-modules -- Bind the actual earned continuation and input ledger between two bounded children.
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import type {TitanBowCursor} from '../../proof/nalati-grasslands/titanCombat';
import {HeadlessTapePlanSchema,HeadlessTapeReportSchema,TickCommandSchema} from '../../../src/shared/host/tickProtocol';

const natural=v.pipe(v.number(),v.safeInteger(),v.minValue(0));
const digest=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
export const TitanPartSchema=v.strictObject({plan:HeadlessTapePlanSchema,expected:HeadlessTapeReportSchema,digest});
export type TitanPart=v.InferOutput<typeof TitanPartSchema>;
export const TitanBowCursorSchema:v.GenericSchema<TitanBowCursor>=v.strictObject({
  tick:v.pipe(natural,v.minValue(1),v.maxValue(9600),v.check(tick=>tick%30!==0,'Resume after the next native view refresh')),lastShots:natural,lastDodge:v.boolean(),
  currentAim:v.strictObject({yaw:v.pipe(v.number(),v.finite()),pitch:v.pipe(v.number(),v.finite()),flight:v.pipe(v.number(),v.finite(),v.minValue(0))})});
const deaths=v.pipe(v.array(v.strictObject({tick:natural,phase:v.literal(2),checkpoint:v.literal(true)})),v.minLength(1));
const combatParts=v.pipe(v.array(TitanPartSchema),v.minLength(1),v.maxLength(128));
const handoffFields={version:v.literal(1),source:digest,snapshot:v.pipe(v.string(),v.maxLength(24_000_000)),digest,
  checkpointTick:natural,captureTicks:natural,initialKills:natural};
export const TitanHandoffSchema=v.pipe(v.variant('stage',[
  // Entry has consumed no combat inputs. Its real initialization commit is
  // checked independently before the first combat part may be recorded.
  v.strictObject({...handoffFields,stage:v.literal('storm'),parts:v.tuple([]),deaths:v.tuple([])}),
  v.strictObject({...handoffFields,stage:v.literal('fire'),parts:combatParts,deaths:v.tuple([])}),
  v.strictObject({...handoffFields,stage:v.literal('retry'),parts:combatParts,deaths,cursor:TitanBowCursorSchema,fireTick:natural}),
]),v.check(value=>value.stage==='storm'?value.captureTicks===value.checkpointTick:
  value.parts.at(-1)?.expected.observations[0]?.tick===value.captureTicks,'Handoff must end at its actual checked tick'),
  v.check(value=>value.deaths.every(event=>event.tick>value.checkpointTick&&event.tick<=value.captureTicks),'Retry death must belong to its checked input interval'),
  v.check(value=>value.stage!=='retry'||value.fireTick>=value.checkpointTick&&value.fireTick<value.captureTicks
    &&value.cursor.tick<=value.captureTicks-value.fireTick&&value.parts.some(part=>part.expected.observations[0]?.tick===value.fireTick),
  'Retry must retain the earned fire boundary and controller progress'));
export type TitanHandoff=v.InferOutput<typeof TitanHandoffSchema>;
export const titanWireHash=(wire:string):string=>createHash('sha256').update(wire).digest('hex');

/** Every combat case inherits the preceding case's actual, checked inputs and
 * observations. A fresh worker does not grant a second tape allowance. */
export function checkTitanLedger(parts:readonly TitanPart[],checkpointTick:number):void{
  let tick=checkpointTick,commands=0,bytes=0;
  if(parts.length>128)throw new Error('Titan aggregate part allowance exceeded');
  for(let index=0;index<parts.length;index++){
    const part=parts[index];if(part===undefined)throw new Error('Missing Titan part');
    const segment=part.plan.segments[0],observation=part.expected.observations[0];
    if(part.plan.segments.length!==1||segment===undefined||segment.id!==`titan-${index}`||segment.ticks>512
      ||segment.frames?.length!==segment.ticks||segment.commands.length>0||segment.route!==undefined
      ||JSON.stringify(part.plan.observe)!==JSON.stringify(['nalati.titan','nalati.weapons','nalati.chapter-records'])
      ||part.expected.observations.length!==1||observation?.id!==segment.id||part.expected.ticks!==segment.ticks)
      throw new Error('Titan handoff changed an ordered part');
    tick+=segment.ticks;
    if(observation.tick!==tick)throw new Error('Titan handoff skipped an input interval');
    commands+=segment.frames.reduce((sum,frame)=>sum+frame.length,0);
    bytes+=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
  }
  if(tick-checkpointTick>60_000||commands>60_000||bytes>8_000_000)throw new Error('Titan aggregate tape allowance exceeded');
}

/** Current-input integrity for an unbroken reference and its split replay. */
export function titanInputDigest(parts:readonly TitanPart[],fireTick:number):string{
  const hash=createHash('sha256');
  for(const part of parts){
    const end=part.expected.observations[0]?.tick;if(end===undefined)throw new Error('Missing checked observation');
    if(end<=fireTick)continue;
    for(const frame of part.plan.segments[0]?.frames??[])hash.update(`${JSON.stringify(frame.map(command=>v.parse(TickCommandSchema,command)))}\n`);
  }
  return hash.digest('hex');
}

/** An extra handoff may split an original interval. Rejoin its ordered
 * effects and peak, retaining the complete readout at every old fence. */
export function titanObservationDigest(parts:readonly TitanPart[],fireTick:number):string{
  const hash=createHash('sha256');
  let pending:TitanPart['expected']['observations'][number]|undefined;
  const rows=parts.flatMap(part=>part.expected.observations).filter(row=>row.tick>fireTick);
  for(let index=0;index<rows.length;index++){
    const row=rows[index];if(row===undefined)throw new Error('Missing checked interval');
    pending={...row,id:'',peakY:Math.max(pending?.peakY??row.peakY,row.peakY),effects:[...(pending?.effects??[]),...row.effects]};
    if((row.tick-fireTick)%512===0||index===rows.length-1){hash.update(`${JSON.stringify(pending)}\n`);pending=undefined;}
  }
  return hash.digest('hex');
}
