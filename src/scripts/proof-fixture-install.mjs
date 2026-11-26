// Native fixture isolation: unknown imports must not fall into this repo's
// install. Sealed managed packages make that isolation real to Node itself.
import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {moduleEntries,moduleLookupDirectories} from './node-module-scope.mjs';
/** @param {string} root */
export function installProofFixture(root){
 const base=realpathSync(root),scratch=resolve('tmp');
 if(!base.startsWith(`${scratch}${sep}`))throw new Error('Proof fixture must be in owned repo scratch');
 const modules=join(base,'node_modules'),store=join(modules,'.pnpm','__proof_isolation__','node_modules');
 const names=new Set(moduleLookupDirectories(base).flatMap(directory=>moduleEntries(directory).map(entry=>entry.name)));
 for(const name of names){
  const link=join(modules,name);if(existsSync(link))continue;
  const target=join(store,name);mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'package.json'),JSON.stringify({name,version:'0.0.0',exports:{}}));
  mkdirSync(dirname(link),{recursive:true});symlinkSync(relative(dirname(link),target),link,'dir');
 }
 // Never modify the enclosing repo when a fixture has not run git init yet.
 try{
  /** @param {string[]} args */
  const git=args=>execFileSync('git',args,{cwd:base,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(realpathSync(git(['rev-parse','--show-toplevel']))===base){
   const file=resolve(base,git(['rev-parse','--git-path','info/exclude']));mkdirSync(dirname(file),{recursive:true});appendFileSync(file,'\n/node_modules/\n');
  }
 }catch{ /* The fixture adds its own ignore after git init. */ }
}
