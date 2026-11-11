import {createHash} from 'node:crypto';
import {readTar} from '@wildshard/format/tar';
import {assembleOutputShardfile,parseOutputIndex} from '@wildshard/format/outputIndex';
import {serverRows} from '../src/cook/game/shardCook';

/** Validate the actual server-only artifact against today's reader inventory.
 * The original complete index is retained in a slice; no art body is needed. */
export function checkSlice(bytes:Uint8Array,slug:string):void {
  try {
    const files=readTar(bytes);
    const read=(path:string):Uint8Array=>{const body=files.get(path);if(body===undefined)throw new Error(`missing ${path}`);return body;};
    const hash=(body:Uint8Array):string=>createHash('sha256').update(body).digest('hex');
    const header=read('shard.json'),raw:unknown=JSON.parse(new TextDecoder().decode(header)),index=parseOutputIndex(raw);
    const sections=new Map<string,unknown>();
    for(const row of index.sections) {
      const body=read(row.path);
      if(body.length!==row.bytes||hash(body)!==row.hash)throw new Error(`changed ${row.path}`);
      sections.set(row.name,JSON.parse(new TextDecoder().decode(body)));
    }
    const source=assembleOutputShardfile(raw,sections);
    const rows=serverRows({slug:index.identity.slug,index,source,sections,header,read,cook:undefined,preparation:'none'});
    const wanted=new Set(rows.map(row=>row.path));
    for(const row of rows) {
      const body=read(row.path);
      if(body.length!==row.bytes||hash(body)!==row.hash)throw new Error(`changed ${row.path}`);
    }
    for(const path of files.keys())if(!path.endsWith('/')&&!wanted.has(path))throw new Error(`unexpected ${path}`);
  } catch(error) {
    throw new Error(`${slug}: stale server slice; re-cut with node scripts/pins.ts slice`,{cause:error});
  }
}
