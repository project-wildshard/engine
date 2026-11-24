import {readFileSync} from 'node:fs';
import {BufferAttribute,Float16BufferAttribute,MeshBasicMaterial,type BufferGeometry,type InterleavedBufferAttribute,type MeshStandardMaterial,type Matrix4,type Color} from 'three';
import {sha256} from '../../../src/shared/game/plugin/moduleHash';
import {parse,object,string,number,array} from 'valibot';
import manifestJson from './glb/manifest.json' with {type:'json'};
const manifest=parse(object({entries:array(object({inputSha256:string(),bytes:number(),sha256:string()}))}),manifestJson);
const pins=new Map(manifest.entries.map(pin=>[pin.inputSha256,pin]));
// Keep native fixture URLs out of Vite's browser asset-URL rewrite.
const fixtureModuleUrl=import.meta.url;
const fixtureRoot=new URL('./glb/',fixtureModuleUrl);

type Json=string|number|boolean|null|readonly Json[]|{readonly [key:string]:Json};
interface Primitive {
  geometry:BufferGeometry;material:MeshBasicMaterial|MeshStandardMaterial;
  instances?:readonly Matrix4[];instanceColours?:readonly Color[];transform?:Matrix4;pose?:Matrix4;
  name?:string;castShadow?:boolean;exactInstances?:true;nativeOnce?:true;nativeAttributes?:true;compactIndex?:true;quantizedChannels?:true;meshoptReady?:true;
  customAttributes?:Readonly<Record<string,string>>;extras?:Readonly<Record<string,Json>>;
}
function attribute(value:BufferAttribute|InterleavedBufferAttribute|null):unknown {
 if(value===null)return null;
 const array=value.array;
 if(value.count!==(value instanceof BufferAttribute?array.length/value.itemSize:value.data.count))throw new Error("Frozen GLB fixtures require ordinary attribute extents");
 return {storage:array.constructor.name,bytes:Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('base64'),
  itemSize:value.itemSize,normalized:value.normalized,half:value instanceof Float16BufferAttribute,
  ...(value instanceof BufferAttribute?{}:{stride:value.data.stride,offset:value.offset})};
}
/** Content only: no random Three UUIDs or executable SDK producer enters a reader test. */
export function glbSnapshotInput(primitives:readonly Primitive[],name='baked') {
 return {name,primitives:primitives.map(value=>{
  const {geometry,material,instances,instanceColours,transform,pose,...options}=value;
  if(material.map!==null||material.alphaMap!==null||(!(material instanceof MeshBasicMaterial)&&(material.normalMap!==null||material.roughnessMap!==null||material.metalnessMap!==null)))throw new Error('Frozen GLB fixtures require external texture declarations');
  return {options,geometry:{attributes:Object.entries(geometry.attributes).map(([key,a])=>[key,attribute(a)]),index:attribute(geometry.index)},
   material:{basic:material instanceof MeshBasicMaterial,name:material.name,color:material.color.toArray(),opacity:material.opacity,side:material.side,transparent:material.transparent,alphaTest:material.alphaTest,
    ...(material instanceof MeshBasicMaterial?{}:{metalness:material.metalness,roughness:material.roughness,emissive:material.emissive.toArray(),emissiveIntensity:material.emissiveIntensity})},
   instances:instances?.map(m=>m.elements),instanceColours:instanceColours?.map(c=>c.toArray()),transform:transform?.elements,pose:pose?.elements};
 })};
}
function tagged(value:unknown):unknown {
 if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];
 if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
 if(value===null)return ['null'];
 if(value===undefined)return ['undefined'];
 if(Array.isArray(value))return ['array',value.map(tagged)];
 if(typeof value==='object')return ['object',Object.entries(value).map(([key,item])=>[key,tagged(item)])];
 throw new Error('Unsupported frozen GLB input');
}
export function glbSnapshotKey(primitives:readonly Primitive[],name='baked'):string {
 return sha256(new TextEncoder().encode(JSON.stringify(tagged(glbSnapshotInput(primitives,name)))));
}
/** A source-keyed immutable fixture; unknown input never silently reuses another GLB. */
export function staticGlb(primitives:readonly Primitive[],name='baked'):Uint8Array {
 const key=glbSnapshotKey(primitives,name),pin=pins.get(key);
 if(pin===undefined)throw new Error('Unknown frozen GLB input');
 const bytes=new Uint8Array(readFileSync(new URL(`${key}.glb`,fixtureRoot)));
 if(bytes.length!==pin.bytes||sha256(bytes)!==pin.sha256)throw new Error('Frozen GLB bytes differ');
 return bytes;
}
