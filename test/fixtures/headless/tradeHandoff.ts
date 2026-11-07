// oxlint-disable-next-line import/no-nodejs-modules -- Bind genuinely earned child continuations and their complete input ledger.
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {HeadlessTapePlanSchema,HeadlessTapeReportSchema,MAX_TICK_SNAPSHOT_CHARS} from '../../../src/shared/host/tickProtocol';
import type {SimSnapshot,SimSnapshotBytes} from '../../../src/shared/engine/sim/snapshot';

const natural=v.pipe(v.number(),v.safeInteger(),v.minValue(0)),digest=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
export const TradePartSchema=v.strictObject({plan:HeadlessTapePlanSchema,expected:HeadlessTapeReportSchema,metadata:digest,physics:digest,positive:digest,negative:digest});
export type TradePart=v.InferOutput<typeof TradePartSchema>;
export const TradeHandoffSchema=v.strictObject({version:v.literal(1),stage:v.picklist(['counter','purse','buy']),source:digest,
  tick:natural,snapshot:v.pipe(v.string(),v.maxLength(MAX_TICK_SNAPSHOT_CHARS)),positive:v.pipe(v.string(),v.maxLength(MAX_TICK_SNAPSHOT_CHARS)),negative:v.pipe(v.string(),v.maxLength(MAX_TICK_SNAPSHOT_CHARS)),
  omitted:natural,identicalPhysics:natural,canonicalPhysics:natural,parts:v.pipe(v.array(TradePartSchema),v.minLength(1),v.maxLength(128))});
export type TradeHandoff=v.InferOutput<typeof TradeHandoffSchema>;
/** Preserve signed zero and infinities across the fixture's JSON ledger. */
export function tradeWire(value:unknown,canonical=false):string {
  return JSON.stringify(value,(_key:string,entry:unknown):unknown=>{
    if(typeof entry==='number'&&(Object.is(entry,-0)||!Number.isFinite(entry)))return {'trade.number':Object.is(entry,-0)?'-0':String(entry)};
    if(entry!==null&&typeof entry==='object'&&Object.hasOwn(entry,'trade.number'))throw new Error('Reserved trade number marker');
    return canonical&&entry!==null&&typeof entry==='object'&&!Array.isArray(entry)
      ?Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b))):entry;
  });
}
export function tradeRead(wire:string):unknown {
  return JSON.parse(wire,(_key:string,entry:unknown):unknown=>{
    if(entry!==null&&typeof entry==='object'&&Object.keys(entry).length===1&&Object.hasOwn(entry,'trade.number')){
      const value=Reflect.get(entry,'trade.number');
      if(value==='-0')return -0;if(value==='Infinity')return Infinity;if(value==='-Infinity')return -Infinity;
      throw new Error('Invalid trade number marker');
    }return entry;
  });
}
export const tradeHash=(wire:string):string=>createHash('sha256').update(wire).digest('hex');
export function tradeSnapshotHashes(snapshot:SimSnapshot|SimSnapshotBytes):{metadata:string;physics:string} {
  const {physics,...metadata}=snapshot;
  return {metadata:tradeHash(tradeWire(metadata,true)),physics:createHash('sha256').update(Uint8Array.from(physics)).digest('hex')};
}
/** Children inherit all old intervals and allowances; a process boundary grants no new budget. */
export function checkTradeLedger(parts:readonly TradePart[],tick:number):void {
  let ticks=0,commands=0,bytes=0;
  if(parts.length>128)throw new Error('Trade aggregate part allowance exceeded');
  for(const part of parts){
    const segment=part.plan.segments[0],observation=part.expected.observations[0];
    if(part.plan.segments.length!==1||part.plan.observe.length>0||segment===undefined||segment.frames?.length!==segment.ticks
      ||segment.commands.length>0||segment.route!==undefined||segment.ticks<1||segment.ticks>512
      ||part.expected.observations.length!==1||observation?.id!==segment.id||part.expected.ticks!==segment.ticks)
      throw new Error('Trade handoff changed an ordered input interval');
    ticks+=segment.ticks;commands+=segment.frames.reduce((sum,frame)=>sum+frame.length,0);
    if(observation.tick!==ticks)throw new Error('Trade handoff skipped an input interval');
    bytes+=new TextEncoder().encode(JSON.stringify(observation)).byteLength;
  }
  if(ticks!==tick)throw new Error('Trade handoff lost its earned tick');
  if(tick>30_000||commands>60_000||bytes>8_000_000)throw new Error('Trade aggregate tape allowance exceeded');
}
export function checkTradeHandoff(saved:TradeHandoff,source:string,preceding:'counter'|'purse'):void {
  if(saved.stage!==preceding||saved.source!==source)throw new Error('Trade handoff has a different earned stage or product');
  checkTradeLedger(saved.parts,saved.tick);
  if(saved.identicalPhysics+saved.canonicalPhysics!==saved.parts.length*2)throw new Error('Trade handoff lost its original native comparisons');
  const last=saved.parts.at(-1);
  if(last===undefined||tradeHash(saved.positive)!==last.positive||tradeHash(saved.negative)!==last.negative)
    throw new Error('Trade handoff lost its independently checked saves');
}
