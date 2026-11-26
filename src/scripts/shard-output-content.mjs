// P4 structural columns use only the emitted index and verified sections.
import {relative,resolve} from 'node:path';
import {createOutputReader} from './output-reader.mjs';
import {representativeFolder} from './shard-outputs.mjs';

/** Private binaries are opaque bin blobs without a platform decoder declaration.
 * This is structural evidence, never a visual/behaviour compatibility verdict.
 * @param {string} root @param {string} slug @param {string} products
 * @param {import('./output-reader.mjs').OutputReader} reader */
export function outputContent(root,slug,products,reader=createOutputReader(root,products)) {
  const output=reader.sections(slug);
  const indexPath=relative(root,resolve(products,representativeFolder(root,slug),'shard.json')).replaceAll('\\','/');
  const source=reader.source(slug);
  const decoded=new Set([
    ...source.meshCollision?.tiles.map(row=>row.file)??[],
    ...source.meshCollision?.panels.map(row=>row.file)??[],
    ...source.terrain?.tiles.map(row=>row.file)??[],
    source.terrain?.collider,source.terrain?.sampling?.file,source.navigation?.file,source.look.grade.lut,
  ]);
  const privateFiles=output.index.files.filter(row=>row.kind==='bin'&&!decoded.has(row.hash));
  const privateBinaries=privateFiles.map(row=>row.path);
  const tiles={total:source.tiles.length,l0:source.tiles.filter(row=>row.lod===0).length,l1:source.tiles.filter(row=>row.lod===1).length};
  const issues=tiles.total===0?['no render tiles']:[];
  if(privateFiles.length>0)issues.push('private binary content remains');
  return {status:'built',product:indexPath,privateBinaries,privateBinaryBytes:privateFiles.reduce((sum,row)=>sum+row.compressed,0),tiles,
    gate:{enforcement:'report-only',status:issues.length===0?'candidate':'incomplete',issues}};
}
