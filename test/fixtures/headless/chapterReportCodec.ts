// Pure report transport; no native owner is installed or changed.
// oxlint-disable-next-line import/no-nodejs-modules -- Bind complete report strings to their exact owned basis and result.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Bounded test-only report transport; no asset or executable is decoded.
import {deflateSync,inflateSync,brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import * as v from 'valibot';
import type {HeadlessTapeReport} from '../../../src/shared/host/headlessTape';
import {packChapterTaming,unpackChapterTaming} from './chapterObservation';

type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
interface Operation {path:string[];value:Json}
const LIMIT=1_000_000,DEPTH=64,OPERATIONS=8192,marker='chapter.report.number',floatMarker='chapter.report.float';
const ownerSchema=v.picklist(['nalati.chapter-taming','nalati.king-closed']);
type Owner=v.InferOutput<typeof ownerSchema>;
const digest=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Wire=v.strictObject({'chapter.report':v.literal(1),owner:ownerSchema,codec:v.picklist(['deflate-patch','brotli-state','brotli-f64-patch']),basis:digest,result:digest,
  bytes:v.pipe(v.number(),v.safeInteger(),v.minValue(1),v.maxValue(LIMIT)),
  data:v.pipe(v.string(),v.maxLength(1_400_000),v.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u))});
const Inflated=v.object({buffer:v.instance(Buffer),engine:v.object({bytesWritten:v.pipe(v.number(),v.safeInteger(),v.minValue(0))})});
const hash=(text:string):string=>createHash('sha256').update(text).digest('hex');
const owned=(id:string):id is Owner=>id==='nalati.chapter-taming'||id==='nalati.king-closed';
function isJson(value:unknown,depth=0):value is Json {
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return !Number.isNaN(value);
  if(typeof value!=='object'||depth>=DEPTH)return false;
  if(Array.isArray(value))return value.every((entry:unknown)=>isJson(entry,depth+1));
  if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
  return Object.keys(value).every(key=>isJson(Reflect.get(value,key),depth+1));
}
function json(value:unknown):Json {if(!isJson(value))throw new Error('Invalid bounded report JSON');return value;}
function patchWire(value:unknown):string {
  const result=JSON.stringify(value,(_key,entry:unknown):unknown=>{
    if(typeof entry==='number'){
      if(Number.isNaN(entry))throw new Error('Report delta refuses NaN');
      if(Object.is(entry,-0)||!Number.isFinite(entry))return {[marker]:Object.is(entry,-0)?'-0':entry>0?'+Infinity':'-Infinity'};
    }
    if(entry!==null&&typeof entry==='object'&&Object.hasOwn(entry,marker))throw new Error('Reserved report number marker');
    return entry;
  });
  if(result===undefined)throw new Error('Missing report delta');return result;
}
function read(textValue:string):Json {
  const parsed:unknown=JSON.parse(textValue,(_key,entry:unknown):unknown=>{
    if(entry!==null&&typeof entry==='object'&&Object.hasOwn(entry,marker)){
      if(Object.keys(entry).length!==1)throw new Error('Invalid report number marker');
      const number:unknown=Reflect.get(entry,marker);
      if(number==='-0')return -0;if(number==='+Infinity')return Infinity;if(number==='-Infinity')return -Infinity;
      throw new Error('Invalid report number marker');
    }
    return entry;
  });return json(parsed);
}
const operationSchema=v.strictObject({path:v.pipe(v.array(v.pipe(v.string(),v.maxLength(LIMIT))),v.maxLength(DEPTH)),
  value:v.custom<Json>(isJson,'Invalid bounded report JSON')});
const Operations=v.pipe(v.array(operationSchema),v.maxLength(OPERATIONS));
function property(value:Json,key:string):Json {
  if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('Missing report delta path');
  if(Array.isArray(value)){
    if(!/^(?:0|[1-9][0-9]*)$/u.test(key))throw new Error('Invalid report array path');
    const item=value[Number(key)];if(item===undefined)throw new Error('Missing report array item');return item;
  }
  const item=value[key];if(item===undefined)throw new Error('Missing report object item');return item;
}
function differences(before:Json,after:Json,path:string[],operations:Operation[]):boolean {
  if(Object.is(before,after))return true;
  if(path.length>DEPTH||operations.length>=OPERATIONS)return false;
  if(before!==null&&after!==null&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after)){
    const a=Object.keys(before),b=Object.keys(after);
    if(a.length===b.length&&a.every((key,index)=>key===b[index])){
      for(const key of a)if(!differences(property(before,key),property(after,key),[...path,key],operations))return false;return true;
    }
  }
  operations.push({path,value:after});return true;
}
function apply(before:Json,operations:readonly Operation[]):Json {
  let result=structuredClone(before);
  for(const operation of operations){
    if(operation.path.length===0){result=structuredClone(operation.value);continue;}
    let target=result;
    for(const key of operation.path.slice(0,-1))target=property(target,key);
    const key=operation.path.at(-1);if(key===undefined)throw new Error('Missing report delta key');
    property(target,key);
    // Own data properties only; a '__proto__' leaf never invokes a setter.
    Object.defineProperty(target,key,{value:structuredClone(operation.value),writable:true,enumerable:true,configurable:true});
  }
  return result;
}
function rawOwnerValue(owner:Owner,state:string):unknown {
  if(Buffer.byteLength(state)>LIMIT)throw new Error('Report state byte bound exceeded');
  const parsed:unknown=owner==='nalati.chapter-taming'?unpackChapterTaming(state):JSON.parse(state);return parsed;
}
function ownerValue(owner:Owner,state:string):Json {return json(rawOwnerValue(owner,state));}
function render(owner:Owner,state:Json):string {return owner==='nalati.chapter-taming'?packChapterTaming(state):JSON.stringify(state);}
function encoded(state:string):boolean {
  const parsed:unknown=JSON.parse(state);
  return parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed)&&Object.hasOwn(parsed,'chapter.report');
}
/** An optional bounded numeric payload; values retain their exact IEEE bits.
 * JSON shape and ordered one-use slots are checked before applying a patch. */
