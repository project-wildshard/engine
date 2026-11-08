import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {committedSourceFiles} from './source-input-proof.mjs';

/** Conservative client-build ABI, independent of shell ids, pins and package version.
 * Generated tables and recorded programs are outputs; product bytes have their
 * own preparation binding. An installed engine uses its publisher's stamp. */
export function rendererRevision(root=resolve(import.meta.dirname,'..')){
  if(!existsSync(resolve(root,'pnpm-lock.yaml'))){
    const value=JSON.parse(readFileSync(resolve(root,'scripts/renderer-revision.json'),'utf8')).revision;
    if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw new Error('Missing engine renderer revision');
    return value;
  }
  const hash=createHash('sha256'),add=path=>hash.update(relative(root,path)).update('\0').update(readFileSync(path)).update('\0');
  const roots=new Set(['src/client','src/shared','types','vite','scripts','vite.config.ts','pnpm-lock.yaml','public']);
  const inputs=committedSourceFiles(root).filter(path=>[...roots].some(prefix=>path===prefix||path.startsWith(`${prefix}/`)))
    .filter(path=>!path.startsWith('public/programs/')&&!path.includes('.generated.')&&!/\.(?:test|proof)\./u.test(path)&&!['scripts/renderer-revision.json','scripts/validation-revision.json'].includes(path)).sort();
  for(const path of inputs){
    const file=resolve(root,path);
    if(lstatSync(file).isSymbolicLink())throw new Error(`Renderer source input must be a regular tracked file: ${path}`);
    add(file);
  }
  const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
  hash.update(JSON.stringify({dependencies:pkg.dependencies,pnpm:pkg.pnpm}));
  return hash.digest('hex');
}
