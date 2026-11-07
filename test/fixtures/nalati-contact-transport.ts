import {base64Bytes,unshuffleLanes} from '../../src/client/engine/core/deflate';
import {nameBlob,type NamedBlob} from '../../src/sharddev/blobs';
import {encodeCanonicalJson} from '../../src/shared/host/immutable';
import {SceneDressingSchema,type SceneDressingRows} from '@wildshard/format/sceneDressing';
import * as v from 'valibot';
import {unzlibSync} from 'fflate';

/** Verify the complete raw cloth and metadata before restoring its original
 * transport; unrelated documents and contact loans remain byte-exact. */
export function originalDressingClothTransport(blobs:readonly NamedBlob[],originals:ReadonlyMap<string,SceneDressingRows>):NamedBlob[]{
  const files=new Map(blobs.map(row=>[row.file.name,row])),used=new Set<string>(),addresses=new Set<string>();
  const output=blobs.filter(row=>!row.file.name?.startsWith('world/dressing-cloth/')).map(blob=>{
    const before=blob.file.name===undefined?undefined:originals.get(blob.file.name);if(before===undefined)return blob;
    const scene=v.parse(SceneDressingSchema,JSON.parse(new TextDecoder().decode(blob.bytes)));
    const oldCloth=before.geometry['cloth'],cloth=scene.geometry['cloth'];
    if(oldCloth?.kind==='inline'){
      if(cloth?.kind!=='baked-file')throw new Error('Expected named cloth loan');
      const {kind:_beforeKind,data,...metadata}=oldCloth,{kind:_kind,file,address,...actual}=cloth,loan=files.get(file),raw=unzlibSync(base64Bytes(data)),offset=files.get(address.file)?.bytes;
      if(encodeCanonicalJson(metadata)!==encodeCanonicalJson(actual)||loan===undefined||offset===undefined||address.word*4!==offset.byteLength-4
        ||new DataView(offset.buffer,offset.byteOffset,offset.byteLength).getUint32(address.word*4,true)!==0)throw new Error('Original cloth metadata or address changed');
      const decoded=unshuffleLanes(unzlibSync(loan.bytes));
      if(decoded.length!==raw.length||!decoded.every((byte,at)=>byte===raw[at]))throw new Error('Original cloth bytes changed');
      used.add(file);addresses.add(address.file);scene.geometry['cloth']=oldCloth;
    }
    return nameBlob(blob.file.name??'','json',new TextEncoder().encode(encodeCanonicalJson(scene)),
      blob.file.jsonSchema===undefined?{}:{jsonSchema:blob.file.jsonSchema});
  });
  if(blobs.filter(row=>row.file.name?.startsWith('world/dressing-cloth/')).some(row=>!used.has(row.file.name??'')))throw new Error('Unvisited cloth publication');
  return output.map(blob=>addresses.has(blob.file.name??'')?nameBlob(blob.file.name??'','bin',blob.bytes.subarray(0,-4),
    {decoded:blob.file.decoded-4,critical:blob.file.critical,dependencies:blob.file.dependencies}):blob);
}

/** QF26: the river pebbles' layer draws on its own painterly 'pebble' material; its predecessor named 'rock', which the
 * statics' textured rock specimen (the fences) overwrote. The predecessor scene has no 'pebble' row and the layer back on
 * 'rock'; every other byte is unchanged. */
export function originalPebbleMaterial(blobs:readonly NamedBlob[]):NamedBlob[]{
  return blobs.map(blob=>{
    if(blob.file.name!=='world/dressing-phone.json'&&blob.file.name!=='world/dressing-desktop.json')return blob;
    const scene=v.parse(SceneDressingSchema,JSON.parse(new TextDecoder().decode(blob.bytes)));
    if(scene.materials['pebble']===undefined)return blob;
    const {pebble:_pebble,...materials}=scene.materials;
    const layers=scene.layers.map(row=>row.material==='pebble'?{...row,material:'rock'}:row);
    return nameBlob(blob.file.name??'','json',new TextEncoder().encode(encodeCanonicalJson({...scene,materials,layers})),
      blob.file.jsonSchema===undefined?{}:{jsonSchema:blob.file.jsonSchema});
  });
}

/** Check every named contact loan against its original complete inline row,
 * then reconstruct only binary transport for the unchanged full-wire pins. */
export function originalDressingContactTransport(blobs:readonly NamedBlob[],originals:ReadonlyMap<string,SceneDressingRows>):NamedBlob[]{
  const prepared=originalDressingClothTransport(originalPebbleMaterial(blobs),originals),files=new Map(prepared.map(row=>[row.file.name,row])),used=new Set<string>();
  const output=prepared.filter(row=>!row.file.name?.startsWith('world/dressing-contacts/')).map(blob=>{
    const before=blob.file.name===undefined?undefined:originals.get(blob.file.name);if(before===undefined)return blob;
    const scene=v.parse(SceneDressingSchema,JSON.parse(new TextDecoder().decode(blob.bytes)));
    const sources=[...before.layers,...before.statics.flatMap(row=>row.members)],targets=[...scene.layers,...scene.statics.flatMap(row=>row.members)];
    if(sources.length!==targets.length)throw new Error('Contact row inventory changed');
    for(const [index,source]of sources.entries()){
      const old=source.contacts,target=targets[index];if(target===undefined)throw new Error('Missing contact row');
      if(Array.isArray(old)||!('data'in old))continue;
      const row=target.contacts;if(Array.isArray(row)||!('file'in row))throw new Error('Expected named contact loan');
      const {data,...metadata}=old,{file,...actual}=row,loan=files.get(file),bytes=base64Bytes(data);
      if(encodeCanonicalJson(metadata)!==encodeCanonicalJson(actual)||loan===undefined||loan.bytes.length!==bytes.length
        ||!loan.bytes.every((byte,at)=>byte===bytes[at]))throw new Error('Original contact bytes or metadata changed');
      used.add(file);target.contacts=old;
    }
    return nameBlob(blob.file.name??'', 'json',new TextEncoder().encode(encodeCanonicalJson(scene)),
      blob.file.jsonSchema===undefined?{}:{jsonSchema:blob.file.jsonSchema});
  });
  if(prepared.filter(row=>row.file.name?.startsWith('world/dressing-contacts/')).some(row=>!used.has(row.file.name??'')))throw new Error('Unvisited contact publication');
  return output;
}
