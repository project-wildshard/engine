// E7 static pages keep the current game API; this is not the API cutover.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve(process.argv[2]??'.'),project=JSON.parse(readFileSync(resolve(root,'.vercel/project.json'),'utf8'));
const projects=new Map([['wildshard-e7','prj_99LWfc8go9eVql5pcT292Tfvp4p7'],['wildshard-e7-staging','prj_FpkS6hGufxXYPuU44ILo1vArz0z6']]);
assert.ok(projects.has(project.projectName));assert.equal(project.projectId,projects.get(project.projectName));
const output=resolve(root,'.vercel/output'),version=JSON.parse(readFileSync(resolve(output,'static/version.json'),'utf8'));
assert.equal(version.build,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());assert.equal(version.saveEpoch,1);
const html=readFileSync(resolve(output,'static/index.html'),'utf8'),channel=project.projectName==='wildshard-e7'?'production':'staging';
assert.ok(html.includes(`/releases/${channel}.json`));assert.ok(!html.includes(`/releases/${channel==='production'?'staging':'production'}.json`));
const file=resolve(output,'config.json'),config=JSON.parse(readFileSync(file,'utf8'));
const route={src:'^/api/(errors|telemetry|inbox)$',dest:'https://wildshard-singleplayer.vercel.app/api/$1',headers:{'Cache-Control':'no-store'}};
assert.ok(Array.isArray(config.routes));const existing=config.routes.findIndex((/** @type {{src?:string}} */row)=>row.src===route.src);
if(existing!==-1)assert.deepEqual(config.routes[existing],route);else{const phase=config.routes.findIndex((/** @type {{handle?:string}} */row)=>row.handle!==undefined);config.routes.splice(phase===-1?config.routes.length:phase,0,route);writeFileSync(file,`${JSON.stringify(config,null,2)}\n`);}
console.log('E7 current API routes',JSON.stringify({project:project.projectName,build:version.build,channel,origin:'https://wildshard-singleplayer.vercel.app',routes:['errors','telemetry','inbox']}));
