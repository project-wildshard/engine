import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {committedSourceFiles} from './source-input-proof.mjs';

/** J259 (SHARD-PIPELINE SP3): the renderer fingerprint hashes only what decides the linked GLSL a shard's recorded
 * programs name, so ordinary engine commits keep prepared shardfiles `current` while a real shader change still moves it.
 * Inputs, among committed client and shared sources (never tests, proofs or `.generated.` tables):
 * - every file under `src/client/engine/render/`;
 * - every file that writes or patches shader text (`SHADER_TEXT`), or builds a three material whose flags pick a program
 *   variant (`MATERIAL`), so a new one joins on its own;
 * - the files the GLSL emitter under `render/graph/` imports directly (`GRAPH_ROOT`; wind and wave constants it bakes
 *   into shader text live in `src/shared`);
 * - the exact package specs of the libraries that emit shaders, plus the format pin (`RENDERER_PACKAGES`).
 * Not `scripts/`, `public/`, `vite/` or the lockfile. A file this misses can only leave a stale program list (link
 * hitches after control, DL23), never a wrong frame: recorded programs only warm the compiler. */
export const RENDER_ROOT='src/client/engine/render/';
export const SOURCE_ROOTS=Object.freeze(['src/client/','src/shared/']);
export const GRAPH_ROOT='src/client/engine/render/graph/';
export const SHADER_TEXT=/ShaderMaterial|onBeforeCompile|ShaderChunk|#include|#define|glsl|gl_FragColor|gl_Position|void main\(|\buniform (?:float|int|bool|vec[234]|mat[234]|sampler)|\bvarying |vertexShader|fragmentShader|patchShader/iu;
export const MATERIAL=/new (?:THREE\.)?\w*Material\(|extends (?:THREE\.)?\w*Material\b/u;
const IMPORT=/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu;
export const RENDERER_PACKAGES=Object.freeze(['three','postprocessing','n8ao','@wildshard/format']);

/** The renderer the 26 shardfiles re-prepared on 2026-11-11 (opus-reprep26) name: the broad pre-J259 fingerprint of
 * engine `ac225144`. Its narrowed inputs hash to the key, so a tree whose shader inputs are still `ac225144`'s keeps that
 * value and those preparations stay current; the first real shader change leaves this table behind for good. */
export const CARRIED_RENDERERS=Object.freeze({
  'f1c4d5fc4465c518da1b4bfd5b49a2df2cdec8daf9dc15cf208258cdbbbfdaac':'e920f04196bcb886f1402ae12a8ca6502b2b32cdf808d9df4115e9e67fad6e8b',
});

/** @param {string} a @param {string} b */
const byCodeUnit=(a,b)=>a<b?-1:a>b?1:0;

/** Is this committed path a narrowed renderer input candidate (its bytes still decide, through `SHADER_TEXT`)? */
export const rendererCandidate=path=>SOURCE_ROOTS.some(root=>path.startsWith(root))&&!path.includes('.generated.')&&!/\.(?:test|proof)\./u.test(path);

/** The narrowed hash over any tree: `paths` are its committed files, `read` returns a file's bytes. The commit replay
 * (`renderer-revision.proof.mjs`) feeds git blobs through the same function the checkout uses.
 * @param {readonly string[]} paths @param {(path:string)=>Buffer} read @returns {string} */
export function narrowedRendererHash(paths,read){
  const candidates=paths.filter(rendererCandidate).sort(byCodeUnit),known=new Set(candidates),chosen=new Set();
  for(const path of candidates){
    const text=read(path).toString('utf8');
    if(!path.startsWith(RENDER_ROOT)&&!SHADER_TEXT.test(text)&&!MATERIAL.test(text))continue;
    chosen.add(path);
    if(path.startsWith(GRAPH_ROOT))for(const [,specifier] of text.matchAll(IMPORT)){
      const imported=importedPath(path,specifier??'',known);
      if(imported!==undefined)chosen.add(imported);
    }
  }
  const hash=createHash('sha256');
  for(const path of [...chosen].sort(byCodeUnit))hash.update(path).update('\0').update(read(path)).update('\0');
  const pkg=JSON.parse(read('package.json').toString('utf8'));
  hash.update(JSON.stringify(RENDERER_PACKAGES.map(name=>[name,pkg.dependencies?.[name]??null])));
  return hash.digest('hex');
}

/** A relative import's committed source file, or undefined (a package, or outside the candidates).
 * @param {string} from @param {string} specifier @param {Set<string>} known */
function importedPath(from,specifier,known){
  const parts=from.split('/').slice(0,-1);
  for(const part of specifier.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}
  const base=parts.join('/');
  return [base,`${base}.ts`,`${base}.tsx`,base.replace(/\.js$/u,'.ts'),`${base}/index.ts`].find(path=>known.has(path));
}

/** The value a narrowed hash publishes: a carried pre-J259 renderer where the shader inputs haven't moved, else itself.
 * @param {string} narrowed */
export const publishedRenderer=narrowed=>CARRIED_RENDERERS[narrowed]??narrowed;

/** Every file under `SOURCE_ROOTS` on disk, as root-relative paths: an installed engine's source inventory. It has no
 * git and no lockfile, but `package.json` `files` ships all of `src` but tests, which are never inputs (LS1, J250).
 * @param {string} root @returns {string[]} */
export function installedSourceFiles(root){
  /** @type {string[]} */
  const files=[];
  /** @param {string} folder */
  const visit=folder=>{
    if(!existsSync(resolve(root,folder)))return;
    for(const entry of readdirSync(resolve(root,folder),{withFileTypes:true})){
      const path=`${folder}${entry.name}`;
      if(entry.isDirectory())visit(`${path}/`);
      else if(entry.isFile())files.push(path);
    }
  };
  for(const folder of SOURCE_ROOTS)visit(folder);
  return files;
}

/** This engine's renderer fingerprint, computed live everywhere (LS1, J250: no stamp file). A checkout lists its
 * committed files; an installed engine (no lockfile, no git) walks its shipped `src`, which holds the same inputs. */
export function rendererRevision(root=resolve(import.meta.dirname,'..')){
  const installed=!existsSync(resolve(root,'pnpm-lock.yaml'));
  const read=path=>{
    const file=resolve(root,path);
    if(path!=='package.json'&&lstatSync(file).isSymbolicLink())throw new Error(`Renderer source input must be a regular tracked file: ${path}`);
    return readFileSync(file);
  };
  return publishedRenderer(narrowedRendererHash(installed?installedSourceFiles(root):committedSourceFiles(root),read));
}
