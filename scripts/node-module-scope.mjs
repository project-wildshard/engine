import {existsSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';

// Manager state and compiler caches are derived outputs, not package names.
const CACHES=new Set(['.cache','.vite','.vite-temp','.vitest-cache']);
/** @param {string} name */
export const moduleCacheOutput=name=>CACHES.has(name);
const INTERNAL=new Set(['.bin','.pnpm','.modules.yaml','.pnpm-workspace-state-v1.json','.ws-installed-lock','.package-lock.json','.cache','.vite','.vite-temp','.vitest-cache','.DS_Store','.ignored','.yarn-integrity']);
/** The actual CJS fallback chain, including the process's global locations.
 * @param {string} origin */
export function moduleLookupDirectories(origin){
 return createRequire(join(origin,'__wildshard_proof__.cjs')).resolve.paths('__wildshard_proof_dependency__')??[];
}
/** Enumerate the complete public package namespace, including hoisted names.
 * @param {string} modules */
export function moduleEntries(modules){
 if(!existsSync(modules))return [];
 if(!lstatSync(modules).isDirectory()||realpathSync(modules)!==modules)throw new Error('Unsupported module directory');
 const entries=[];
 for(const name of readdirSync(modules).sort()){
  if(INTERNAL.has(name))continue;
  // Hidden generated packages (for example .prisma) are valid CJS
  // specifiers. Only the explicit manager/cache output list is omitted.
  if(name.startsWith('@'))for(const child of readdirSync(join(modules,name)).sort().filter(entry=>!INTERNAL.has(entry)))entries.push({name:`${name}/${child}`,file:join(modules,name,child)});
  else entries.push({name,file:join(modules,name)});
 }
 return entries;
}
