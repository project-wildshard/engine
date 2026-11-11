// DEV-SPEED DS12: real APFS clones from Node. Node's `COPYFILE_FICLONE` makes a full copy on macOS (measured: a
// clone's ATTR_CMNEXT_PRIVATESIZE equals its size, so every "clone" cost its bytes again) and `cpSync` ignores the
// flag, so a clone here is clonefile(2), called through python3's ctypes: one process for every pair.
//
// A source must be a regular file or a directory, never a symlink (CLONE_NOFOLLOW, and a final-link check before the
// call). A directory is cloned whole in one call, links inside it stay links: a caller that needs regular files walks
// the result. The target must not exist. A clone shares every block with its source until either side writes, so it
// costs no disk; a caller that must trust the bytes hashes them afterwards (pins-reuse.mjs does).
//
// Off macOS, or when clonefile refuses (another volume, a filesystem without clones), each pair is copied instead.
import {spawnSync} from 'node:child_process';
import {cpSync,lstatSync} from 'node:fs';

const CLONE=`import ctypes, os, stat, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32]
CLONE_NOFOLLOW, CLONE_NOOWNERCOPY = 1, 2
parts = sys.stdin.buffer.read().split(b'\\0')[:-1]
for source, target in zip(parts[0::2], parts[1::2]):
    mode = os.lstat(source).st_mode
    if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
        sys.exit(f'{source.decode()}: not a regular file or directory')
    if libc.clonefile(source, target, CLONE_NOFOLLOW | CLONE_NOOWNERCOPY) != 0:
        sys.exit(f'{target.decode()}: {os.strerror(ctypes.get_errno())}')`;

/**
 * Clone each `[source, target]` pair. Returns `clone` when every pair is an APFS clone, `copy` when they were copied.
 * Throws when a source is a link or missing, or a target exists; a pair cloned before the failure stays.
 * @param {readonly (readonly [string,string])[]} pairs @param {{platform?:string}} [options]
 * @returns {'clone'|'copy'|'none'}
 */
export function clonePaths(pairs,{platform=process.platform}={}){
 if(pairs.length===0)return 'none';
 for(const [source] of pairs){
  const stat=lstatSync(source);
  if(!stat.isFile()&&!stat.isDirectory())throw new Error(`${source}: not a regular file or directory`);
 }
 if(platform==='darwin'){
  const input=`${pairs.flat().join('\0')}\0`;
  const result=spawnSync('python3',['-I','-c',CLONE],{input,encoding:'utf8',maxBuffer:64<<20});
  if(result.status===0)return 'clone';
  const reason=result.error?.message??result.stderr.trim();
  // A refusal the filesystem gives (no clone support, another volume) falls back to copies; anything else stops.
  if(!/Operation not supported|Cross-device link|ENOTSUP|EXDEV/u.test(reason))throw new Error(`clonefile: ${reason}`);
  // Pairs before the refusal are already cloned; copy only what is still missing.
  pairs=pairs.filter(([,target])=>{try{lstatSync(target);return false;}catch{return true;}});
 }
 for(const [source,target] of pairs)cpSync(source,target,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});
 return 'copy';
}
