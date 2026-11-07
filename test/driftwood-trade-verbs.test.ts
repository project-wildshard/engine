// oxlint-disable-next-line import/no-nodejs-modules -- One fixed native tape and independent replay own a bounded child.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- No caller-selected executable or fixture source.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- This ordered file owns and retires its earned continuations.
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The unchanged native loader refuses renderer dependencies.
import { pathToFileURL } from 'node:url';
import { afterAll,describe,expect,test } from 'vitest';
import {tradeHash} from './fixtures/headless/tradeHandoff';
import * as v from 'valibot';

const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const result = v.object({ story: v.literal('driftwood-trade'), ticks: count, commands: count, parts: count,
  coins: count, price: count, earned: count, spent: count, owned: v.array(v.string()), omitted: count,
  restoredSuffix: count, identicalPhysics: count, canonicalPhysics: count });

mkdirSync(resolve('tmp'),{recursive:true});
const directory=mkdtempSync(resolve('tmp/driftwood-trade-')),counter=resolve(directory,'counter.json'),purse=resolve(directory,'purse.json'),bought=resolve(directory,'buy.json');
let counterHash:string|undefined,purseHash:string|undefined;
afterAll(()=>{rmSync(directory,{recursive:true});});
function run(stage:'counter'|'purse'|'buy',output:string,input?:string,hash?:string):string {
  const child = spawnSync(process.execPath, ['--experimental-transform-types', '--import',
    pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href, resolve('test/fixtures/headless/driftwood-trade-run.ts'),stage,output,
    ...(input===undefined?[]:[input]),...(hash===undefined?[]:[hash])],
  { encoding: 'utf8', timeout: 30_000 });
  const outcome = JSON.stringify({ status: child.status, signal: child.signal, error: child.error?.message });
  expect(child.error, `${outcome}\n${child.stdout}${child.stderr}`).toBeUndefined();
  expect(child.status, `${outcome}\n${child.stdout}${child.stderr}`).toBe(0);
  const actual=tradeHash(readFileSync(output,'utf8'));expect(child.stdout).toContain(`"hash":"${actual}"`);
  process.stdout.write(child.stdout);return child.stdout;
}

describe('one original Driftwood trade tape across earned native checkpoints',{concurrent:false,shuffle:false},()=>{
  test('walk to the real counter and refuse out-of-reach and empty-purse BUY',()=>{
    const output=run('counter',counter);expect(output).toContain('"story":"driftwood-trade-counter"');
    counterHash=tradeHash(readFileSync(counter,'utf8'));
  },35_000);
  test('the earned counter continuation funds its real purse through the original kills',()=>{
    expect(counterHash,'the first case must really walk to and replay the counter').toBeDefined();
    if(counterHash===undefined)throw new Error('Missing earned counter continuation');
    expect(tradeHash(readFileSync(counter,'utf8'))).toBe(counterHash);
    const output=run('purse',purse,counter,counterHash);expect(output).toContain('"story":"driftwood-trade-purse"');
    purseHash=tradeHash(readFileSync(purse,'utf8'));
  },35_000);
  test('real kills fund Maren BUY and fresh restoration; omitted BUY cannot grant or spend', () => {
    expect(purseHash,'the preceding case must really earn and replay the purse').toBeDefined();
    if(purseHash===undefined)throw new Error('Missing earned purse continuation');
    expect(tradeHash(readFileSync(purse,'utf8'))).toBe(purseHash);
    const stdout=run('buy',bought,purse,purseHash);
  const line = stdout.split('\n').find(row => row.includes('"story":"driftwood-trade"'));
  if (line === undefined) throw new Error('Missing actual earned Driftwood BUY replay');
  const actual = v.parse(result, JSON.parse(line));
  expect(actual.ticks).toBeGreaterThan(0); expect(actual.commands).toBeGreaterThan(0); expect(actual.parts).toBeGreaterThan(1);
  expect(actual.price).toBeGreaterThan(0); expect(actual.earned).toBeGreaterThanOrEqual(actual.price);
  expect(actual.spent).toBe(actual.price); expect(actual.coins).toBe(actual.earned - actual.price);
  expect(actual.owned).toContain('cape'); expect(actual.omitted).toBeGreaterThan(0);
  expect(actual.restoredSuffix).toBe(120); expect(actual.identicalPhysics + actual.canonicalPhysics).toBeGreaterThan(0);
  console.info(line);
}, 35_000);
});
