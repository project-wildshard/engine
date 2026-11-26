// Function source inspection binds its actual V8 script, never a name/body guess.
import {randomBytes} from 'node:crypto';
import {Session} from 'node:inspector';
import * as v from 'valibot';

/** @type {{session:Session,scripts:Map<string,string>}|undefined} */
let inspector;
/** Immutable function provenance only; callers still validate current bytes.
 * @type {WeakMap<object,string>} */
const sources=new WeakMap();
/** Local inspector callbacks normally finish synchronously. An unavailable,
 * unknown or delayed response returns no attribution: callers bind all source.
 * @param {object} target @returns {string|undefined} */
export function functionSource(target) {
  const cached=sources.get(target);if(cached!==undefined)return cached;
  const key=`wildshard-source-${randomBytes(16).toString('hex')}`,symbol=Symbol.for(key);
  try {
    if(inspector===undefined) {
      const session=new Session(),scripts=new Map();session.connect();
      session.on('Debugger.scriptParsed',event=>{ scripts.set(event.params.scriptId,event.params.url.startsWith('data:')?'data:':event.params.url); });
      session.post('Debugger.enable',{},()=>{ /* A missing location keeps the conservative fallback. */ });
      inspector={session,scripts};
    }
    const {session,scripts}=inspector;
    Object.defineProperty(globalThis,symbol,{value:target,configurable:true});
    /** @type {{value?:import('node:inspector').Runtime.EvaluateReturnType}} */
    const evaluated={};
    /** @param {Error|null} error @param {import('node:inspector').Runtime.EvaluateReturnType} result */
    const recordEvaluation=(error,result)=>{if(error===null)evaluated.value=result;};
    session.post('Runtime.evaluate',{expression:`globalThis[Symbol.for(${JSON.stringify(key)})]`,silent:true},recordEvaluation);
    const objectId=evaluated.value?.result.objectId;
    if(objectId===undefined)return undefined;
    try {
      /** @type {{value?:import('node:inspector').Runtime.GetPropertiesReturnType}} */
      const properties={};
      /** @param {Error|null} error @param {import('node:inspector').Runtime.GetPropertiesReturnType} result */
      const recordProperties=(error,result)=>{if(error===null)properties.value=result;};
      session.post('Runtime.getProperties',{objectId,ownProperties:true},recordProperties);
      const location=properties.value?.internalProperties?.find(row=>row.name==='[[FunctionLocation]]')?.value;
      const parsed=v.safeParse(v.object({scriptId:v.string()}),location?.value);
      if(!parsed.success)return undefined;
      const url=scripts.get(parsed.output.scriptId);
      if(url===undefined||url==='')return undefined;
      sources.set(target,url);return url;
    } finally {session.post('Runtime.releaseObject',{objectId},()=>{ /* No retained remote function handle. */ });}
  } catch {return undefined;}
  finally {Reflect.deleteProperty(globalThis,symbol);}
}
