// Sweep metadata comes from the actual served product, not author source trees.
import * as v from 'valibot';
import {pathToFileURL} from 'node:url';

const versionSchema=v.object({build:v.pipe(v.string(),v.regex(/^[a-f0-9]{7,40}-.+$/u))});
const identities=v.pipe(v.array(v.object({slug:v.pipe(v.string(),v.regex(/^[a-z0-9_]+(?:-[a-z0-9_]+)*$/u))})),v.minLength(1),v.maxLength(256));
const catalogueSchema=v.object({shards:identities,placements:identities,grid:v.object({cells:identities})});
/** @param {string} base @param {string} revision */
export async function readSweepTarget(base,revision){
  if(!/^[a-f0-9]{7,40}$/u.test(revision))throw new Error('Sweep target needs an exact source revision');
  const origin=new URL(base);if(!['http:','https:'].includes(origin.protocol))throw new Error('Invalid sweep target protocol');
  /** @param {string} path */
  const read=async path=>{
    const response=await fetch(new URL(path,origin),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Sweep target metadata refused: ${path} HTTP ${response.status}`);
    return response.json();
  };
  const version=v.parse(versionSchema,await read('/version.json'));
  if(!version.build.startsWith(revision.slice(0,7)))throw new Error('Sweep target source differs from requested revision');
  const catalogue=v.parse(catalogueSchema,await read('/catalogue.json'));
  const slugs=new Set(catalogue.shards.map(row=>row.slug));
  if(slugs.size!==catalogue.shards.length)throw new Error('Sweep target catalogue has duplicate shard identities');
  for(const row of [...catalogue.placements,...catalogue.grid.cells])slugs.add(row.slug);
  const after=v.parse(versionSchema,await read('/version.json'));
  if(after.build!==version.build)throw new Error('Sweep target changed during catalogue read');
  return{build:version.build,slugs};
}
/** Bind each opened document, including a service-worker answer, to the metadata build.
 * @param {import('playwright').Page} page @param {string} expected */
export async function requireSweepDocumentBuild(page,expected){
  await page.waitForFunction(()=>typeof Reflect.get(globalThis,'__WS_BUILD_ID__')==='string');
  const actual=await page.evaluate(()=>Reflect.get(globalThis,'__WS_BUILD_ID__'));
  if(actual!==expected)throw new Error('Sweep document build differs from its catalogue metadata');
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [base,revision]=process.argv.slice(2);
  if(base===undefined||revision===undefined)throw new Error('Usage: target.mjs URL SOURCE_SHA');
  const result=await readSweepTarget(base,revision);console.log(JSON.stringify({build:result.build,slugs:[...result.slugs]}));
}
