// oxlint-disable-next-line import/no-nodejs-modules -- Execute the fixed native input recorder with its original field-proof bound.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Only this case owns and retires its genuinely earned private continuation.
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the maintained native loader and checked-in runner.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The renderer-free loader uses its native file URL.
import {pathToFileURL} from 'node:url';
import {afterAll,expect,test} from 'vitest';
import {chapterWireHash} from './fixtures/headless/chapterHandoff';

mkdirSync(resolve('tmp'),{recursive:true});
const directory=mkdtempSync(resolve('tmp/nalati-chapter-one-')),plains=resolve(directory,'plains.json'),approach=resolve(directory,'approach.json'),bond=resolve(directory,'bond.json'),goat=resolve(directory,'goat.json'),returning=resolve(directory,'return.json'),home=resolve(directory,'home.json');
const rim=resolve(directory,'carving-road.json');
const arrival=resolve(directory,'carving-arrival.json'),carvings=resolve(directory,'carvings.json'),kingEntry=resolve(directory,'king-entry.json'),kingOne=resolve(directory,'king-one.json'),kingTwo=resolve(directory,'king-two.json'),kingVictory=resolve(directory,'king-victory.json');
let plainsHash:string|undefined,approachHash:string|undefined,bondHash:string|undefined,goatHash:string|undefined,returnHash:string|undefined,homeHash:string|undefined,rimHash:string|undefined,arrivalHash:string|undefined,carvingsHash:string|undefined,kingEntryHash:string|undefined,kingOneHash:string|undefined,kingTwoHash:string|undefined;
afterAll(()=>{rmSync(directory,{recursive:true});});
function run(stage:'plains'|'approach'|'bond'|'goat'|'return'|'home'|'carving-road'|'carving-arrival'|'carvings'|'king-entry'|'king-phase-one'|'king-phase-two'|'king-victory',output:string,input?:string,hash?:string):string {
  const started=performance.now();
  const child=spawnSync(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href,
    resolve('test/fixtures/headless/nalati-chapter-one-run.ts'),stage,output,...(input===undefined?[]:[input]),...(hash===undefined?[]:[hash])],{encoding:'utf8',timeout:420_000});
  const outcome=child.stdout+child.stderr+JSON.stringify({error:child.error?.message,signal:child.signal,elapsedMs:performance.now()-started});
  expect(child.error,outcome).toBeUndefined();expect(child.signal,outcome).toBeNull();expect(child.status,outcome).toBe(0);
  expect(child.stdout).toContain(`"story":"chapter-one-${stage}"`);
  const actual=chapterWireHash(readFileSync(output,'utf8'));expect(child.stdout).toContain(`"hash":"${actual}"`);
  process.stdout.write(child.stdout);return actual;
}
test('chapter one earns its horse-plains arrival through the real elder talk and bank walk',()=>{
  plainsHash=run('plains',plains);
},450_000);
test('the earned plains continuation approaches its real stallion and earns the first bucking round',()=>{
  expect(plainsHash,'the first case must earn and fully replay the actual arrival').toBeDefined();
  if(plainsHash===undefined)throw new Error('Missing earned horse-plains continuation');
  expect(chapterWireHash(readFileSync(plains,'utf8'))).toBe(plainsHash);
  approachHash=run('approach',approach,plains,plainsHash);
},450_000);
test('the earned first bucking round tames its stallion through all five real rounds',()=>{
  expect(approachHash,'the preceding case must earn its actual trust and mount').toBeDefined();
  if(approachHash===undefined)throw new Error('Missing earned first breaking round');
  expect(chapterWireHash(readFileSync(approach,'utf8'))).toBe(approachHash);
  bondHash=run('bond',bond,approach,approachHash);
},450_000);
test('the earned horse wins and exactly replays the actual Kokpar pickup and delivery',()=>{
  expect(bondHash,'the preceding case must earn its real companion').toBeDefined();
  if(bondHash===undefined)throw new Error('Missing earned chapter horse');
  expect(chapterWireHash(readFileSync(bond,'utf8'))).toBe(bondHash);
  goatHash=run('goat',goat,bond,bondHash);
},450_000);
test('the earned Kokpar winner rides back to the real graded-road bend',()=>{
  expect(goatHash,'the preceding case must earn its actual delivery').toBeDefined();
  if(goatHash===undefined)throw new Error('Missing earned Kokpar continuation');
  expect(chapterWireHash(readFileSync(goat,'utf8'))).toBe(goatHash);
  returnHash=run('return',returning,goat,goatHash);
},450_000);
test('the earned road return crosses the bridge and finishes the real elder reading once',()=>{
  expect(returnHash,'the preceding case must ride the original return road').toBeDefined();
  if(returnHash===undefined)throw new Error('Missing earned graded-road return');
  expect(chapterWireHash(readFileSync(returning,'utf8'))).toBe(returnHash);
  homeHash=run('home',home,returning,returnHash);
},450_000);
test('the completed first chapter accepts the next story and rides to the real graded-road rim',()=>{
  expect(homeHash,'the first chapter must finish and exactly replay before accepting the next one').toBeDefined();
  if(homeHash===undefined)throw new Error('Missing earned first-chapter completion');
  expect(chapterWireHash(readFileSync(home,'utf8'))).toBe(homeHash);
  rimHash=run('carving-road',rim,home,homeHash);
},450_000);
test('the earned rim continuation rides to the real balbal field and dismounts',()=>{
  expect(rimHash,'the preceding case must earn the real road rim').toBeDefined();
  if(rimHash===undefined)throw new Error('Missing earned graded-road rim');
  expect(chapterWireHash(readFileSync(rim,'utf8'))).toBe(rimHash);
  arrivalHash=run('carving-arrival',arrival,rim,rimHash);
},450_000);
test('three real balbal deaths earn and exactly replay all three chapter carvings',()=>{
  expect(arrivalHash,'the preceding case must actually arrive at the admitted carving field').toBeDefined();
  if(arrivalHash===undefined)throw new Error('Missing earned carving-field arrival');
  expect(chapterWireHash(readFileSync(arrival,'utf8'))).toBe(arrivalHash);
  carvingsHash=run('carvings',carvings,arrival,arrivalHash);
},450_000);

