import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {committedSourceFiles} from './source-input-proof.mjs';

/** J259 (SHARD-PIPELINE SP3): the renderer fingerprint hashes only what decides the linked GLSL a shard's recorded
 * programs name, so ordinary engine commits keep prepared shardfiles `current` while a real shader change still moves it.
 * Inputs: every committed file under `src/client/engine/render/`; every other committed client or shared source file
 * that writes shader text or patches three's chunks (`SHADER_TEXT`, so a new one joins on its own); and the exact
 * package specs of the libraries that emit shaders plus the format pin (`RENDERER_PACKAGES`). Not `scripts/`,
 * `public/`, `vite/` or the lockfile. Tests, proofs and generated tables are outputs, never inputs. */
export const RENDER_ROOT='src/client/engine/render/';
export const SOURCE_ROOTS=Object.freeze(['src/client/','src/shared/']);
export const SHADER_TEXT=/ShaderMaterial|onBeforeCompile|ShaderChunk|#include|glsl/iu;
export const RENDERER_PACKAGES=Object.freeze(['three','postprocessing','n8ao','@wildshard/format']);

/** The renderer the 26 shardfiles re-prepared on 2026-11-11 (opus-reprep26) name: the broad pre-J259 fingerprint of
 * engine `ac225144`. Its narrowed inputs hash to the key, so a tree whose shader inputs are still `ac225144`'s keeps that
 * value and those preparations stay current; the first real shader change leaves this table behind for good. */
export const CARRIED_RENDERERS=Object.freeze({
  '6aed4d456d0e5a53685db3c3cb296b42c1df86fa085013188b8d35647311f9e9':'e920f04196bcb886f1402ae12a8ca6502b2b32cdf808d9df4115e9e67fad6e8b',
});

/** Is this committed path a narrowed renderer input candidate (its bytes still decide, through `SHADER_TEXT`)? */
export const rendererCandidate=path=>SOURCE_ROOTS.some(root=>path.startsWith(root))&&!path.includes('.generated.')&&!/\.(?:test|proof)\./u.test(path);

/** The narrowed hash over any tree: `paths` are its committed files, `read` returns a file's bytes. The commit replay
 * (`renderer-revision.proof.mjs`) feeds git blobs through the same function the checkout uses.
 * @param {readonly string[]} paths @param {(path:string)=>Buffer} read @returns {string} */
export function narrowedRendererHash(paths,read){
  const hash=createHash('sha256');
  for(const path of paths.filter(rendererCandidate).sort()){
    const bytes=read(path);
    if(!path.startsWith(RENDER_ROOT)&&!SHADER_TEXT.test(bytes.toString('utf8')))continue;
    hash.update(path).update('\0').update(bytes).update('\0');
  }
  const pkg=JSON.parse(read('package.json').toString('utf8'));
  hash.update(JSON.stringify(RENDERER_PACKAGES.map(name=>[name,pkg.dependencies?.[name]??null])));
  return hash.digest('hex');
}

/** The value a narrowed hash publishes: a carried pre-J259 renderer where the shader inputs haven't moved, else itself.
 * @param {string} narrowed */
export const publishedRenderer=narrowed=>CARRIED_RENDERERS[narrowed]??narrowed;

/** This engine's renderer fingerprint. An installed engine (no lockfile, no git) uses its publisher's stamp. */
export function rendererRevision(root=resolve(import.meta.dirname,'..')){
  if(!existsSync(resolve(root,'pnpm-lock.yaml'))){
    const value=JSON.parse(readFileSync(resolve(root,'scripts/renderer-revision.json'),'utf8')).revision;
    if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw new Error('Missing engine renderer revision');
    return value;
  }
  const read=path=>{
    const file=resolve(root,path);
    if(path!=='package.json'&&lstatSync(file).isSymbolicLink())throw new Error(`Renderer source input must be a regular tracked file: ${path}`);
    return readFileSync(file);
  };
  return publishedRenderer(narrowedRendererHash(committedSourceFiles(root),read));
}
