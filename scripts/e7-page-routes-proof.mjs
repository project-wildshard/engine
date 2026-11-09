// Manual, under 10 s; never a hook. Optional argv is an old-helper control.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const helper=resolve(process.argv[2]??'scripts/e7-page-routes.mjs');
const temporary=resolve('tmp');mkdirSync(temporary,{recursive:true});
const root=mkdtempSync(resolve(temporary,'e7-routes-proof-'));
/** @param {string[]} args */
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);git(['config','user.name','E7 fixture']);git(['config','user.email','e7-fixture@example.invalid']);
 writeFileSync(resolve(root,'.gitignore'),'.vercel/\n');writeFileSync(resolve(root,'source.txt'),'committed source\n');
 git(['add','--','.gitignore','source.txt']);git(['commit','--quiet','-m','test: seed routing fixture']);
 const build=git(['rev-parse','HEAD']),output=resolve(root,'.vercel/output');mkdirSync(resolve(output,'static'),{recursive:true});
 writeFileSync(resolve(root,'.vercel/project.json'),JSON.stringify({projectName:'wildshard-e7-staging',projectId:'prj_FpkS6hGufxXYPuU44ILo1vArz0z6'}));
 writeFileSync(resolve(output,'static/version.json'),JSON.stringify({build,saveEpoch:1}));
 writeFileSync(resolve(output,'static/index.html'),'/releases/staging.json');
 writeFileSync(resolve(output,'config.json'),JSON.stringify({routes:[{handle:'filesystem'}]}));
 execFileSync(process.execPath,[helper,root]);
 const first=readFileSync(resolve(output,'config.json'),'utf8');
 assert.equal(JSON.parse(first).routes[0].dest,'https://wildshard-singleplayer.vercel.app/api/$1');
 execFileSync(process.execPath,[helper,root]);assert.equal(readFileSync(resolve(output,'config.json'),'utf8'),first,'Clean routing is idempotent');
 writeFileSync(resolve(root,'source.txt'),'loose foreign edit\n');
 const dirty=spawnSync(process.execPath,[helper,root],{encoding:'utf8'});
 assert.notEqual(dirty.status,0,'A stamped HEAD must not admit dirty build source');
 assert.match(dirty.stderr,/E7 publication requires a clean source tree/u);
 assert.equal(readFileSync(resolve(output,'config.json'),'utf8'),first,'Refusal must not rewrite output');
 console.log('PASS clean/idempotent routes; dirty HEAD-stamped source refused before output write');
}finally{rmSync(root,{recursive:true,force:true});}
