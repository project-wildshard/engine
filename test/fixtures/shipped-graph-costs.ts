// oxlint-disable-next-line import/no-nodejs-modules -- The offline census reads only admitted content-addressed output files.
import {readFileSync,realpathSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Refuse files escaping the selected product.
import {resolve,sep} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Join measured programs to actual graph and lowered-code identities.
import {createHash} from 'node:crypto';
import {loadHeadlessFolder} from '../../src/server/host/headlessFolder';
import {outputDescriptor} from '../../src/shared/game/shardfile/outputDescriptor';
import {emitClassicGraph} from '../../src/client/engine/render/graph/glslProgram';
import {graphFragmentIdentity} from './graph-fragment-identity';
import {ToonLook} from '../../src/client/engine/render/families/toon';
import {familyPresetGraph,PRESET_GRAPH_BUDGET} from '../../src/client/engine/render/graph/presets';
import {presetLooks} from '@wildshard/format/materials';
import type {GraphBudget} from '@wildshard/format/materialGraph';
import type {GraphGlsl,GraphGlslProgram} from '../../src/client/engine/render/graph/glsl';

export interface ShippedGraphCost {
 readonly slug:string;
 readonly graphHash:string;
 readonly codeHash:string;
 /** Exact live ShaderMaterial source identity for the fullscreen post program. */
 readonly postFragmentShaderHash:string|null;
 /** Exact wrapped main/outline sources, including the selected admitted fog. */
 readonly fragmentShaderHashes:ReturnType<typeof graphFragmentIdentity>;
 /** Its cost is reported separately: a fog function is not a standalone draw. */
 readonly selectedFogGraphHash:string|null;
 readonly aliases:readonly string[];
 readonly kind:GraphGlsl['ir']['kind'];
 readonly admission:GraphGlsl['cost'];
 readonly execution:NonNullable<GraphGlsl['executionCost']>;
 readonly selects: {readonly main:GraphGlslProgram['selects']|null;readonly outline:GraphGlslProgram['selects']|null};
}
const hash=(bytes:string|Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
function graphLike(value:unknown):boolean{
 return typeof value==='object'&&value!==null&&'kind'in value&&['material','post','fog'].includes(String(value.kind))&&'nodes'in value&&'stages'in value;
}
/** All admitted JSON graphs, including library files and native inline rows,
 * plus the engine presets referenced by the material catalogue. No author
 * compilation, browser, renderer, guessed pixels or replaced admission. */
export async function shippedGraphCosts(directory:string):Promise<readonly ShippedGraphCost[]>{
 const root=realpathSync(directory),product=await loadHeadlessFolder(root),source=product.shardfile;
 const descriptor=outputDescriptor(source);if(descriptor===undefined)throw new Error('Graph census requires its verified output descriptor');
 const toonLook=new ToonLook(source.look.familyLooks.toon??{}),rows=new Map<string,ShippedGraphCost>(),lowered=new Map<string,GraphGlsl>();
 const aliases=new Map<string,string[]>(),required=new Set<string>();
 const alias=(key:string,name:string):void=>{aliases.set(key,[...(aliases.get(key)??[]),name]);};
 for(const [name,entry] of Object.entries(source.look.materials))if(entry.family==='graph'&&'file'in entry){required.add(entry.file);alias(entry.file,`look.materials.${name}`);}
 for(const [index,pass] of (source.look.post??[]).entries())if('file'in pass){required.add(pass.file);alias(pass.file,`look.post.${index}`);}
 const add=(input:unknown,key:string,names:readonly string[],budget?:GraphBudget):void=>{
  const prior=rows.get(key);
  if(prior!==undefined){rows.set(key,{...prior,aliases:[...new Set([...prior.aliases,...names])]});return;}
  const options={toonLook,trustedBudget:true,...(budget===undefined?{}:{budget})};
  const plain=emitClassicGraph(input,options),{executionCost,...emitted}=emitClassicGraph(input,{...options,reportExecutionCost:true});
  if(executionCost===undefined||JSON.stringify(emitted)!==JSON.stringify(plain))throw new Error('Graph reporting changed emitted code or admission');
  lowered.set(key,plain);
  rows.set(key,{slug:product.slug,graphHash:key,codeHash:hash(JSON.stringify({program:plain.program,outline:plain.outline,fog:plain.fog,libraries:plain.libraries,uniforms:plain.uniforms,attributes:plain.attributes})),postFragmentShaderHash:null,fragmentShaderHashes:{main:null,outline:null},selectedFogGraphHash:null,aliases:[...new Set(names)],kind:plain.ir.kind,admission:plain.cost,execution:executionCost,selects:{main:plain.program?.selects??null,outline:plain.outline?.selects??null}});
 };
 const visit=(value:unknown,name:string,key?:string):void=>{
  if(graphLike(value)){add(value,key??hash(JSON.stringify(value)),[...(key===undefined?[]:aliases.get(key)??[]),name]);return;}
  if(Array.isArray(value)){for(const [index,entry] of value.entries())visit(entry,`${name}[${index}]`);}
  else if(typeof value==='object'&&value!==null)for(const [field,entry] of Object.entries(value))visit(entry,`${name}.${field}`);
 };
 for(const file of descriptor.index.files){
  if(file.kind!=='json')continue;
  const path=realpathSync(resolve(root,file.path));if(!path.startsWith(root+sep))throw new Error('Graph file escapes its admitted product');
  const bytes=readFileSync(path);if(bytes.byteLength!==file.compressed||hash(bytes)!==file.hash)throw new Error('Graph file differs from its admitted bytes');
  const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  visit(data,file.name??file.path,file.hash);
 }
 const looks=presetLooks(source.look.familyLooks);
 for(const [name,entry] of Object.entries(source.look.materials))if(entry.family==='graph'){
  if('preset'in entry){const graph=familyPresetGraph(entry.preset,looks);add(graph,hash(JSON.stringify(graph)),[`look.materials.${name}:preset`],PRESET_GRAPH_BUDGET);}
  else if('graph'in entry)add(entry.graph,hash(JSON.stringify(entry.graph)),[`look.materials.${name}:inline`]);
 }
 for(const [index,pass] of (source.look.post??[]).entries())if('graph'in pass)add(pass.graph,hash(JSON.stringify(pass.graph)),[`look.post.${index}:inline`]);
 for(const key of required)if(!rows.has(key))throw new Error(`Declared graph ${key} was absent from the emitted census`);
 for(const [key,row] of rows){
  const glsl=lowered.get(key);if(glsl===undefined)throw new Error('Graph lowering was absent from the emitted census');
  const selected=glsl.ir.effectState?.fog;
  let fog:GraphGlsl|undefined,selectedFogGraphHash:string|null=null;
  if(typeof selected==='string'){
   const entry=source.look.materials[selected];
   if(entry?.family!=='graph'||'preset'in entry)throw new Error('Selected fog is absent from the admitted catalogue');
   selectedFogGraphHash='file'in entry?entry.file:hash(JSON.stringify(entry.graph));
   fog=lowered.get(selectedFogGraphHash);
   if(fog===undefined)throw new Error('Selected fog lowering is absent from the emitted census');
  }
  const fragmentShaderHashes=graphFragmentIdentity(glsl,toonLook,fog);
  rows.set(key,{...row,fragmentShaderHashes,selectedFogGraphHash,postFragmentShaderHash:row.kind==='post'?fragmentShaderHashes.main:null});
 }
 return [...rows.values()].sort((a,b)=>a.graphHash.localeCompare(b.graphHash));
}
