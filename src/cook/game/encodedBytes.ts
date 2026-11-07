/// <reference types="node" />
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash,randomBytes} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {homedir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {fileURLToPath} from 'node:url';
import {encodePortableBytes} from './portableEncode';

const hash=(bytes:string|Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
// Raw encoder and dependency bytes, including local patches, own the transform.
// The caller still certifies the decoded channels against its native geometry.
const codec=hash(JSON.stringify({schema:'portable-deflate/1',node:process.version,platform:process.platform,arch:process.arch,
  encoder:hash(readFileSync(new URL('portableEncode.ts',import.meta.url))),
  implementation:encodePortableBytes.toString(),
  fflate:hash(readFileSync(fileURLToPath(import.meta.resolve('fflate')))),level:9}));

/** Exact portable output memo, never a geometry/source validation receipt.
 * Its caller retains every original decode and native-word certification. */
export class PortableBytesCache {
  constructor(private readonly directory:string){}
  encode(input:Uint8Array):Uint8Array<ArrayBuffer>{
    // A cache cannot turn the portable encoder's refusal into a success.
    if(!(input instanceof Uint8Array)||!(input.buffer instanceof ArrayBuffer)||input.byteLength>256_000_000)return encodePortableBytes(input);
    const key=hash(`${codec}\0${input.byteLength}\0${hash(input)}`),metadata=resolve(this.directory,`${key}.json`),body=resolve(this.directory,`${key}.bin`);
    try{
      const text=readFileSync(metadata,'utf8');if(text.length>512)throw new Error('Oversized portable memo');
      const saved:unknown=JSON.parse(text);
      if(typeof saved==='object'&&saved!==null&&'key' in saved&&saved.key===key&&'bytes' in saved
        &&typeof saved.bytes==='number'&&Number.isSafeInteger(saved.bytes)&&saved.bytes>=0&&saved.bytes<=257_000_000
        &&'hash' in saved&&typeof saved.hash==='string'&&/^[a-f0-9]{64}$/u.test(saved.hash)){
        const bytes=readFileSync(body);
        if(bytes.byteLength===saved.bytes&&hash(bytes)===saved.hash)return new Uint8Array(bytes);
      }
    }catch{ /* Missing, interrupted or corrupt pure transform: run its owner. */ }
    const encoded=encodePortableBytes(input),suffix=`.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try{
      mkdirSync(this.directory,{recursive:true});writeFileSync(body+suffix,encoded,{flag:'wx'});renameSync(body+suffix,body);
      writeFileSync(metadata+suffix,JSON.stringify({key,bytes:encoded.byteLength,hash:hash(encoded)}),{flag:'wx'});renameSync(metadata+suffix,metadata);
    }catch{ /* Optional cache storage cannot change build semantics. */ }
    finally{for(const file of [body+suffix,metadata+suffix])try{rmSync(file,{force:true});}catch{ /* Own temporary paths only. */ }}
    return encoded;
  }
}

/** The same CI-cached gen root as other deterministic build transforms. */
export const gridLookBytes:PortableBytesCache=new PortableBytesCache(process.env['WILDSHARD_PORTABLE_BYTES_CACHE']??resolve(homedir(),'.cache/wildshard/gen/portable-bytes/1'));
