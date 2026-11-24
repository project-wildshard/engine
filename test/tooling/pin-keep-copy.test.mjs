import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,ftruncateSync,mkdirSync,mkdtempSync,openSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {keepCopy,worktreeState} from '../../scripts/pin-keep-copy.mjs';
import {pinMounts} from '../../scripts/keep-copy.mjs';
import {pinsKey,writeManifest} from '../../scripts/pins-reuse.mjs';
import {shardfileValidationRevision} from '../../scripts/shardfile-validation-revision.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
const git=(cwd,...args)=>{const result=spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd,env,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);return result.stdout;};
const put=(root,path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
const mount='public/programs/generated.bin';
function fixture(){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest');mkdirSync(parent,{recursive:true});
 const base=mkdtempSync(join(parent,'pin-keep-'));roots.push(base);
 const canonical=join(base,'repo');mkdirSync(canonical);git(canonical,'init','-q','-b','main');
 put(canonical,'.gitignore','/out/\n/public/programs/\n/.owner\n');
 put(canonical,'pnpm-lock.yaml','fixture');put(canonical,'package.json','{}');
 git(canonical,'add','.gitignore','pnpm-lock.yaml','package.json');git(canonical,'commit','-qm','seed');
 git(canonical,'update-ref','refs/remotes/origin/main','HEAD');
 const tree=join(base,'tree');git(canonical,'worktree','add','-q','-b','plan/proof',tree);
 put(tree,mount,'');const fd=openSync(join(tree,mount),'r+');ftruncateSync(fd,51*1024**2);closeSync(fd);
 const hash=createHash('sha256').update(readFileSync(join(tree,mount))).digest('hex');
 put(tree,'out/.pins.json',JSON.stringify({published:[mount]}));
 writeManifest(tree,pinsKey(tree,shardfileValidationRevision(tree)),{},{[mount]:hash});
 put(tree,'.owner','owned fixture evidence');put(tree,'public/programs/notes.txt','true work');
 return {base,canonical,tree,keep:join(base,'keep')};
}
function restore(dir,base){const target=join(base,'restored');mkdirSync(target);const r=spawnSync('tar',['-xzf',join(dir,'untracked.tgz'),'-C',target]);expect(r.status).toBe(0);return target;}

test('verified large pin bytes leave a true-work copy and a removable landed tree',()=>{
 const {base,canonical,tree,keep}=fixture();
 // 94d3aa6d0 (QA 11-24 row 48): the generic keep-copy reads the same ledger, so the unchanged pin mount is build output there too.
 expect([...pinMounts(tree)]).toEqual([mount]);
 const before=worktreeState(tree);const {dir,manifest}=keepCopy(tree,{keepRoot:keep});
 expect(manifest.untracked.files).toBe(2);expect(worktreeState(tree)).toBe(before);
 const saved=restore(dir,base);expect(readFileSync(join(saved,'public/programs/notes.txt'),'utf8')).toBe('true work');
 expect(readFileSync(join(saved,'.owner'),'utf8')).toBe('owned fixture evidence');expect(existsSync(join(saved,mount))).toBe(false);
 git(canonical,'worktree','remove',tree);expect(existsSync(tree)).toBe(false);
});

test('changed pin bytes become work and writer snapshots detect them',()=>{
 const {base,tree,keep}=fixture();const before=worktreeState(tree);
 put(tree,mount,'edited pin');expect(worktreeState(tree)).not.toBe(before);
 const {dir,manifest}=keepCopy(tree,{keepRoot:keep});expect(manifest.untracked.files).toBe(3);
 const saved=restore(dir,base);expect(readFileSync(join(saved,mount),'utf8')).toBe('edited pin');expect(existsSync(tree)).toBe(true);
});

test('unknown large bytes, invalid provenance and copy failure keep their source',()=>{
 const {base,tree,keep}=fixture();const unknown=join(tree,'public/programs/unknown.bin');
 const fd=openSync(unknown,'w');ftruncateSync(fd,51*1024**2);closeSync(fd);
 expect(()=>keepCopy(tree,{keepRoot:keep})).toThrow(/50 MiB/u);expect(existsSync(unknown)).toBe(true);rmSync(unknown);
 put(tree,'out/.pins.json','{}');expect(()=>keepCopy(tree,{keepRoot:keep})).toThrow(/50 MiB/u);expect(existsSync(join(tree,mount))).toBe(true);
 put(tree,mount,'small edited work');writeFileSync(join(base,'blocked'),'file');
 expect(()=>keepCopy(tree,{keepRoot:join(base,'blocked/keep')})).toThrow();expect(readFileSync(join(tree,mount),'utf8')).toBe('small edited work');
});
