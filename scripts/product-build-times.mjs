// Scheduling hints only: no product, input receipt or validation can be skipped.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as v from 'valibot';

const Times=v.strictObject({version:v.literal(1),products:v.pipe(v.record(
  v.pipe(v.string(),v.regex(/^[a-z0-9_-]+$/u)),
  v.pipe(v.number(),v.finite(),v.minValue(0),v.maxValue(86_400_000))),v.check(rows=>Object.keys(rows).length<=4096))});
/** Keep machine families separate; the existing product cache transports hints.
 * @param {string} cache */
const path=cache=>resolve(cache,'.build-times',`${process.platform}-${process.arch}.json`);
/** A missing or invalid hint retains original scheduling, never build authority.
 * @param {string} cache @returns {ReadonlyMap<string,number>} */
export function readProductBuildTimes(cache) {
  try {return new Map(Object.entries(v.parse(Times,JSON.parse(readFileSync(path(cache),'utf8'))).products));}
  catch {return new Map();}
}
/** Long builds start first to avoid a single expensive final worker. Equal or
 * unknown costs keep input order; the input collection itself remains untouched.
 * @template {{name:string}} T @param {readonly T[]} products @param {ReadonlyMap<string,number>} times @returns {T[]} */
export function orderProductBuilds(products,times) {
  return products.map((product,index)=>({product,index}))
    .sort((a,b)=>(times.get(b.product.name)??0)-(times.get(a.product.name)??0)||a.index-b.index)
    .map(row=>row.product);
}
/** Publish completed build measurements. A fully validated cache hit can seed
 * a missing hint, but never replace an observed build's duration. Unchecked
 * copies/lookups do not qualify. Write failure is harmless: the normal build
 * has already completed all its required checks.
 * @param {string} cache @param {ReadonlyMap<string,number>} measured
 * @param {ReadonlyMap<string,number>} [validated] */
export function recordProductBuildTimes(cache,measured,validated=new Map()) {
  if(measured.size===0&&validated.size===0)return;
  const target=path(cache),temporary=`${target}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    const products=Object.fromEntries([...validated,...readProductBuildTimes(cache),...measured]);
    const document=v.parse(Times,{version:1,products});
    mkdirSync(dirname(target),{recursive:true});writeFileSync(temporary,JSON.stringify(document));renameSync(temporary,target);
  } catch { /* Hints cannot refuse or authorize a product. */ }
  finally {try{rmSync(temporary,{force:true});}catch{ /* Optional hint cleanup. */ }}
}
