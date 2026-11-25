// Meta QA 11-25 row 34 (J505): keep-copy refused a worktree over 50 MiB and saved nothing, then the worktree was
// removed by hand and a lane's update script in its ignored tmp/ was lost. Over the cap keep-copy now still saves the
// unpushed commits and the small source and scripts, names that copy, and keeps refusing the removal.
import {spawnSync} from 'node:child_process';
import {closeSync,existsSync,ftruncateSync,mkdirSync,mkdtempSync,openSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {keepCopy,partialSelection,PartialKeepCopyError,worktreeState} from '../../scripts/keep-copy.mjs';

const KEEP_COPY=resolve('scripts/keep-copy.mjs');
const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
const git=(cwd,...args)=>{const result=spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd,env,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();};
const put=(root,path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
/** A sparse file: its size counts against the cap without using the disk. */
const big=(root,path,mib)=>{mkdirSync(dirname(join(root,path)),{recursive:true});const fd=openSync(join(root,path),'w');ftruncateSync(fd,mib*1024**2);closeSync(fd);};
const SCRIPT='tmp/opus-qa-play/local-update.mjs';

/** The qa-play shape: a plan worktree with an unpushed commit, a lane script and big captures in its ignored tmp/. */
function overCap(){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest');mkdirSync(parent,{recursive:true});
 const base=mkdtempSync(join(parent,'keep-copy-'));roots.push(base);
 const canonical=join(base,'repo');mkdirSync(canonical);git(canonical,'init','-q','-b','main');
 put(canonical,'.gitignore','/tmp/\n');put(canonical,'src/a.ts','export const a = 1;\n');
 git(canonical,'add','.gitignore','src/a.ts');git(canonical,'commit','-qm','seed');
 git(canonical,'update-ref','refs/remotes/origin/main','HEAD');
 const tree=join(base,'tree');git(canonical,'worktree','add','-q','-b','plan/qa-play',tree);
 put(tree,'src/a.ts','export const a = 2;\n');git(tree,'commit','-qam','unpushed work');
 put(tree,SCRIPT,'export const update = "row 7";\n');
 big(tree,'tmp/opus-qa-play/stg-profile.cpuprofile',60);
 put(tree,'tmp/opus-qa-play/clone/node_modules/dep/index.js','module.exports = 1;\n');
 put(tree,'src/b.ts','export const b = "uncommitted";\n');
 return {base,canonical,tree,keep:join(base,'keep'),head:git(tree,'rev-parse','HEAD')};
}

test('over the cap: the unpushed commit and the script survive, the copy is named, and removal stays refused',()=>{
 const {base,canonical,tree,keep,head}=overCap();
 const cli=spawnSync(process.execPath,[KEEP_COPY,tree],{env:{...env,WS_SESSION_KEEP_ROOT:keep},encoding:'utf8'});
 expect(cli.status,cli.stderr).toBe(2);
 const dir=cli.stdout.trim();
 expect(dir.startsWith(join(keep,new Date().toISOString().slice(0,10)))).toBe(true);
 expect(cli.stderr).toContain(`partial copy saved at ${dir}`);
 expect(cli.stderr).toMatch(/over the 50 MiB cap.*unpushed commits bundled.*Removal refused/u);
 // The unpushed commit: a fresh clone takes the published base, then the bundle's commit.
 const restored=join(base,'restored');mkdirSync(restored);git(restored,'init','-q');
 git(restored,'fetch','-q',canonical,'refs/remotes/origin/main');
 git(restored,'fetch','-q',join(dir,'unpublished.bundle'),'HEAD');
 expect(git(restored,'rev-parse','FETCH_HEAD')).toBe(head);
 expect(git(restored,'show','FETCH_HEAD:src/a.ts')).toBe('export const a = 2;');
 // The script and the uncommitted source; never the capture or nested node_modules.
 const files=join(base,'files');mkdirSync(files);
 expect(spawnSync('tar',['-xzf',join(dir,'untracked.tgz'),'-C',files]).status).toBe(0);
 expect(readFileSync(join(files,SCRIPT),'utf8')).toBe('export const update = "row 7";\n');
 expect(readFileSync(join(files,'src/b.ts'),'utf8')).toContain('uncommitted');
 expect(existsSync(join(files,'tmp/opus-qa-play/stg-profile.cpuprofile'))).toBe(false);
 expect(existsSync(join(files,'tmp/opus-qa-play/clone/node_modules/dep/index.js'))).toBe(false);
 const skipped=readFileSync(join(dir,'SKIPPED.txt'),'utf8');
 expect(skipped).toContain(`${60*1024**2}\ttmp/opus-qa-play/stg-profile.cpuprofile\n`);
 expect(skipped).toContain('tmp/opus-qa-play/clone/node_modules/dep/index.js');
 const manifest=JSON.parse(readFileSync(join(dir,'MANIFEST.json'),'utf8'));
 expect(manifest).toMatchObject({bundle:true,untracked:{files:2},partial:{skippedFiles:2,list:'SKIPPED.txt'}});
 // The worktree.mjs removal command chains on keep-copy: the refusal keeps the tree.
 const chained=spawnSync('sh',['-c',`node '${KEEP_COPY}' '${tree}' && git worktree remove '${tree}'`],{cwd:canonical,env:{...env,WS_SESSION_KEEP_ROOT:keep},encoding:'utf8'});
 expect(chained.status).toBe(2);
 expect(existsSync(join(tree,SCRIPT))).toBe(true);
 expect(git(tree,'rev-parse','HEAD')).toBe(head);
});

test('the API throws PartialKeepCopyError after writing; the over-cap snapshot is cheap and still sees edits',()=>{
 const {tree,keep}=overCap();
 const before=worktreeState(tree);
 expect(JSON.parse(before)[0]).toBe('over-cap');
 let thrown;
 try{keepCopy(tree,{keepRoot:keep});}catch(error){thrown=error;}
 expect(thrown).toBeInstanceOf(PartialKeepCopyError);
 expect(existsSync(join(thrown.keepDir,'untracked.tgz'))).toBe(true);
 expect(worktreeState(tree)).toBe(before);
 put(tree,SCRIPT,'export const update = "edited";\n');
 expect(worktreeState(tree)).not.toBe(before);
});

test('the partial split keeps small source, smallest first, and skips captures, big files and nested installs',()=>{
 const {tree}=overCap();
 put(tree,'tmp/lane/shot.png','png');put(tree,'tmp/lane/run.log','log');put(tree,'tmp/lane/Makefile','all:');
 big(tree,'tmp/lane/huge.json',2);put(tree,'tmp/lane/.owner','lane');
 const files=['tmp/lane/shot.png','tmp/lane/run.log','tmp/lane/Makefile','tmp/lane/huge.json','tmp/lane/.owner',SCRIPT,'tmp/opus-qa-play/clone/node_modules/dep/index.js'];
 const {kept,skipped}=partialSelection(tree,files);
 expect(kept).toEqual(['tmp/lane/.owner','tmp/lane/Makefile',SCRIPT]);
 expect(skipped.map(({file})=>file).sort()).toEqual(['tmp/lane/huge.json','tmp/lane/run.log','tmp/lane/shot.png','tmp/opus-qa-play/clone/node_modules/dep/index.js']);
});

test('under the cap nothing changes: a full copy, no SKIPPED.txt, no throw',()=>{
 const {tree,keep}=overCap();
 rmSync(join(tree,'tmp/opus-qa-play/stg-profile.cpuprofile'));
 const {dir,manifest}=keepCopy(tree,{keepRoot:keep});
 expect(manifest.partial).toBe(false);expect(manifest.untracked).toMatchObject({files:3});
 expect(existsSync(join(dir,'SKIPPED.txt'))).toBe(false);
 expect(JSON.parse(worktreeState(tree))[0]).toBe('full');
});
