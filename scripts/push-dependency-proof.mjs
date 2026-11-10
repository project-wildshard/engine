// Actual installed programs: framing collisions and separately installed npr.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';

const selected=process.argv.find(arg=>arg.startsWith('--reader='))?.slice(9)??'scripts/push-dependencies.mjs';
const toolOnly=process.argv.includes('--case=tools');
const {pushDependencyIdentity}=await import(pathToFileURL(resolve(selected)).href);
const parent=resolve('tmp/push-dependency-proof');mkdirSync(parent,{recursive:true});
const work=mkdtempSync(join(parent,'run-')),began=performance.now(),version=JSON.parse(readFileSync('node_modules/valibot/package.json','utf8')).version;
const configured=execFileSync('pnpm',['config','get','cache-dir'],{encoding:'utf8'}).trim();
const cache=configured==='undefined'?join(homedir(),process.platform==='darwin'?'Library/Caches/pnpm':'.cache/pnpm'):configured;
const env={...process.env,XDG_CACHE_HOME:join(work,'cache'),npm_config_cache_dir:cache,npm_config_offline:'true',npm_config_enable_global_virtual_store:'false'};
/** @param {string} cwd @param {string[]} args */
const pnpm=(cwd,args)=>execFileSync('pnpm',['--cache-dir',cache,...args],{cwd,env,encoding:'utf8',stdio:'pipe',timeout:10_000});
try{
 writeFileSync(join(work,'package.json'),JSON.stringify({name:'dependency-proof',private:true,type:'module',packageManager:'pnpm@10.34.9',binDependenciesInstaller:`pnpm --cache-dir=${cache} --config.enableGlobalVirtualStore=false --offline`,dependencies:{valibot:version,'npm-bin-deps':'2.1.0'},binDependencies:{'npm-bin-deps':'2.1.0'}}));
 writeFileSync(join(work,'pnpm-workspace.yaml'),'packages: []\nenableGlobalVirtualStore: false\n');
 pnpm(work,['install','--offline','--ignore-workspace','--config.enableGlobalVirtualStore=false']);
 const module=fileURLToPath(execFileSync(process.execPath,['--input-type=module','-e','console.log(import.meta.resolve("valibot"))'],{cwd:work,env,encoding:'utf8'}).trim());
 const folder=join(dirname(module),'framing-proof');mkdirSync(folder);
 const a=join(folder,'a.mjs'),b=join(folder,'b.txt'),body='export const value=1;\n',tail='real installed payload';
 writeFileSync(a,body);writeFileSync(b,tail);
 const rootPkg=JSON.parse(readFileSync(join(work,'package.json'),'utf8'));delete rootPkg.binDependencies;writeFileSync(join(work,'package.json'),JSON.stringify(rootPkg));
 let before=pushDependencyIdentity(work,env);assert.ok(before);
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',`import{value}from${JSON.stringify(pathToFileURL(a).href)};if(value!==1)throw Error('bad dependency');`],{cwd:work,env,stdio:'pipe'}).status,0);
 const key=`store/${relative(join(work,'node_modules/.pnpm'),b)}`,mode=statSync(b).mode&0o111;
 // Exactly the old unframed stream, absorbed into the preceding file's bytes.
 writeFileSync(a,`${body}\0${key}\0${mode}\0file\0${tail}`);rmSync(b);
 assert.notEqual(spawnSync(process.execPath,[a],{cwd:work,env,stdio:'pipe'}).status,0);
 if(!toolOnly)assert.notEqual(pushDependencyIdentity(work,env),before,'A broken installation cannot collide by absorbing the next file header');
 rmSync(folder,{recursive:true});
 rootPkg.binDependencies={'npm-bin-deps':'2.1.0'};writeFileSync(join(work,'package.json'),JSON.stringify(rootPkg));
 const npr=join(work,'node_modules/.bin/npr');execFileSync(npr,['install'],{cwd:work,env,stdio:'pipe',timeout:10_000});
 // Only installation needs the explicit offline metadata location. From here
 // the actual public tool command uses the supported default pinned manager.
 delete rootPkg.binDependenciesInstaller;writeFileSync(join(work,'package.json'),JSON.stringify(rootPkg));
 const binary=execFileSync(npr,['which','npr'],{cwd:work,env,encoding:'utf8',timeout:5000}).trim();
 assert.ok(binary.startsWith(join(work,'cache')),'Actual public npr command must resolve the owned cache');
 assert.equal(spawnSync(binary,['--help'],{cwd:work,env,stdio:'pipe'}).status,0);
 before=pushDependencyIdentity(work,env);assert.ok(before,'Actual installed npr tool identity must be supported');
 const tool=realpathSync(join(dirname(dirname(binary)),'npm-bin-deps/index.js')),original=readFileSync(tool),temporary=join(dirname(tool),'proof.tmp');
 assert.ok(tool.startsWith(work),'Never change a shared/global installed package');
 writeFileSync(temporary,"#!/usr/bin/env node\nthrow Error('corrupt installed tool');\n",{mode:0o755});renameSync(temporary,tool);
 assert.notEqual(spawnSync(binary,['--help'],{cwd:work,env,stdio:'pipe'}).status,0);
 assert.notEqual(pushDependencyIdentity(work,env),before,'Changed actual npr tool bytes require a full recheck');
 writeFileSync(temporary,original,{mode:0o755});renameSync(temporary,tool);
 assert.equal(pushDependencyIdentity(work,env),before,'Exact installed tool bytes restore the identity');
 console.log(JSON.stringify({realInstalledFramingCollisionRefused:!toolOnly,actualNprInstalledToolBound:true,corruptToolActuallyFails:true,exactToolBytesRestoreIdentity:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
