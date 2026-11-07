// oxlint-disable-next-line import/no-nodejs-modules -- Lossless bounded transport of the real native observation; no asset or executable is decoded.
import {deflateSync,inflateSync} from 'node:zlib';
import * as v from 'valibot';
import type {SimHost} from '../../../src/server/engine/sim';

export const PACKED_CHAPTER_TAMING='nalati.chapter-taming';
const LIMIT=1_000_000,marker='chapter.observation.number';
const Wire=v.strictObject({version:v.literal(1),owner:v.literal('nalati.taming'),codec:v.literal('deflate'),
  bytes:v.pipe(v.number(),v.safeInteger(),v.minValue(1),v.maxValue(LIMIT)),
  data:v.pipe(v.string(),v.maxLength(1_400_000),v.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u))});
/** Stable complete JSON, including signed zero and logical clock sentinels. */
export function chapterObservationWire(value:unknown):string {
  const result=JSON.stringify(value,(_key,entry:unknown):unknown=>{
    if(typeof entry==='number'){
      if(Number.isNaN(entry))throw new Error('Chapter observation refuses NaN');
      if(Object.is(entry,-0)||!Number.isFinite(entry))return {[marker]:Object.is(entry,-0)?'-0':entry>0?'+Infinity':'-Infinity'};
    }
    if(entry!==null&&typeof entry==='object'&&!Array.isArray(entry)){
      if(Object.hasOwn(entry,marker))throw new Error('Reserved chapter observation marker');
      return Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b)));
    }
    return entry;
  });
  if(result===undefined)throw new Error('Missing chapter observation');return result;
}
export function packChapterTaming(value:unknown):string {
  const raw=Buffer.from(chapterObservationWire(value),'utf8');
  if(raw.byteLength>LIMIT)throw new Error('Chapter observation raw byte bound exceeded');
  return JSON.stringify({version:1,owner:'nalati.taming',codec:'deflate',bytes:raw.byteLength,data:deflateSync(raw,{level:1}).toString('base64')});
}
export function unpackChapterTaming(input:unknown):unknown {
  if(typeof input!=='string'||input.length>1_500_000)throw new Error('Missing bounded packed chapter observation');
  const parsed:unknown=JSON.parse(input),wire=v.parse(Wire,parsed),packed=Buffer.from(wire.data,'base64');
  if(packed.toString('base64')!==wire.data)throw new Error('Noncanonical chapter observation encoding');
  const raw=inflateSync(packed,{maxOutputLength:LIMIT});
  if(raw.byteLength!==wire.bytes)throw new Error('Chapter observation decoded byte count differs');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw),(_key,entry:unknown):unknown=>{
    if(entry!==null&&typeof entry==='object'&&!Array.isArray(entry)&&Object.hasOwn(entry,marker)){
      if(Object.keys(entry).length!==1)throw new Error('Invalid chapter number marker');
      const value:unknown=Reflect.get(entry,marker);
      if(value==='-0')return -0;if(value==='+Infinity')return Infinity;if(value==='-Infinity')return -Infinity;
      throw new Error('Invalid chapter number marker');
    }
    return entry;
  });
}
/** Read-only observation loan. The primary taming continuation stays raw and
 * authoritative in every full native snapshot. Restore only verifies it; it
 * never writes another owner, advances a tick, or changes RNG or a budget. */
export function installPackedChapterTaming(host:Pick<SimHost,'scope'|'adapters'|'hasStep'|'onStep'>):void {
  const owner=host.adapters.get('nalati.taming');
  if(owner===undefined||host.hasStep(PACKED_CHAPTER_TAMING))throw new Error('Chapter observation requires its unique real taming owner');
  const read=owner.snapshot;
  const live=():void=>{if(host.scope.disposed||host.scope.disposing||host.adapters.get('nalati.taming')!==owner||owner.snapshot!==read)
    throw new Error('Chapter observation owner retired or replaced');};
  host.onStep(PACKED_CHAPTER_TAMING,()=>undefined,{snapshot:()=>{live();return packChapterTaming(read.call(owner));},restore:value=>{
    live();const decoded=unpackChapterTaming(value);
    if(chapterObservationWire(decoded)!==chapterObservationWire(read.call(owner)))throw new Error('Packed observation differs from its restored primary taming owner');
  }});
}
