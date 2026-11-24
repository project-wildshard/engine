import {parse,object,string,array,tuple,unknown} from 'valibot';
import {parseShardfile,type Shardfile} from '@wildshard/format/shardSchema';
import {sha256} from '../../../src/shared/game/plugin/moduleHash';
import {sdkBuiltJson} from './snapshots';
const pin=parse(object({inputSha256:string(),shard:unknown(),assets:array(tuple([string(),string()]))}),sdkBuiltJson('decision-worker-folder.json'));
/** Exact SDK fixture output; engine still runs its actual native worker and admission. */
export function frozenDecisionWorkerFolder(input:Shardfile,moduleBytes:Uint8Array):{shard:Shardfile;assets:Map<string,Uint8Array>}{
 // FP26 (format 0.1.0.4): the pin hashed the source as format 0.1.0.3 parsed it, `identity` in the order slug, name, author,
 // revision, seed; a newer parse spells the lineage saveRevision, after seed
 const identity:Record<string,unknown>={...input.identity},{saveRevision,seed,...head}=identity;
 const lineage=saveRevision===undefined?input:{...input,identity:{...head,revision:saveRevision,seed}};
 // FP4 (format 0.74.0): requires.capabilities is optional and today's parse leaves it out; the pin hashed it as an empty
 // list after sdk
 const {sdk,...rest}=lineage.requires as Record<string,unknown>;
 const written='capabilities' in lineage.requires?lineage:{...lineage,requires:{sdk,capabilities:[],...rest}};
 if(sha256(new TextEncoder().encode(JSON.stringify(written)))!==pin.inputSha256)throw new Error('Frozen worker fixture source differs');
 const assets=new Map(pin.assets.map(([hash,encoded])=>{
  const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
  if(sha256(bytes)!==hash)throw new Error('Frozen worker fixture bytes differ');
  return [hash,bytes] as const;
 }));
 const original=assets.get(sha256(moduleBytes));
 if(original===undefined||original.length!==moduleBytes.length)throw new Error('Frozen worker fixture module differs');
 return {shard:parseShardfile(structuredClone(pin.shard)),assets};
}
