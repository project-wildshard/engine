#!/usr/bin/env node
// DA1: retain build maps for diagnostics; omit them only from Vercel's public artifact.
import { copyFileSync, linkSync, lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

/** @param {string} name */
const sourceMap = name => /\.map(?:\.(?:br|gz))?$/u.test(name);

/** A public artifact can link back to dist. Walk those links without ever deleting their targets.
 * @param {string} root @returns {{path:string,bytes:number}[]} */
function maps(root) {
  /** @type {{path:string,bytes:number}[]} */ const rows = [];
  /** @type {Set<string>} */ const ancestors = new Set();
  /** @param {string} dir */
  function walk(dir) {
    const target = realpathSync(dir);
    if (ancestors.has(target)) throw new Error('Cyclic deployment directory');
    ancestors.add(target);
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && sourceMap(name)) rows.push({path:relative(root,path),bytes:info.size});
    }
    ancestors.delete(target);
  }
  walk(root);
  return rows;
}

/** Detach only a linked directory on a map's path. Files are hard links and child directories retain their links,
 * so large product/asset trees are neither copied nor changed. A later unlink removes only the artifact's entry.
 * @param {string} path */
function detach(path) {
  if (!lstatSync(path).isSymbolicLink()) return;
  const target = realpathSync(path), temporary = mkdtempSync(join(dirname(path), '.source-map-filter-'));
  try {
    for (const name of readdirSync(target)) {
      const source = realpathSync(join(target,name)), destination = join(temporary,name);
      if (statSync(source).isDirectory()) symlinkSync(source,destination,'dir');
      else {
        try { linkSync(source,destination); }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV') throw error;
          copyFileSync(source,destination);
        }
      }
    }
    unlinkSync(path); renameSync(temporary,path);
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}

/** Strip only public maps, preserving the original dist maps and every runtime byte.
 * @param {string} directory @returns {{files:number,bytes:number}} */
export function stripDeploySourceMaps(directory) {
  const root = resolve(directory);
  if (basename(root) !== 'static' || basename(dirname(root)) !== 'output' || basename(dirname(dirname(root))) !== '.vercel') {
    throw new Error('Expected the Vercel .vercel/output/static artifact');
  }
  const rows = maps(root);
  for (const row of rows) {
    detach(root);
    let parent = root;
    for (const part of dirname(row.path).split('/').filter(segment => segment !== '.')) {
      parent = join(parent,part); detach(parent);
    }
    unlinkSync(join(root,row.path));
  }
  if (maps(root).length > 0) throw new Error('Deployment still contains public source maps');
  return {files:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0)};
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error('Usage: deploy-source-maps.mjs .vercel/output/static');
  console.log(JSON.stringify(stripDeploySourceMaps(directory)));
}
