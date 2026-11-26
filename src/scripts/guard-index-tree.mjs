// Guards read a private copy: Git write-tree mutates cache-tree index metadata.
import {copyFileSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Snapshot the caller's complete actual index without taking or writing its lock.
 * A concurrent Git writer atomically replaces the index, so the copy is complete.
 * Corrupt indexes still refuse; Git validates and writes cache metadata only here.
 * @param {string} root */
export function guardIndexTree(root) {
  const owned=realpathSync(mkdtempSync(join(tmpdir(),'guard-index-')));
  const index=join(owned,'index');
  try {
    const source=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','index'],{cwd:root,encoding:'utf8'}).trim();
    copyFileSync(source,index);
    return execFileSync('git',['write-tree'],{cwd:root,encoding:'utf8',env:{...process.env,GIT_INDEX_FILE:index}}).trim();
  } finally {rmSync(owned,{recursive:true,force:true});}
}