function floatPatch(operations:Operation[]):Buffer|undefined {
  if(!isJson(operations))return undefined;
  const numbers:number[]=[];let supported=true;
  const shape=(value:Json):Json=>{
    if(typeof value==='number'){const index=numbers.length;numbers.push(value);return {[floatMarker]:index};}
    if(Array.isArray(value))return value.map(shape);
    if(value!==null&&typeof value==='object'){
      if(Object.hasOwn(value,floatMarker))supported=false;
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shape(item)]));
    }
    return value;
  };
  const text=Buffer.from(JSON.stringify(shape(operations))),bytes=4+text.byteLength+numbers.length*8;
  if(!supported||bytes>LIMIT)return undefined;
  const payload=Buffer.alloc(bytes);payload.writeUInt32LE(text.byteLength);text.copy(payload,4);
  numbers.forEach((value,index)=>{payload.writeDoubleLE(value,4+text.byteLength+index*8);});return payload;
}
function readFloatPatch(payload:Buffer):Json {
  if(payload.byteLength<4)throw new Error('Truncated numeric report shape');
  const length=payload.readUInt32LE(),offset=4+length,remaining=payload.byteLength-offset;
  if(length<2||offset>payload.byteLength||remaining%8!==0)throw new Error('Invalid numeric report shape');
  let next=0;
  const restore=(value:unknown,depth=0):Json=>{
    if(depth>DEPTH)throw new Error('Numeric report depth exceeded');
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(Array.isArray(value))return value.map((item:unknown)=>restore(item,depth+1));
    if(typeof value!=='object'||value===undefined)throw new Error('Invalid numeric report scalar');
    if(Object.hasOwn(value,floatMarker)){
      const index:unknown=Reflect.get(value,floatMarker);
      if(Object.keys(value).length!==1||index!==next||next>=remaining/8)throw new Error('Invalid numeric report slot');
      const number=payload.readDoubleLE(offset+next*8);next++;
      if(Number.isNaN(number))throw new Error('Numeric report refuses NaN');return number;
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restore(item,depth+1)]));
  };
  const shape:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload.subarray(4,offset))),value=restore(shape);
  if(next!==remaining/8)throw new Error('Unused numeric report slots');return value;
}
function unpackState(owner:Owner,state:string,before:string|undefined):string {
  if(state.length>LIMIT)throw new Error('Original report state length bound exceeded');
  if(!encoded(state))return state;
  const wire=v.parse(Wire,JSON.parse(state));
  if(wire.owner!==owner||before===undefined||wire.basis!==hash(before))throw new Error('Foreign or missing report delta basis');
  const packed=Buffer.from(wire.data,'base64');if(packed.toString('base64')!==wire.data)throw new Error('Noncanonical report delta encoding');
  const inflated:unknown=wire.codec==='deflate-patch'?inflateSync(packed,{maxOutputLength:LIMIT,info:true}):brotliDecompressSync(packed,{maxOutputLength:LIMIT,info:true});
  const payload=v.parse(Inflated,inflated);
  if(payload.engine.bytesWritten!==packed.byteLength)throw new Error('Trailing report delta bytes');
  const text=():string=>new TextDecoder('utf-8',{fatal:true}).decode(payload.buffer);
  const restored=wire.codec==='brotli-state'?text():render(owner,apply(ownerValue(owner,before),v.parse(Operations,wire.codec==='brotli-f64-patch'?readFloatPatch(payload.buffer):read(text()))));
  if(Buffer.byteLength(restored)!==wire.bytes||hash(restored)!==wire.result)throw new Error('Report delta result differs');
  return restored;
}
function packPatchState(owner:Owner,state:string,before:string|undefined):string {
  if(state.length>LIMIT)throw new Error('Original report state length bound exceeded');
  if(encoded(state))throw new Error('Report basis and input must be expanded');
  // A valid UTF-8 state may occupy more bytes than the original character
  // limit. Keep it raw instead of introducing a stricter native bound.
  if(Buffer.byteLength(state)>LIMIT||before!==undefined&&Buffer.byteLength(before)>LIMIT)return state;
  const current=rawOwnerValue(owner,state);
  if(!isJson(current)||before===undefined||render(owner,current)!==state)return state;
  if(encoded(before))throw new Error('Report basis must be expanded');
  const base=rawOwnerValue(owner,before);if(!isJson(base))return state;
  const operations:Operation[]=[];if(!differences(base,current,[],operations))return state;
  const payload=Buffer.from(patchWire(operations));if(payload.byteLength>LIMIT)return state;
  const wire=JSON.stringify({'chapter.report':1,owner,codec:'deflate-patch',basis:hash(before),result:hash(state),
    bytes:Buffer.byteLength(state),data:deflateSync(payload,{level:1}).toString('base64')});
  if(Buffer.byteLength(wire)>=Buffer.byteLength(state))return state;
  if(unpackState(owner,wire,before)!==state)throw new Error('Report delta is not byte-exact');return wire;
}
function packState(owner:Owner,state:string,before:string|undefined,compact:boolean):string {
  const patch=packPatchState(owner,state,before);
  if(!compact||before===undefined||Buffer.byteLength(state)>LIMIT||Buffer.byteLength(before)>LIMIT)return patch;
  let best=patch;
  const wire=JSON.stringify({'chapter.report':1,owner,codec:'brotli-state',basis:hash(before),result:hash(state),bytes:Buffer.byteLength(state),
    data:brotliCompressSync(Buffer.from(state),{params:{[constants.BROTLI_PARAM_QUALITY]:5}}).toString('base64')});
  if(Buffer.byteLength(wire)<Buffer.byteLength(best))best=wire;
  if(encoded(patch)){
    const legacy=v.parse(Wire,JSON.parse(patch)),payload=floatPatch(v.parse(Operations,read(inflateSync(Buffer.from(legacy.data,'base64'),{maxOutputLength:LIMIT}).toString('utf8'))));
    if(payload!==undefined){
      const candidate=JSON.stringify({...legacy,codec:'brotli-f64-patch',data:brotliCompressSync(payload,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}).toString('base64')});
      if(Buffer.byteLength(candidate)<Buffer.byteLength(best))best=candidate;
    }
  }
  if(unpackState(owner,best,before)!==state)throw new Error('Report state is not byte-exact');return best;
}
function bases(previous:HeadlessTapeReport|undefined):Map<Owner,string> {
  const result=new Map<Owner,string>();
  for(const adapter of previous?.observations.at(-1)?.adapters??[])if(owned(adapter.id)){
    if(adapter.state.length>LIMIT)throw new Error('Original report state length bound exceeded');
    if(result.has(adapter.id)||encoded(adapter.state))throw new Error('Report basis must be unique and expanded');
    result.set(adapter.id,adapter.state);
  }
  return result;
}
/** Inspect only the two selected report owners; no native adapter is sampled. */
export function chapterReportUsesCodec(report:HeadlessTapeReport):boolean {
  return report.observations.some(observation=>observation.adapters.some(adapter=>owned(adapter.id)&&encoded(adapter.state)));
}
/** Pure future-report transport. Previous reports must already be expanded;
 * no original prefix, input, native snapshot, observer or budget is rewritten. */
