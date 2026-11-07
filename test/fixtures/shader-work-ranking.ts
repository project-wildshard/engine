import type {ShippedGraphCost} from './shipped-graph-costs';

/** Cost and coverage meet only at the exact compiled fragment-source identity. */
export interface ShaderWorkCost {readonly id:string;readonly fragmentShaderHash:string;readonly unconditional:number}
/** Mandatory graph work in an actual wrapped fragment program. The material
 * wrapper calls grade and its selected fog once. Vertex work and per-light
 * sun/ambient functions have different invocation counts and stay separate. */
export function emittedFragmentWork(rows:readonly Pick<ShippedGraphCost,'slug'|'graphHash'|'kind'|'fragmentShaderHashes'|'selectedFogGraphHash'|'execution'>[]):readonly ShaderWorkCost[]{
 const costs:ShaderWorkCost[]=[];
 for(const row of rows){
  const fog=row.selectedFogGraphHash===null?undefined:rows.find(candidate=>candidate.slug===row.slug&&candidate.graphHash===row.selectedFogGraphHash);
  if(row.selectedFogGraphHash!==null&&(fog?.kind!=='fog'||fog.execution.fog===null))throw new Error('Emitted fragment work requires its admitted fog');
  for(const stage of ['main','outline'] as const){
   const fragmentShaderHash=row.fragmentShaderHashes[stage];if(fragmentShaderHash===null)continue;
   const program=row.execution[stage];if(program===null)throw new Error('Emitted fragment identity has no execution report');
   costs.push({id:`${row.slug}:${stage}:${row.graphHash}`,fragmentShaderHash,
    unconditional:program.fragment.unconditional+program.grade.unconditional+(fog?.execution.fog?.fog.unconditional??0)});
  }
 }
 return costs;
}
export interface ShaderPixelFact {
 readonly id:string;readonly capture:string;readonly name:string;readonly fragmentShaderHash:string;
 readonly pixels:number;readonly kind:'fullscreen'|'colour-sample-proxy';readonly saturatedPixels:number;
}
export interface RankedShaderWork {
 readonly fragmentShaderHash:string;readonly programs:readonly string[];readonly capture:string;readonly names:readonly string[];
 readonly pixels:number;readonly unconditionalWork:number;readonly proxy:boolean;readonly saturatedPixels:number;
}
/** Rank each program's largest observed work, not the sum of unrelated poses.
 * Colour-sample proxies remain labelled, and saturation is never exact work.
 * allFactsMatched concerns supplied facts only; it is not whole-scene coverage. */
export function rankShaderWork(costs:readonly ShaderWorkCost[],facts:readonly ShaderPixelFact[]):{
 readonly rows:readonly RankedShaderWork[];readonly unmatched:readonly ShaderPixelFact[];readonly allFactsMatched:boolean;
 readonly usesProxy:boolean;readonly hasSaturation:boolean;
}{
 const validHash=(value:string):boolean=>/^[a-f0-9]{64}$/u.test(value);
 const byHash=new Map<string,{ids:Set<string>;unconditional:number}>();
 for(const cost of costs){
  if(cost.id.length===0||!validHash(cost.fragmentShaderHash)||!Number.isSafeInteger(cost.unconditional)||cost.unconditional<0)throw new Error('Invalid emitted shader work');
  const known=byHash.get(cost.fragmentShaderHash);
  if(known!==undefined){
   if(known.unconditional!==cost.unconditional)throw new Error('Ambiguous cost for the same shader source');
   known.ids.add(cost.id);
  }else byHash.set(cost.fragmentShaderHash,{ids:new Set([cost.id]),unconditional:cost.unconditional});
 }
 const seen=new Set<string>(),unmatched:ShaderPixelFact[]=[];
 const captures=new Map<string,{fragmentShaderHash:string;programs:string[];capture:string;names:string[];pixels:number;unconditionalWork:number;proxy:boolean;saturatedPixels:number}>();
 for(const fact of facts){
  if(fact.id.length===0||fact.capture.length===0||fact.name.length===0||!validHash(fact.fragmentShaderHash)
    ||!Number.isFinite(fact.pixels)||fact.pixels<0||fact.pixels>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(fact.saturatedPixels)||fact.saturatedPixels<0
    ||!['fullscreen','colour-sample-proxy'].includes(fact.kind)||fact.kind==='fullscreen'&&fact.saturatedPixels!==0)throw new Error('Invalid measured shader coverage');
  const identity=JSON.stringify([fact.capture,fact.id]);if(seen.has(identity))throw new Error('Duplicate coverage observation');seen.add(identity);
  const cost=byHash.get(fact.fragmentShaderHash);if(cost===undefined){unmatched.push(fact);continue;}
  const key=JSON.stringify([fact.capture,fact.fragmentShaderHash]);
  const row=captures.get(key)??{fragmentShaderHash:fact.fragmentShaderHash,programs:[...cost.ids].sort(),capture:fact.capture,names:[],pixels:0,unconditionalWork:0,proxy:false,saturatedPixels:0};
  row.names.push(fact.name);row.pixels+=fact.pixels;row.unconditionalWork+=cost.unconditional*fact.pixels;
  row.proxy ||= fact.kind==='colour-sample-proxy';row.saturatedPixels+=fact.saturatedPixels;
  if(!Number.isFinite(row.unconditionalWork)||row.unconditionalWork>Number.MAX_SAFE_INTEGER||row.pixels>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(row.saturatedPixels))throw new Error('Shader work exceeds report precision');
  captures.set(key,row);
 }
 const worst=new Map<string,RankedShaderWork>();
 for(const row of captures.values()){
  const prior=worst.get(row.fragmentShaderHash);
  if(prior===undefined||row.unconditionalWork>prior.unconditionalWork)worst.set(row.fragmentShaderHash,row);
 }
 return {rows:[...worst.values()].sort((a,b)=>b.unconditionalWork-a.unconditionalWork||a.fragmentShaderHash.localeCompare(b.fragmentShaderHash)),unmatched,allFactsMatched:unmatched.length===0,
  usesProxy:facts.some(fact=>fact.kind==='colour-sample-proxy'),hasSaturation:facts.some(fact=>fact.saturatedPixels>0)};
}
