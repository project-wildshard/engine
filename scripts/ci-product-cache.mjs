// Publish the current run's reusable products, not several generations of old payloads.
import {appendFileSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {readBuildKey,shardfileCacheRoot} from './shardfile-cache.mjs';
import {trimGenerationCache} from './generation-cache-prune.mjs';

const keyPattern=/^[a-f0-9]{64}$/u;
/** Only a complete current output and its matching cache entry authorize pruning
 * that product's historical entries. Input receipts and unrelated paths stay intact.
 * @param {string} root @param {string} cache */
export function trimProductCache(root,cache) {
  let products=0,removed=0;
  try {if(!lstatSync(cache).isDirectory()||lstatSync(cache).isSymbolicLink())return {products,removed};}
  catch {return {products,removed};}
  for(const row of readdirSync(resolve(root,'out'),{withFileTypes:true})) {
    if(!row.isDirectory()||!/^[a-z0-9_]+(?:-[a-z0-9]+)*$/u.test(row.name))continue;
    const key=readBuildKey(resolve(root,'out',row.name));
    if(!keyPattern.test(key))continue;
    const directory=resolve(cache,row.name),current=resolve(directory,key);
    try {
      if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()
          ||!lstatSync(current).isDirectory()||lstatSync(current).isSymbolicLink()
          ||readBuildKey(current)!==key)continue;
      const index=resolve(current,'shard.json'),output=resolve(root,'out',row.name,'shard.json');
      if(!lstatSync(index).isFile()||lstatSync(index).isSymbolicLink()
          ||!lstatSync(output).isFile()||lstatSync(output).isSymbolicLink()
          ||!readFileSync(index).equals(readFileSync(output)))continue;
    } catch {continue;}
    products++;
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      if(entry.isDirectory()&&keyPattern.test(entry.name)&&entry.name!==key) {
        rmSync(resolve(directory,entry.name),{recursive:true});removed++;
      }
    }
  }
  return {products,removed};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true')throw new Error('Product cache trim runs only on an isolated GitHub Actions runner');
  const root=resolve(import.meta.dirname,'..'),cache=shardfileCacheRoot();
  if(process.argv.includes('--prune-generation')) {
    // The shared Mac keeps warm entries for other revisions. Only the isolated
    // hosted runner may apply this optimization; real local censuses stay dry.
    if(process.platform!=='linux'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'
        ||process.env.GITHUB_WORKSPACE===undefined||realpathSync(process.env.GITHUB_WORKSPACE)!==realpathSync(root))
      throw new Error('Generation history trim requires the isolated hosted Linux workspace');
    const fallback=process.env.PREPARATION_FALLBACK_KEY,output=process.env.GITHUB_OUTPUT;
    if(fallback===undefined||output===undefined)throw new Error('Generation history trim requires save identity and output');
    const report=trimGenerationCache(root,cache,resolve(homedir(),'.cache/wildshard/gen'),fallback,{dryRun:false});
    console.info(`CI generation cache: ${JSON.stringify(report)}`);
    appendFileSync(output,`status=${report.qualified?'complete':'unknown'}\n`);
  }
  console.info(`CI product cache: ${JSON.stringify(trimProductCache(root,cache))}`);
}
