// `pins.ts install` keeps the mounts it publishes under public/ out of `git status` with a marked block in Git's
// exclude file. That file lives in the common Git dir: every worktree of the repo reads the same one (J240, DEV-SPEED
// DS6), and Git has no per-worktree exclude file. So only the canonical checkout writes the block. A linked plan
// worktree never touches it (codex-port, 2026-11-10: a worktree's `--from-format` install replaced the parent's block
// and broke its pins). A worktree with the same pins is already covered by the canonical block; a path a plan
// publishes beyond it shows as untracked there, which hides nothing and blocks nothing (commits are by pathspec, and
// `land` and `worktree new` check tracked files only).
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

const BEGIN='# pins: mounts published under public/, begin',END='# pins: mounts published under public/, end';

/**
 * The exclude text with the pins block set to `paths`; every other line kept as it was.
 * @param {string} text the current exclude file @param {readonly string[]} paths repo-relative published paths
 * @returns {string}
 */
export function excludeText(text,paths){
 const lines=text===''?[]:text.replace(/\r?\n$/u,'').split(/\r?\n/u);
 const start=lines.indexOf(BEGIN),end=start===-1?-1:lines.indexOf(END,start);
 // No end marker: only the begin line is dropped, never the lines after it.
 const kept=start===-1?lines:[...lines.slice(0,start),...lines.slice(end===-1?start+1:end+1)];
 return `${[...kept,BEGIN,...paths.map(path=>`/${path}`),END].join('\n')}\n`;
}

/** The pins block's paths in an exclude file. @param {string} text @returns {Set<string>} */
export function excludedPaths(text){
 const lines=text.split(/\r?\n/u),start=lines.indexOf(BEGIN),end=start===-1?-1:lines.indexOf(END,start);
 return new Set(start===-1||end===-1?[]:lines.slice(start+1,end).map(line=>line.replace(/^\//u,'')));
}

/** The mounts this tree's own last `pins.ts install` published (its ledger, out/.pins.json): pins outputs, like out/.
 * A worktree whose canonical checkout never wrote the exclude block sees them as untracked; checks that want a clean
 * tree (push-proof-cache.mjs) ignore exactly these, never anything else untracked. Only plain public/ paths count.
 * @param {string} [cwd] @returns {Set<string>} */
export function pinsOutputs(cwd=process.cwd()){
 try{
  const {published}=/** @type {{published?:unknown}} */(JSON.parse(readFileSync(join(cwd,'out/.pins.json'),'utf8')));
  return new Set((Array.isArray(published)?published:[]).filter(path=>typeof path==='string'&&path.startsWith('public/')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')));
 }catch{return new Set();}
}

/** Write the canonical checkout's block of published paths; in a linked worktree, leave the shared file alone.
 * @param {readonly string[]} paths @param {string} [cwd]
 * @returns {{written:boolean,uncovered:number}} */
export function excludePublished(paths,cwd=process.cwd()){
 /** @param {string[]} args */
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 let file,gitDir,common;
 try{
  file=git(['rev-parse','--path-format=absolute','--git-path','info/exclude']);
  gitDir=git(['rev-parse','--path-format=absolute','--git-dir']);
  common=git(['rev-parse','--path-format=absolute','--git-common-dir']);
 }catch{return {written:false,uncovered:paths.length};}
 const text=existsSync(file)?readFileSync(file,'utf8'):'';
 if(gitDir!==common){
  const covered=excludedPaths(text),uncovered=paths.filter(path=>!covered.has(path)).length;
  console.log(`pins: linked worktree; the shared exclude stays the canonical checkout's${uncovered===0?'':` (${uncovered} published paths it doesn't cover show as untracked here)`}`);
  return {written:false,uncovered};
 }
 mkdirSync(dirname(file),{recursive:true});
 writeFileSync(file,excludeText(text,paths));
 return {written:true,uncovered:0};
}
