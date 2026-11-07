// oxlint-disable-next-line import/no-nodejs-modules -- Execute each bounded native capture and independent replay.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the genuinely earned continuation private to these bounded cases and remove it on every outcome.
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the checked-in runner, loader and owned scratch directory.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The same renderer-free loader as every trusted native worker.
import {pathToFileURL} from 'node:url';
import {afterAll,describe,expect,test} from 'vitest';
import {titanWireHash} from './fixtures/headless/titanHandoff';

mkdirSync(resolve('tmp'),{recursive:true});
const directory=mkdtempSync(resolve('tmp/nalati-titan-')),storm=resolve(directory,'storm.json'),fire=resolve(directory,'fire.json'),retry=resolve(directory,'retry.json');
let stormHash:string|undefined,fireHash:string|undefined,retryHash:string|undefined;
afterAll(()=>{rmSync(directory,{recursive:true,force:true});});
function run(stage:'entry'|'opening'|'retry'|'victory',input:string,hash?:string,output?:string):string{
  const started=performance.now();
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-titan-run.ts'),stage,input,...(hash===undefined?[]:[hash]),...(output===undefined?[]:[output])],{encoding:'utf8',timeout:300_000});
  expect(child.status,child.stdout+child.stderr+String(child.error??'')+(child.signal??'')).toBe(0);
  expect(child.stdout).toContain(`"story":"titan-${stage}"`);
  process.stdout.write(child.stdout);process.stdout.write(`${JSON.stringify({case:stage,childMs:performance.now()-started})}\n`);return child.stdout;
}
describe('the complete natural Titan fight',()=>{
  test('natural storm, real entry and borrowed mount earn the checked cairn checkpoint',()=>{
    const report=run('entry',storm),hash=titanWireHash(readFileSync(storm,'utf8'));
    expect(report).toContain(`"hash":"${hash}"`);stormHash=hash;
  },330_000);
  test('the exact storm checkpoint earns the checked fire phase through real combat',()=>{
    expect(stormHash,'the first case must physically earn its storm checkpoint').toBeDefined();
    if(stormHash===undefined)throw new Error('Missing checked storm continuation');
    expect(titanWireHash(readFileSync(storm,'utf8'))).toBe(stormHash);
    const report=run('opening',storm,stormHash,fire),hash=titanWireHash(readFileSync(fire,'utf8'));
    expect(report).toContain(`"hash":"${hash}"`);fireHash=hash;
  },330_000);
  test('the exact earned fire continuation earns the real death and retry checkpoint',()=>{
    expect(fireHash,'the preceding case must earn and fully replay its checkpoint').toBeDefined();
    if(fireHash===undefined)throw new Error('Missing checked Titan continuation');
    expect(titanWireHash(readFileSync(fire,'utf8'))).toBe(fireHash);
    const report=run('retry',fire,fireHash,retry),hash=titanWireHash(readFileSync(retry,'utf8'));
    expect(report).toContain(`"hash":"${hash}"`);retryHash=hash;
  },330_000);
  test('the exact retry and input cursor win and replay the remaining fight',()=>{
    expect(retryHash,'the preceding case must earn and check its actual retry').toBeDefined();
    if(retryHash===undefined)throw new Error('Missing checked retry continuation');
    expect(titanWireHash(readFileSync(retry,'utf8'))).toBe(retryHash);
    run('victory',retry,retryHash);
  },330_000);
});
