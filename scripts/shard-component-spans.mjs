import { componentInventory } from './shard-components.mjs';

/** Publish the existing verified census; never build or count ownership again.
 * @param {string} root
 * @param {Partial<Record<string,import('./shard-component-spans.mjs').ComponentSpanInput>>} inventory
 * @param {readonly string[]} slugs
 * @param {string|null} measurementError */
export function componentSpanReports(root,inventory,slugs,measurementError) {
  return Object.fromEntries(slugs.map(shard=>{
    if(measurementError!==null)return [shard,{schema:'shard-platform-spans/1',measurement:'source',shard,
      total:null,counts:null,spans:null,unknown:null,measurementError}];
    const row=inventory[shard];
    if(row?.customSources===undefined)throw new Error(`Census: missing source spans for ${shard}`);
    const measured=row.components??componentInventory(root,shard,row.customSources,row.conversion.customRuntimeLines);
    return [shard,{schema:'shard-platform-spans/1',measurement:'source',shard,
      total:measured.total,counts:measured.counts,spans:measured.spans,unknown:measured.unknown,measurementError:null}];
  }));
}
