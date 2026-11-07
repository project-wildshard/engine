import { channel } from 'node:diagnostics_channel';
import * as v from 'valibot';

export const BUILD_CACHE_REPORT_PREFIX = 'wildshard cache counters: ';
const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const names = /** @type {const} */ (['pine-map', 'nine-casts', 'nine-map', 'assemblyscript-raw', 'zstd-bytes', 'other-generation']);
const fields = /** @type {const} */ (['lookups','hits','diskHits','memoryHits','misses','populations','bypasses','writeFailures','populationRaces','bytesReused','bytesComputed','bytesStored']);
const rowSchema = v.strictObject({ cache: v.picklist(names), lookups: count, hits: count, diskHits: count, memoryHits: count, misses: count, populations: count,
  bypasses: count, writeFailures: count, populationRaces: count, bytesReused: count, bytesComputed: count, bytesStored: count });
const reportSchema = v.strictObject({ version: v.literal(1), units:v.literal('payload-bytes'), zeroLookups:v.literal('not-invoked'), complete: v.boolean(), products: v.strictObject({ built: count, reused: count, failed: count }),
  invalidReports: count, caches: v.pipe(v.array(rowSchema), v.length(names.length), v.check(rows => new Set(rows.map(row=>row.cache)).size===names.length&&rows.every(row=>row.hits===row.diskHits+row.memoryHits&&row.lookups>=row.hits+row.misses))) });
const eventSchema = v.strictObject({ version: v.literal(1), cache: v.picklist(['assemblyscript-raw','zstd-bytes','generation-step']),
  event: v.picklist(['lookup','disk-hit','memory-hit','miss','computed','population','bypass','write-failure','population-race']), bytes: count,
  project: v.exactOptional(v.pipe(v.string(),v.minLength(1),v.maxLength(256))), step: v.exactOptional(v.pipe(v.string(),v.regex(/^[a-z0-9][a-z0-9-]{0,79}$/u))) });
/** @typedef {v.InferOutput<typeof rowSchema>} CacheRow */
/** @typedef {v.InferOutput<typeof reportSchema>} CacheReport */
/** @param {CacheRow['cache']} cache @returns {CacheRow} */
function empty(cache) { return { cache,lookups:0,hits:0,diskHits:0,memoryHits:0,misses:0,populations:0,bypasses:0,writeFailures:0,populationRaces:0,bytesReused:0,bytesComputed:0,bytesStored:0 }; }
/** @param {CacheRow} row @returns {CacheRow} */
function copyRow(row) {return {...row};}
/** @param {v.InferOutput<typeof eventSchema>} event @returns {CacheRow['cache']} */
function label(event) {
  if(event.cache!=='generation-step')return event.cache;
  if(event.project==='pine-hollow'&&/^pine-map-[a-f0-9]{64}$/u.test(event.step??''))return 'pine-map';
  if(event.project==='nine-dragon-stack'&&/^casts(?:-slots-[a-f0-9]{64})?$/u.test(event.step??''))return 'nine-casts';
  if(event.project==='nine-dragon-stack'&&/^world-map(?:-[a-f0-9]{64})?$/u.test(event.step??''))return 'nine-map';
  return 'other-generation';
}
/** Bounded, per-phase payload accounting. Missing invocation is zero, not a cache hit.
 * Invalid diagnostics invalidate only the report, never the product build. */
