// Transport identity only. Generation and strict product admission remain authoritative.
import {appendFileSync,readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {InputHashMemo} from './bake-input-hashes.mjs';
import {generationPlan} from './gen-programs.mjs';
import {committedSourceFiles,sourceSnapshotIdentity,verifiedSourceSnapshot} from './source-input-proof.mjs';
import {readBuiltShardfile} from './built-folder.mjs';
import {readBuildKey,shardfileCacheRoot} from './shardfile-cache.mjs';

const hash=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Phase=v.object({inputs:v.record(v.string(),hash),outputs:v.record(v.string(),hash)});
const Receipt=v.object({buildKey:hash,indexHash:hash});
const digest=/** @param {Uint8Array|string} value */ value=>createHash('sha256').update(value).digest('hex');
// These two standalone Simulator/fixture programs never populate the five
// transported roots. Keep their raw bytes in the full phase admission below,
// but not in the transport identity. If an author ever reads either, its sealed
// product buildKey still binds that read. All other inputs remain conservative.
const nonGenerating=new Set(['scripts/sim-safari-ready.py','scripts/test_sim_lane.py']);

/** Select only complete current products and the verified compiler/generator inputs.
 * Missing, crossed or incomplete evidence retains the old save, never a false hit.
 * @param {string} sourceRoot @param {string} fallback
 * @param {{cacheRoot?:string,env?:NodeJS.ProcessEnv}} [options]
 * @returns {{key:string,qualified:boolean,products:number,reason:string}} */
export function preparationCacheKey(sourceRoot,fallback,{cacheRoot=shardfileCacheRoot(),env=process.env}={}) {
  if(!/^preparation-v3-[A-Za-z0-9_-]+-node24-[a-f0-9]{40}$/u.test(fallback))throw new Error('Invalid preparation fallback key');
  try {
    if(env.WS_PREPARATION_PRUNE_STATUS!==undefined&&env.WS_PREPARATION_PRUNE_STATUS!=='complete')throw new Error('Generation history retention incomplete');
    const root=realpathSync(sourceRoot),products=generationPlan(root).products;
    if(products.length===0)throw new Error('No admitted products');
    // This is the exact generating-input boundary used by beginProgramInputProof,
    // not a Git tree, directory metadata fingerprint or cached payload hash.
    const registry=v.parse(v.object({producers:v.record(v.string(),v.array(v.string()))}),JSON.parse(readFileSync(resolve(root,'scripts/source-generation-outputs.json'),'utf8')));
    const outputs=new Set([...Object.values(registry.producers).flat(),'budgets/ceiling-sources.json']);
    const roots=new Set(['src','scripts','lint','vite','budgets','package.json','pnpm-lock.yaml','pnpm-workspace.yaml']);
    const inputs=committedSourceFiles(root,env).filter(file=>roots.has(file.split('/')[0]??'')&&!outputs.has(file)
      &&!file.includes('.generated.')&&!file.includes('/.wildshard/')&&!file.includes('/node_modules/')).sort();
    const file=resolve(root,'.cache/generation-phase.json'),phase=v.parse(Phase,JSON.parse(readFileSync(file,'utf8')));
    const identity=sourceSnapshotIdentity({node:process.version,platform:process.platform,arch:process.arch,products,inputs});
    const memo=new InputHashMemo(root);
    if(JSON.stringify(Object.keys(phase.inputs).sort())!==JSON.stringify(inputs)
      ||!verifiedSourceSnapshot(file,identity,memo,Object.keys(phase.outputs)))throw new Error('Generation receipt is not current and complete');
    const admitted=products.map(slug=>{
      // Deliberately omit CI's exact-run bypass: recheck the current sealed input
      // receipt even though the preceding generation already did strict admission.
      const output=resolve(root,'out',slug);
      if(readBuiltShardfile(root,slug,{cacheRoot,env:{}})!==output)throw new Error(`Missing current output ${slug}`);
      const receipt=v.parse(Receipt,JSON.parse(readFileSync(resolve(output,'validation.json'),'utf8')));
      if(readBuildKey(output)!==receipt.buildKey||digest(readFileSync(resolve(output,'shard.json')))!==receipt.indexHash)
        throw new Error(`Product receipt differs ${slug}`);
      return [slug,receipt.buildKey,receipt.indexHash];
    });
    const key=digest(JSON.stringify({schema:'preparation-inputs/2',node:process.version,platform:process.platform,arch:process.arch,
      products:admitted,inputs:inputs.filter(path=>!nonGenerating.has(path)).map(path=>[path,phase.inputs[path]])}));
    return {key:`${fallback.replace('preparation-v3-','preparation-v4-').slice(0,-40)}${key}`,qualified:true,products:products.length,reason:'admitted-receipts-and-generating-inputs'};
  } catch(error) {
    return {key:fallback,qualified:false,products:0,reason:error instanceof Error?error.message:'Unknown preparation identity'};
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const fallback=process.env.PREPARATION_FALLBACK_KEY;
  if(fallback===undefined||process.env.GITHUB_OUTPUT===undefined)throw new Error('Preparation save identity requires fallback and output');
  const result=preparationCacheKey(resolve(import.meta.dirname,'..'),fallback);
  appendFileSync(process.env.GITHUB_OUTPUT,`key=${result.key}\nqualified=${result.qualified}\n`);
  console.info(`Preparation save identity: ${JSON.stringify(result)}`);
}
