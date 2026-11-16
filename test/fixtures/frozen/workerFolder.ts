import {parse,object,string,array,tuple,unknown} from 'valibot';
import {parseShardfile,type Shardfile} from '@wildshard/format/shardSchema';
import {sha256} from '../../../src/shared/game/plugin/moduleHash';
import {frozenRuntimeJson} from './snapshots';
const pin=parse(object({inputSha256:string(),shard:unknown(),assets:array(tuple([string(),string()]))}),frozenRuntimeJson('decision-worker-folder.json'));
/** Exact SDK fixture output; engine still runs its actual native worker and admission. */
export function frozenDecisionWorkerFolder(input:Shardfile,moduleBytes:Uint8Array):{shard:Shardfile;assets:Map<string,Uint8Array>}{
 if(sha256(new TextEncoder().encode(JSON.stringify(input)))!==pin.inputSha256)throw new Error('Frozen worker fixture source differs');
 const assets=new Map(pin.assets.map(([hash,encoded])=>{
  const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
  if(sha256(bytes)!==hash)throw new Error('Frozen worker fixture bytes differ');
  return [hash,bytes] as const;
 }));
 const original=assets.get(sha256(moduleBytes));
 if(original===undefined||original.length!==moduleBytes.length)throw new Error('Frozen worker fixture module differs');
 return {shard:parseShardfile(structuredClone(pin.shard)),assets};
}
