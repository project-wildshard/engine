// Q37: only publication contacts api-server. The running game reads this immutable R2 copy.
import {createHash} from 'node:crypto';
import {GetObjectCommand,PutObjectCommand,S3ServiceException} from '@aws-sdk/client-s3';
import {MAX_ITEM_CATALOGUE_BYTES,platformItemCatalogueBytes} from '../../src/shared/game/loot/platformCatalogue.ts';

/** @typedef {NonNullable<import('../../src/shared/host/releaseRows.ts').ReleaseFile['items']>} ItemReference */
/** @param {Uint8Array} body */
export const itemDigest=body=>createHash('sha256').update(body).digest('hex');
/** @param {Uint8Array} body @param {ItemReference} reference */
export const itemBytesMatch=(body,reference)=>body.byteLength===reference.bytes&&itemDigest(body)===reference.sha256;

/** Read the catalogue the next release will sign. @param {typeof fetch} [read] */
export async function fetchItemCatalogue(read=fetch){
  const response=await read('https://api.wildshard.io/api/items.json',{cache:'no-store',signal:AbortSignal.timeout(30_000)});
  if(!response.ok)throw new Error(`Item catalogue answered ${response.status}`);
  const text=await response.text();
  if(new TextEncoder().encode(text).byteLength>MAX_ITEM_CATALOGUE_BYTES)throw new Error('Item catalogue is too large');
  return platformItemCatalogueBytes(JSON.parse(text));
}

/** Copy admitted, canonical API bytes before signing any channel. A hash-named object is never overwritten.
 * @param {import('@aws-sdk/client-s3').S3Client} client @param {string} bucket @param {typeof fetch} [read] @returns {Promise<ItemReference>} */
export async function copyItemCatalogue(client,bucket,read=fetch){
  const body=await fetchItemCatalogue(read),sha256=itemDigest(body),reference={path:`assets/catalogue/items-${sha256}.json`,sha256,bytes:body.byteLength};
  try{await client.send(new PutObjectCommand({Bucket:bucket,Key:reference.path,Body:body,ContentType:'application/json',CacheControl:'public,max-age=31536000,immutable',IfNoneMatch:'*'}));}
  catch(error){
    if(!(error instanceof S3ServiceException&&error.$metadata.httpStatusCode===412))throw error;
    const existing=await client.send(new GetObjectCommand({Bucket:bucket,Key:reference.path}));
    const kept=await existing.Body?.transformToByteArray();
    if(kept===undefined||!itemBytesMatch(kept,reference))throw new Error('Existing item catalogue hash mismatch',{cause:error});
  }
  return reference;
}
