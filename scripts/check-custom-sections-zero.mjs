// Z15: a closed zero, not a per-shard capacity that another private file can use.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** No future change can loosen this policy through a numeric ceiling edit.
 * @param {Readonly<Record<string,unknown>>} budgets @returns {string[]} */
export function zeroPolicyFailures(budgets) {
  const failures=[];
  if(!Object.hasOwn(budgets,'custom-sections/total')||budgets['custom-sections/total']!==0)failures.push('custom-sections/total must equal 0');
  for(const name of Object.keys(budgets))if(name.startsWith('custom-sections/')&&name!=='custom-sections/total')failures.push(`Retired custom-section ceiling: ${name}`);
  return failures;
}

/** The verified census still identifies every private named JSON, including
 * an unknown name with a forged shared-schema source comment.
 * @param {Readonly<Record<string,unknown>>} budgets
 * @param {Readonly<Record<string,{readonly customSections:readonly {readonly name:string;readonly bytes:number}[];readonly customSectionBytes?:number}>>} measures
 * @returns {string[]} */
export function customSectionsZeroFailures(budgets,measures) {
  const failures=zeroPolicyFailures(budgets);
  if(Object.keys(measures).length===0)failures.push('Zero custom-section census must include canonical products');
  for(const[slug,row]of Object.entries(measures)){
    for(const file of row.customSections)failures.push(`${slug}: custom-sections/total is 0; blocked by ${file.name} (${file.bytes} B)`);
    if(row.customSectionBytes!==undefined&&row.customSectionBytes!==row.customSections.reduce((sum,file)=>sum+file.bytes,0))failures.push(`${slug}: custom-section byte census differs from its files`);
  }
  return failures;
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const root=resolve(process.argv[2]??process.cwd());
  // Enumerate declared canonical projects/products rather than existing out/
  // directories: missing products refuse through the verified reader.
  const {outputSections}=await import('./shard-platform-output.mjs');
  const {execFileSync}=await import('node:child_process');
  const names=execFileSync('git',['ls-tree','-r','--name-only','HEAD','--','src/shards'],{cwd:root,encoding:'utf8'})
    .split('\n').flatMap(path=>/^src\/shards\/([^/]+)\/shard.config.ts$/u.exec(path)?.slice(1)??[]);
  const measures=Object.fromEntries(names.map(slug=>[slug,outputSections(root,slug)]));
  const policy=JSON.parse(readFileSync(resolve(root,'lint/ratchet.json'),'utf8'));
  const failures=customSectionsZeroFailures(policy.budgets??{},measures);
  for(const failure of failures)console.error(failure);
  process.exitCode=failures.length===0?0:1;
}