export function createBuildCacheCounters() {
  const rows=new Map(names.map(name=>[name,empty(name)]));
  let invalidReports=0, built=0, reused=0, failed=0, childrenComplete=true;
  /** Preflight a whole addition so overflow cannot publish partial counts.
   * @param {CacheRow[]} additions @returns {boolean} */
  const add=additions=>{
    for(const next of additions){const previous=rows.get(next.cache);if(previous===undefined)return false;
      for(const field of fields)if(!Number.isSafeInteger(previous[field]+next[field]))return false;}
    for(const next of additions){const previous=rows.get(next.cache);if(previous===undefined)return false;
      for(const field of fields)previous[field]+=next[field];}
    return true;
  };
  return {
    /** @param {unknown} input */
    record(input) {
      const parsed=v.safeParse(eventSchema,input);
      if(!parsed.success){invalidReports++;return;}
      const event=parsed.output, row=empty(label(event));
      if(event.cache==='generation-step'&&(event.project===undefined||event.step===undefined)){invalidReports++;return;}
      switch(event.event){
        case 'lookup':row.lookups=1;break;
        case 'disk-hit':row.hits=1;row.diskHits=1;row.bytesReused=event.bytes;break;
        case 'memory-hit':row.hits=1;row.memoryHits=1;row.bytesReused=event.bytes;break;
        case 'miss':row.misses=1;break;
        case 'computed':row.bytesComputed=event.bytes;break;
        case 'population':row.populations=1;row.bytesStored=event.bytes;break;
        case 'bypass':row.bypasses=1;break;
        case 'write-failure':row.writeFailures=1;break;
        case 'population-race':row.populationRaces=1;break;
        default:invalidReports++;return;
      }
      if(!add([row]))invalidReports++;
    },
    /** @param {unknown} input @returns {boolean} */
    merge(input) {
      const parsed=v.safeParse(reportSchema,input);
      if(!parsed.success||!add(parsed.output.caches)){invalidReports++;return false;}
      invalidReports+=parsed.output.invalidReports;childrenComplete&&=parsed.output.complete;
      return true;
    },
    /** @param {boolean} wasBuilt */
    product(wasBuilt) {if(wasBuilt)built++;else reused++;},
    failure() {failed++;},
    /** @param {boolean} complete @returns {CacheReport} */
    snapshot(complete) {return {version:1,units:'payload-bytes',zeroLookups:'not-invoked',complete:complete&&childrenComplete&&invalidReports===0&&failed===0,products:{built,reused,failed},invalidReports,caches:[...rows.values()].map(copyRow)};},
  };
}
/** Observe Node and author-VM copies through the same process-owned channel.
 * @param {ReturnType<typeof createBuildCacheCounters>} counters @returns {()=>void} */
export function observeBuildCache(counters) {
  const metric=channel('wildshard.build-cache');
  const listener=(/** @type {unknown} */ message)=>{counters.record(message);};
  metric.subscribe(listener);return ()=>{metric.unsubscribe(listener);};
}
/** Only the new bounded report line is consumed. Existing stderr bytes retain their order.
 * @param {(report:unknown)=>void} receive @param {(text:string)=>void} forward @param {boolean} [required] */
export function buildCacheReportReader(receive,forward,required=false) {
  let pending='', seen=false;
  /** @param {string} line */
  const consume=line=>{if(line.startsWith(BUILD_CACHE_REPORT_PREFIX)){
    if(seen){receive(undefined);forward(line);return;}seen=true;
    try{const parsed=v.safeParse(reportSchema,JSON.parse(line.slice(BUILD_CACHE_REPORT_PREFIX.length)));if(parsed.success){receive(parsed.output);return;}}
    catch{/* Preserve malformed diagnostics as ordinary stderr. */}
    receive(undefined);
  }forward(line);};
  return {
    /** @param {string} chunk */
    write(chunk){pending+=chunk;let at;while((at=pending.indexOf('\n'))>=0){consume(pending.slice(0,at+1));pending=pending.slice(at+1);}
      if(pending.length>65_536){if(pending.startsWith(BUILD_CACHE_REPORT_PREFIX)){seen=true;receive(undefined);}forward(pending);pending='';}},
    end(){if(pending.length>0)consume(pending);pending='';if(required&&!seen)receive(undefined);},
  };
}
/** @param {CacheReport} report @returns {string} */
export function formatBuildCacheReport(report) {return BUILD_CACHE_REPORT_PREFIX+JSON.stringify(report);}
