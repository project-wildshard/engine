import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { isJsonData } from '@wildshard/format/json';
import { BinarySourceSchema, BinarySourceBanksSchema, type BinarySourceRows, type BinarySourceBank } from '@wildshard/format/binarySource';

/** A product's existing verified reader; an empty request needs no file capability. */
export interface BinaryFileReader { readonly file?: (name:string)=>Promise<Uint8Array>;readonly hasFile?: (name:string)=>boolean }
const requestsSchema=v.pipe(v.unknown(),v.check(isJsonData),v.array(v.strictObject({source:BinarySourceSchema,
  bytes:v.pipe(v.number(),v.safeInteger(),v.minValue(0))})));
/** Preflight all file/count declarations before reading, and all returned lengths before a caller allocates resources.
 * Bytes belong to the caller's existing preparation; there is no cache or decoded template. */
export async function prepareBinarySources(product:BinaryFileReader,input:unknown,scope?:Scope,bankInput:unknown=[]):Promise<ReadonlyMap<string,Uint8Array>> {
  const alive=():void=>{if(scope?.disposed===true||scope?.disposing===true)throw new Error('Binary source owner retired');};
  alive();const requests=v.parse(requestsSchema,input);
  if(!isJsonData(bankInput))throw new Error('Binary banks require plain JSON data');
  const banks=v.parse(BinarySourceBanksSchema,bankInput);
  if(requests.some(({source})=>'data'in source))throw new Error('Binary sources require named files');
  const lengths=new Map<string,number>(),files=new Map<string,Uint8Array>();
  for(const {source,bytes} of requests)if('file'in source){
    const previous=lengths.get(source.file);if(previous!==undefined&&previous!==bytes)throw new Error('Conflicting binary source lengths');
    lengths.set(source.file,bytes);
  }
  const bankFor=new Map<string,BinarySourceBank>();
  for(const bank of banks){
    for(const member of bank.members)if(lengths.has(member.file)&&lengths.get(member.file)!==member.bytes)throw new Error('Binary bank member length differs');
    // An incomplete demand keeps its exact original reads; never fetch other
    // members merely because they share a bank with one requested file.
    if(bank.members.every(member=>lengths.has(member.file)))for(const member of bank.members)bankFor.set(member.file,bank);
  }
  if(lengths.size===0)return files;
  const reads=new Map<string,number>();
  for(const [file,length] of lengths){
    const bank=bankFor.get(file),name=bank?.file??file,bytes=bank?.bytes??length,previous=reads.get(name);
    if(previous!==undefined&&previous!==bytes)throw new Error('Conflicting binary bank lengths');
    reads.set(name,bytes);
  }
  const read=product.file,has=product.hasFile;
  const live=():void=>{alive();if(product.file!==read||product.hasFile!==has)throw new Error('Binary source reader changed');};
  if(read===undefined)throw new Error('Binary source requires its product reader');
  live();for(const file of new Set([...lengths.keys(),...reads.keys()]))if(has!==undefined&&!has.call(product,file))throw new Error(`Missing binary source ${file}`);
  // Four original reads overlap so adjacent named pack members can share one
  // demand range. Decoding/publication and refusal remain in authored order.
  const rows=[...reads],pending=new Map<number,Promise<Uint8Array>>(),bodies=new Map<string,Uint8Array>();
  try {
    for(const [index,[file]] of rows.entries()){
      for(let at=index;at<Math.min(rows.length,index+4);at++){
        if(pending.has(at))continue;
        const row=rows[at];if(row===undefined)throw new Error('Missing binary source request');
        const [name,length]=row;live();
        const work=(async()=>{
          const bytes=await read.call(product,name);live();
          if(!(bytes instanceof Uint8Array)||bytes.byteLength!==length)throw new Error(`Binary source byte count differs: ${name}`);
          return bytes;
        })();
        void work.catch(()=>undefined);pending.set(at,work);
      }
      const work=pending.get(index);if(work===undefined)throw new Error('Missing binary source read');
      const bytes=await work;live();bodies.set(file,bytes);pending.delete(index);
    }
  } finally {await Promise.allSettled(pending.values());}
  for(const file of lengths.keys()){
    live();const bank=bankFor.get(file),body=bodies.get(bank?.file??file);
    if(body===undefined)throw new Error(`Missing prepared binary source: ${file}`);
    if(bank===undefined){files.set(file,body);continue;}
    const member=bank.members.find(row=>row.file===file);
    if(member===undefined)throw new Error('Missing binary bank member');
    const bytes=new Uint8Array(body.subarray(member.offset,member.offset+member.bytes));
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    live();if(hash!==member.sha256)throw new Error(`Binary bank member hash differs: ${file}`);
    files.set(file,bytes);
  }
  live();return files;
}
/** Borrow one prepared raw file; inline content refuses before storage access. */
export function binarySourceBytes(input:BinarySourceRows,files:ReadonlyMap<string,Uint8Array>=new Map()):Uint8Array {
  const row=v.parse(BinarySourceSchema,input);if('data'in row)throw new Error('Binary sources require named files');
  const bytes=files.get(row.file);if(bytes===undefined)throw new Error(`Binary source was not prepared: ${row.file}`);return bytes;
}
