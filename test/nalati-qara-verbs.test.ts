// oxlint-disable-next-line import/no-nodejs-modules -- Each earned stage retains its original bounded child and independent native worker.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the actual earned handoffs private and remove them on every outcome.
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the checked-in runner and owned scratch directory.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Retain the strict renderer-free simulation loader.
import {pathToFileURL} from 'node:url';
import {afterAll,describe,expect,test} from 'vitest';
import {qaraWireHash} from './fixtures/headless/qaraHandoff';

mkdirSync(resolve('tmp'),{recursive:true});
const directory=mkdtempSync(resolve('tmp/nalati-qara-')),night=resolve(directory,'night.json'),unlock=resolve(directory,'unlock.json'),patrol=resolve(directory,'patrol.json');
let nightHash:string|undefined,unlockHash:string|undefined,patrolHash:string|undefined;
afterAll(()=>{rmSync(directory,{recursive:true,force:true});});
function run(stage:'night'|'patrol'|'bow'|'victory',input:string,output:string,hash?:string):string{
  const started=performance.now();
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-qara-run.ts'),stage,input,output,...(hash===undefined?[]:[hash])],{encoding:'utf8',timeout:175_000});
  expect(child.error,child.stdout+child.stderr).toBeUndefined();
  expect(child.status,child.stdout+child.stderr).toBe(0);
  expect(child.stdout).toContain(stage==='victory'?'"story":"nalati-qara-full-fight"':`"story":"qara-${stage}"`);
  process.stdout.write(child.stdout);process.stdout.write(`${JSON.stringify({case:stage,childMs:performance.now()-started})}\n`);
  return child.stdout;
}
describe('the complete earned Qara fight',{concurrent:false,shuffle:false},()=>{
  test('camp travel and natural night earn the original checkpoint',()=>{
    const report=run('night',night,night);nightHash=qaraWireHash(readFileSync(night,'utf8'));
    expect(report).toContain(`"hash":"${nightHash}"`);
  },180_000);
  test('five real night kills earn the checked captain unlock',()=>{
    expect(nightHash).toBeDefined();if(nightHash===undefined)throw new Error('Missing earned night');
    expect(qaraWireHash(readFileSync(night,'utf8'))).toBe(nightHash);
    const report=run('patrol',night,unlock,nightHash);unlockHash=qaraWireHash(readFileSync(unlock,'utf8'));
    expect(report).toContain(`"hash":"${unlockHash}"`);
  },180_000);
  test('the checked captain unlock continues the original bow inputs until the quiver is empty',()=>{
    expect(unlockHash).toBeDefined();if(unlockHash===undefined)throw new Error('Missing checked unlock');
    expect(qaraWireHash(readFileSync(unlock,'utf8'))).toBe(unlockHash);
    const report=run('bow',unlock,patrol,unlockHash);patrolHash=qaraWireHash(readFileSync(patrol,'utf8'));
    expect(report).toContain(`"hash":"${patrolHash}"`);
  },180_000);
  test('the exact earned continuation swaps to sabre and replays the complete victory',()=>{
    expect(patrolHash).toBeDefined();if(patrolHash===undefined)throw new Error('Missing checked patrol');
    expect(qaraWireHash(readFileSync(patrol,'utf8'))).toBe(patrolHash);
    run('victory',patrol,patrol,patrolHash);
  },180_000);
});