export function packChapterReport(report:HeadlessTapeReport,previous?:HeadlessTapeReport,compact=false):HeadlessTapeReport {
  const prior=bases(previous),copy=structuredClone(report);
  for(const observation of copy.observations){
    const seen=new Set<Owner>();
    for(const adapter of observation.adapters){
      if(!owned(adapter.id))continue;
      if(seen.has(adapter.id))throw new Error('Duplicate report owner');seen.add(adapter.id);
      const state=packState(adapter.id,adapter.state,prior.get(adapter.id),compact);prior.set(adapter.id,adapter.state);
      adapter.state=state;
    }
  }
  return copy;
}
/** Recover every exact original state string before any full report compare.
 * Basis/result hashes bind the complete values; unavailable bases refuse. */
export function unpackChapterReport(report:HeadlessTapeReport,previous?:HeadlessTapeReport):HeadlessTapeReport {
  const prior=bases(previous),copy=structuredClone(report);
  for(const observation of copy.observations){
    const seen=new Set<Owner>();
    for(const adapter of observation.adapters){
      if(!owned(adapter.id))continue;
      if(seen.has(adapter.id))throw new Error('Duplicate report owner');seen.add(adapter.id);
      const state=unpackState(adapter.id,adapter.state,prior.get(adapter.id));prior.set(adapter.id,state);
      adapter.state=state;
    }
  }
  return copy;
}
