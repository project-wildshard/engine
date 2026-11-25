// The push gate's typecheck sees every file a push adds or changes (meta QA 11-25 row 53).
//
// `tsc -b` trusts modification times: a project whose buildinfo is newer than every input it lists is up to date, and
// TypeScript 7 does not notice a new root file whose mtime is older than that buildinfo. The gate copy clones the
// checkout's files and its `.tsc-layers` cache with their mtimes kept (scripts/push-gate-copy.mjs), and a shared
// checkout's cache can be written while a file is still untracked (the commit lane's overlays drop untracked files but
// keep the real buildinfo). So opus-trailer's `5068a7365` added scripts/trailer/capture.mjs, written before the cache,
// the gate's `tsc -b` called the scripts project up to date, and main's cold CI typecheck went red (run 45662209325).
//
// Before the typecheck, the gate sets every pushed file's mtime to now: each project that holds one rebuilds, warm
// for the rest. Contents never change.
import {execFileSync} from 'node:child_process';
import {statSync,utimesSync} from 'node:fs';
import {join} from 'node:path';

/** Paths a push adds or modifies (no deletions), over every pushed ref; [] when no range is known.
 * @param {string|undefined} refs pre-push lines: `<local ref> <local sha> <remote ref> <remote sha>` @param {string} cwd
 * @returns {string[]} */
export function pushedPaths(refs,cwd){
 /** @type {Set<string>} */const paths=new Set();
 for(const line of (refs??'').trim().split('\n').filter(Boolean)){
  const [,local='',,remote='']=line.trim().split(/\s+/u);
  if(!/^[a-f0-9]{40}$/u.test(local)||!/^[a-f0-9]{40}$/u.test(remote)||/^0+$/u.test(local)||/^0+$/u.test(remote))continue;
  for(const path of execFileSync('git',['diff','--name-only','--no-renames','--diff-filter=d','-z',remote,local],{cwd,encoding:'utf8'}).split('\0').filter(Boolean))paths.add(path);
 }
 return [...paths].sort();
}

/** Set each path's mtime (and atime) to now; returns how many files it touched. @param {string} root @param {string[]} paths
 * @param {Date} [now] */
export function freshen(root,paths,now=new Date()){
 let touched=0;
 for(const path of paths){
  const file=join(root,path);
  try{if(!statSync(file).isFile())continue;}catch{continue;}
  utimesSync(file,now,now);touched++;
 }
 return touched;
}

/** Freshen what a push carries; the line the gate logs. @param {string|undefined} refs @param {string} cwd */
export function freshenPush(refs,cwd){
 const paths=pushedPaths(refs,cwd),touched=freshen(cwd,paths);
 return `typecheck sees the push: ${touched} pushed file(s) newer than the tsc -b cache`;
}