test('the earned three carvings enter and replay the actual King portal and intro',()=>{
  expect(carvingsHash,'the preceding case must earn all three real balbal clues').toBeDefined();
  if(carvingsHash===undefined)throw new Error('Missing earned three-carving continuation');
  expect(chapterWireHash(readFileSync(carvings,'utf8'))).toBe(carvingsHash);
  kingEntryHash=run('king-entry',kingEntry,carvings,carvingsHash);
},450_000);

test('the entered King earns and exactly replays its first real health checkpoint',()=>{
  expect(kingEntryHash,'the preceding case must enter the real King fight').toBeDefined();
  if(kingEntryHash===undefined)throw new Error('Missing earned King entry');
  expect(chapterWireHash(readFileSync(kingEntry,'utf8'))).toBe(kingEntryHash);
  kingOneHash=run('king-phase-one',kingOne,kingEntry,kingEntryHash);
},450_000);


test('the earned first King checkpoint fights through the real shield adds and second health threshold',()=>{
  expect(kingOneHash,'the preceding case must earn the real first King health checkpoint').toBeDefined();
  if(kingOneHash===undefined)throw new Error('Missing earned first King checkpoint');
  expect(chapterWireHash(readFileSync(kingOne,'utf8'))).toBe(kingOneHash);
  kingTwoHash=run('king-phase-two',kingTwo,kingOne,kingOneHash);
},450_000);

test('the earned second King checkpoint wins through real inputs and the original chapter poll',()=>{
  expect(kingTwoHash,'the preceding case must earn the real second King checkpoint').toBeDefined();
  if(kingTwoHash===undefined)throw new Error('Missing earned second King checkpoint');
  expect(chapterWireHash(readFileSync(kingTwo,'utf8'))).toBe(kingTwoHash);
  run('king-victory',kingVictory,kingTwo,kingTwoHash);
},450_000);
