import {SHARDFILE_ADMISSION_LIMITS as limits} from '@wildshard/format/admissionLimits';
import {readOutputDownloadIndex,type OutputDownloadIndex} from '@wildshard/format/outputDownload';
import {readContentResponse} from '@wildshard/engine/boot/readContentResponse';
import {contentHash} from '../../../shared/game/shardfile/contentHash';
import {yieldTask} from '@wildshard/engine/core/workSlice';
import {readCheckedOutputIndex} from '../../../shared/game/shardfile/outputIndexChecks';

export interface PrefetchIndexRequest {readonly url:string;readonly indexHashes:readonly string[]|null;readonly phone:boolean}
/** Strict Node author controls may inject their byte fixture; browsers do not. */
export interface PrefetchIndexAuthorCache {get:(hash:string)=>Promise<Uint8Array|null>;put:(hash:string,bytes:Uint8Array,keep:boolean)=>Promise<boolean>}

/** Index decode and phone admission run together off the page. Only the small
 * download schedule returns; complete source/receipt/section objects stay here. */
export async function preparePrefetchIndex(request:PrefetchIndexRequest, authorCache?: PrefetchIndexAuthorCache,
  nativeRead?: (url: string, bytes: number | undefined, hash?: string) => Promise<Uint8Array>):Promise<OutputDownloadIndex|null> {
  const version = new URL(request.url).searchParams.get('v');
  const known = version === null ? [] : request.indexHashes?.filter(hash => hash.slice(0, 8) === version) ?? [];
  const read=async(path:string,maximum:number):Promise<Uint8Array>=>{
    if(!Number.isSafeInteger(maximum)||maximum<0||maximum>32*1024*1024)throw new Error('Invalid prefetch body size');
    return nativeRead === undefined ? readContentResponse(await fetch(path),maximum) : nativeRead(path, undefined, known[0]);
  };
  const bytes=await read(request.url,limits.sourceBytes);
  if(request.indexHashes!==null&&(nativeRead===undefined ? !request.indexHashes.includes(await contentHash(bytes)) : known.length!==1))return null;
  const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const index=request.indexHashes===null?await readCheckedOutputIndex(input):readOutputDownloadIndex(input);
  if(!request.phone||request.indexHashes===null)return index;
  const [{isBuildValidatedOutput,resolveOutputDescriptor},{tierProductFilesPaced}]=await Promise.all([
    import('../../../shared/game/shardfile/outputDescriptor'),import('../shardfile/productCost'),
  ]);
  const base=new URL('.',request.url).href;
  const digest = nativeRead === undefined ? await contentHash(bytes) : known[0]; if (digest === undefined) return null;
  const source=await resolveOutputDescriptor(input,{offline:false,firstParty:true,hash:contentHash,
    ...(nativeRead === undefined ? {} : { built: { indexHash: digest, read: (path: string, size: number, hash?: string) => nativeRead(new URL(path, base).href, size, hash) } }),
    pause:yieldTask,
    read:(path,maximum)=>read(new URL(path,base).href,maximum),
    pack:(path,maximum)=>read(new URL(path,base).href,maximum),
    ...(authorCache === undefined ? {} : { cached: (hash: string) => authorCache.get(hash), store: (hash: string, body: Uint8Array) => authorCache.put(hash, body, true) })});
  if(!isBuildValidatedOutput(source))return index;
  const kept=new Set((await tierProductFilesPaced(source,'phone',yieldTask)).map(file=>file.hash));
  return {...index,files:index.files.filter(file=>kept.has(file.hash))};
}
