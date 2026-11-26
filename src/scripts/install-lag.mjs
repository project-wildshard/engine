// Build-max C4 (2026-11-21): is this checkout's install behind its lockfile? From 14:33 to 16:59 Cancún every push gate's
// typecheck failed on installs that still held shard-format 0.66.0 after the lock moved to 0.67.0: a sync or a rebase
// moved pnpm-lock.yaml and nothing installed. pnpm keeps the lockfile it last installed as node_modules/.pnpm/lock.yaml,
// so the two files say whether the install is current, whatever moved the lock (a land, a main-push sync, a pull).
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

/** pnpm annotates fetched Git archives in its installed copy; that flag alone is no difference (push-dependencies.mjs).
 * @param {string} text */
const comparable=text=>text.replaceAll(/^([ \t]+resolution: \{)gitHosted: true, (?=[^}\r\n]*\btarball: https?:\/\/)/gmu,'$1');

/** Why `root`'s node_modules is behind its pnpm-lock.yaml, or '' when it is current or there is nothing to compare (no
 * lockfile, no node_modules or no installed copy: a checkout never installed is left to its own setup).
 * @param {string} root @returns {string} */
export function installLag(root){
 const lock=join(root,'pnpm-lock.yaml'),installed=join(root,'node_modules/.pnpm/lock.yaml');
 if(!existsSync(lock)||!existsSync(installed))return '';
 return comparable(readFileSync(lock,'utf8'))===comparable(readFileSync(installed,'utf8'))?'':'pnpm-lock.yaml moved since the last install';
}
