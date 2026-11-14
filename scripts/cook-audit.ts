import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {folderStore} from '../src/cook/game/packStore';
import type {CookIndex} from '../src/cook/game/cookWorker';
import {readSpawnManifest} from '../src/shared/game/shardfile/spawnManifest';
import {cookRevision,type CookRevision} from './cook-revision';

interface ManifestAudit {tier:string;set:string;hash:string;raw:number;wire:number;parts:{url:string;bytes:number;hash:string}[]}
interface FolderAudit {slug:string;shardfile:string;manifests:ManifestAudit[]}
export interface CookAudit {version:1;cook:CookRevision;products:FolderAudit[]}

/** Read the actual served manifests and compressed bodies, not a serialization of private cook state. */
export async function auditCook(receiptFile:string):Promise<CookAudit> {
  const receipt=JSON.parse(readFileSync(receiptFile,'utf8')) as {cook?:CookRevision;store:string;heads:{slug:string;hash:string}[];indexes:CookIndex[]};
  if(receipt.cook===undefined)throw new Error('Cook receipt has no source revision; run ring-cook again');
  const store=folderStore(receipt.store),products:FolderAudit[]=[];
  const hash=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
  const read=async(key:string):Promise<Uint8Array>=>{const body=await store.get(key);if(body===undefined)throw new Error(`Cook has no ${key}`);return body;};
  for(const index of receipt.indexes) {
    if(!receipt.heads.some(head=>head.hash===index.hash))throw new Error('Cook differs from its pinned input');
    const manifests:ManifestAudit[]=[];
    for(const row of index.manifests) {
      const bytes=await read(row.url.slice(1)),manifest=readSpawnManifest(JSON.parse(new TextDecoder().decode(bytes)));
      const parts=[];
      for(const part of manifest.parts??[]) {
        const body=await read(part.url.slice(1));
        parts.push({url:part.url,bytes:body.length,hash:hash(body)});
      }
      manifests.push({tier:row.tier,set:row.set,hash:hash(bytes),raw:manifest.totalBytes,wire:manifest.wireBytes??0,parts});
    }
    products.push({slug:index.slug,shardfile:index.hash,manifests});
  }
  return {version:1,cook:receipt.cook,products};
}

/** A report, not a new gate. Deliberate representation changes remain reviewable by tier, parts and bytes. */
export function reportCook(audit:CookAudit,baselineFile=resolve('test/pins/cooked.json')):void {
  const previous=existsSync(baselineFile)?JSON.parse(readFileSync(baselineFile,'utf8')) as CookAudit:undefined;
  console.log(`cook revision ${audit.cook.revision}; baseline ${previous?.cook.revision??'unrecorded'}`);
  for(const product of audit.products)for(const manifest of product.manifests) {
    const before=previous?.products.find(row=>row.slug===product.slug)?.manifests.find(row=>row.tier===manifest.tier&&row.set===manifest.set);
    const old=new Set(before?.parts.map(row=>row.hash)),current=new Set(manifest.parts.map(row=>row.hash));
    const added=[...current].filter(hash=>!old.has(hash)).length,removed=[...old].filter(hash=>!current.has(hash)).length;
    console.log(`${product.slug} ${manifest.tier}/${manifest.set}: ${manifest.hash===before?.hash?'same':'CHANGED'}; raw ${manifest.raw} (${manifest.raw-(before?.raw??0)}); wire ${manifest.wire} (${manifest.wire-(before?.wire??0)}); parts +${added}/-${removed}`);
  }
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const receipt=process.argv[2];if(receipt===undefined)throw new Error('usage: cook-audit <receipt.json> [--record]');
  const audit=await auditCook(receipt);reportCook(audit);
  if(process.argv.includes('--record')) {
    if(audit.cook.revision!==cookRevision().revision)throw new Error('Cannot record a stale cook revision');
    writeFileSync('test/pins/cooked.json',`${JSON.stringify(audit,null,2)}\n`);
  }
}
