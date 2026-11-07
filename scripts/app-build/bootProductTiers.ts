/// <reference types="node" />
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {entryFileSteps} from '@wildshard/format/tierSelection';
import {bootProductTotals} from './bootProducts';
import {readOutputDownloadIndex} from '@wildshard/format/outputDownload';
import * as v from 'valibot';

type Total = readonly [number,number] | readonly [number,number,number,number];
/** Compiler-known tier totals precede section reads. The runtime applies the
 * same pure selector; no device, page service or runtime module is imported. */
export function bootTierProductTotals(root:string): Readonly<Record<string,Total>> {
  const rows:Record<string,Total>={};
  for(const [prefix,full] of Object.entries(bootProductTotals(root))) {
    const directory=prefix.split('/')[2];
    if(directory===undefined)throw new Error('Missing product directory');
    const product=resolve(root,'out',directory),input:unknown=JSON.parse(readFileSync(resolve(product,'shard.json'),'utf8'));
    const index=readOutputDownloadIndex(input);
    const runtime=v.safeParse(v.object({kind:v.literal('client-plan')}),index.runtime);
    if(index.runtime!==null&&!runtime.success){rows[prefix]=full;continue;}
    const sections=new Map<string,unknown>();
    for(const row of index.sections) {
      const bytes=readFileSync(resolve(product,row.path));
      if(bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.hash)throw new Error('Boot tier section differs from its index');
      sections.set(row.name,JSON.parse(bytes.toString('utf8')));
    }
    // Only transport metadata is reconstructed in Node. The browser still
    // admits every section through the complete format contract.
    const metadata=v.parse(v.object({version:v.unknown(),identity:v.looseObject({slug:v.string()}),requires:v.unknown(),
      files:v.array(v.object({hash:v.string(),kind:v.string(),decoded:v.number(),dependencies:v.array(v.string())})),
      admission:v.looseObject({library:v.array(v.string()),critical:v.array(v.string())})}),input);
    const pair=v.object({day:v.string(),night:v.string()});
    const manifest=v.parse(v.object({manifest:v.exactOptional(v.looseObject({horizonStrips:v.exactOptional(v.looseObject({
      day:v.string(),night:v.string(),phone:v.exactOptional(pair) }))}))}),sections.get('ui/level')??{}).manifest;
    const {admission,...header}=metadata;
    const runtimeFields=index.runtime===null?null:v.parse(v.object({kind:v.literal('client-plan'),cost:v.exactOptional(v.unknown()),binds:v.exactOptional(v.unknown())}),index.runtime);
    const source={...header,...admission,runtime:runtimeFields,...(manifest===undefined?{}:{manifest})};
    const total=(tier:'phone'|'desktop'):number=>{
      const steps=entryFileSteps(source,tier,{index:{files:index.files},sections});
      let result=steps.next();while(result.done!==true)result=steps.next();
      const inactive=result.value;
      return full[1]-index.files.reduce((sum,file)=>sum+(inactive.has(file.hash)?file.compressed:0),0);
    };
    rows[prefix]=[full[0],full[1],total('phone'),total('desktop')];
  }
  return rows;
}
