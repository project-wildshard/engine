// `pins.ts install` keeps the mounts it publishes under public/ out of `git status` with a marked block in Git's
// exclude file. That file lives in the common Git dir, so every worktree of the repo reads and writes the same one
// (J240, DEV-SPEED DS6). Each checkout therefore owns its own block: the canonical checkout keeps the original
// markers, a linked worktree's markers name it, and a write replaces only the writer's block (plus blocks of
// worktrees that no longer exist), never another checkout's. Patterns are root-anchored and Git applies the file to
// each worktree's own root, so the union only ever hides published mount paths.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';

const BEGIN='# pins: mounts published under public/, begin',END='# pins: mounts published under public/, end';
const MARKER=/^# pins: mounts published under public\/, (begin|end)(?: \(worktree (.+)\))?$/u;

/** @param {string} id '' for the canonical checkout */
const markers=id=>id===''?[BEGIN,END]:[`${BEGIN} (worktree ${id})`,`${END} (worktree ${id})`];

/**
 * The exclude text with `id`'s block set to `paths` and every other live checkout's block kept.
 * @param {string} text the current exclude file
 * @param {string} id '' for the canonical checkout, else the worktree's path relative to it
 * @param {readonly string[]} paths repo-relative published paths
 * @param {(id: string) => boolean} [live] whether another worktree's block still has its worktree
 * @returns {string}
 */
export function excludeText(text,id,paths,live=()=>true){
 const lines=text===''?[]:text.replace(/\n$/u,'').split('\n');
 /** @type {string[]} */const kept=[];
 /** @type {string|undefined} */let inside;
 let keep=true;
 for(const line of lines){
  const marker=MARKER.exec(line);
  if(inside===undefined&&marker?.[1]==='begin'){
   inside=marker[2]??'';
   keep=inside!==id&&(inside===''||live(inside));
   if(keep)kept.push(line);
   continue;
  }
  if(inside!==undefined&&marker?.[1]==='end'&&(marker[2]??'')===inside){
   if(keep)kept.push(line);
   inside=undefined;keep=true;
   continue;
  }
  if(inside===undefined||keep)kept.push(line);
 }
 // An unterminated block of another checkout is closed rather than left to swallow ours.
 if(inside!==undefined&&keep)kept.push(markers(inside)[1]??END);
 const [begin,end]=markers(id);
 return `${[...kept,begin,...paths.map(path=>`/${path}`),end].join('\n')}\n`;
}

/** Write this checkout's block of published paths into the shared exclude file.
 * @param {readonly string[]} paths @param {string} [cwd] */
export function excludePublished(paths,cwd=process.cwd()){
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 let file,top,common;
 try{
  file=git(['rev-parse','--path-format=absolute','--git-path','info/exclude']);
  top=git(['rev-parse','--show-toplevel']);
  common=git(['rev-parse','--path-format=absolute','--git-common-dir']);
 }catch{return;}
 const canonical=dirname(common),id=top===canonical?'':relative(canonical,top).replaceAll('\\','/');
 const text=existsSync(file)?readFileSync(file,'utf8'):'';
 mkdirSync(dirname(file),{recursive:true});
 writeFileSync(file,excludeText(text,id,paths,other=>existsSync(resolve(canonical,other,'.git'))));
}
