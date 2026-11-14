import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {assertBuiltTestFolders} from './built-folder.mjs';
import {OPEN_PLOTS_2,OPEN_PLOTS_3} from '../test/fixtures/openPlotGroups.ts';

/** @param {readonly string[]} args @param {string} name @param {string} fallback */
const flag=(args,name,fallback)=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;

/** Select actual route names before launching; an empty selection cannot claim zero stuck.
 * @param {unknown} source @param {readonly string[]} args */
export function nativeWalkSelection(source,args){
  if(source===null||typeof source!=='object'||Array.isArray(source))throw new Error('Invalid physics route catalogue');
  const shard=flag(args,'shard',''),leg=flag(args,'leg',''),repeat=Number(flag(args,'repeat','1'));
  if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw new Error('--repeat must be 1…10');
  let count=0;const slugs=new Set();
  for(const [slug,rows] of Object.entries(source)){
    if(slug.startsWith('$')||(shard!==''&&slug!==shard))continue;
    if(!Array.isArray(rows))throw new Error(`Invalid physics routes for ${slug}`);
    for(const row of rows){
      if(row===null||typeof row!=='object'||!('name' in row)||typeof row.name!=='string')throw new Error(`Unnamed physics route for ${slug}`);
      if(leg===''||row.name===leg){count+=repeat;slugs.add(slug);}
    }
  }
  if(count===0)throw new Error('No native physics route matches the selection');
  return {shard,leg,repeat,count,slugs:[...slugs]};
}

/** A successful process alone cannot excuse an uncollected or partial route proof.
 * @param {unknown} report @param {number} expected */
export function assertNativeWalkResult(report,expected){
  if(report===null||typeof report!=='object'||!('success' in report)||report.success!==true
    ||!('numPassedTests' in report)||report.numPassedTests!==expected
    ||!('numFailedTests' in report)||report.numFailedTests!==0)
    throw new Error(`Incomplete native physics proof: expected ${expected} passing route legs`);
}

/** Select each resident test module once; keep all routes of a shard together.
 * @param {readonly string[]} slugs */
export function nativeWalkTestFiles(slugs){
  // TEST-SPEED TS5: the open plots run in three files and Blender Template in its own (test/fixtures/openPlotGroups.ts).
  return [...new Set(slugs.map(slug=>slug==='driftwood-isle'?'test/physics-headless.test.ts'
    :OPEN_PLOTS_2.has(slug)?'test/physics-open-plots-headless-2.test.ts'
    :OPEN_PLOTS_3.has(slug)?'test/physics-open-plots-headless-3.test.ts'
    :slug.startsWith('open-plot-')?'test/physics-open-plots-headless.test.ts'
    :slug==='blender-template'?'test/physics-blender-template-headless.test.ts'
    :slug==='nalati-grasslands'?'test/physics-nalati-headless.test.ts':'test/physics-shards-headless.test.ts'))];
}

/** The normal checked-product tests own every physical assertion and resident lifetime.
 * @param {string} root @param {readonly string[]} args */
export function runNativePhysicsWalk(root,args){
  if(flag(args,'url','')!==''||flag(args,'serve','')!=='')throw new Error('Native physics reads current checked products, not a browser preview');
  if(args.includes('--video'))throw new Error('Native physics has no video; use the browser pose or trail diagnostic');
  if(flag(args,'tier','phone')!=='phone'||flag(args,'entry','shard')!=='shard'
    ||args.some(arg=>['--query=','--settings=','--device-save=','--expect-system='].some(prefix=>arg.startsWith(prefix))))
    throw new Error('Browser variants require the browser pose, grid or trail diagnostic');
  const route=resolve(root,flag(args,'route','scripts/physics-route.json'));
  const selection=nativeWalkSelection(JSON.parse(readFileSync(route,'utf8')),args);
  const files=nativeWalkTestFiles(selection.slugs);
  if(!args.includes('--no-build')){
    const products=JSON.parse(readFileSync(join(root,'scripts/test-folders.json'),'utf8'));
    const slugs=[...new Set(files.flatMap(file=>products[file]??[]))];
    if(slugs.length===0)throw new Error('Missing native physics product inventory');
    const build=spawnSync('python3',[join(root,'scripts/heavy-lane.py'),'build','--',process.execPath,
      join(root,'scripts/build-shardfiles.mjs'),'--reuse',`--shard=${slugs.join(',')}`],{cwd:root,stdio:'inherit'});
    if(build.status!==0)return {status:build.status??1,legs:selection.count,report:null};
  }
  // Use the same strict reader as CI before the reporter can omit blocked suites.
  assertBuiltTestFolders(root,files);
  const out=resolve(root,flag(args,'out','tmp/physics'));mkdirSync(out,{recursive:true});
  const report=join(out,`${flag(args,'label','native-walk')}-${new Date().toISOString().replaceAll(':','-')}-${process.pid}.json`);
  const run=spawnSync(process.execPath,[join(root,'scripts/vitest-tmp.ts'),'run',
    ...files,'--reporter=json',`--outputFile=${report}`],
  {cwd:root,stdio:'inherit',env:{...process.env,WS_PHYSICS_ROUTE:route,WS_PHYSICS_SHARD:selection.shard,
    WS_PHYSICS_LEG:selection.leg,WS_PHYSICS_REPEAT:String(selection.repeat)}});
  if(run.status!==0)return {status:run.status??1,legs:selection.count,report};
  assertNativeWalkResult(JSON.parse(readFileSync(report,'utf8')),selection.count);
  console.log(`Node physics: ${selection.count} route legs passed; zero stuck or bounds failures. ${report}`);
  return {status:0,legs:selection.count,report};
}
