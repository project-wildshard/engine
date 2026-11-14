// oxlint-disable-next-line import/no-nodejs-modules -- Real hint storage is confined to owned scratch.
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Use exact checkout fixture paths.
import {resolve} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import {orderProductBuilds,readProductBuildTimes,recordProductBuildTimes} from '../scripts/product-build-times.mjs';
import {runShardBuildPool} from '../scripts/shard-build-pool.mjs';

const owned:string[]=[];
afterEach(()=>{vi.useRealTimers();for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(resolve('tmp/product-order-'));owned.push(root);return root;}

test('hints change only queue order and preserve unknown/tied jobs without mutating input',()=>{
  const products=[{name:'new'},{name:'small'},{name:'large'},{name:'tied'}],before=[...products];
  const ordered=orderProductBuilds(products,new Map([['large',10],['small',1],['tied',1],['foreign',1e6]]));
  expect(ordered.map(row=>row.name)).toEqual(['large','small','tied','new']);
  expect(products).toEqual(before);expect(new Set(ordered)).toEqual(new Set(products));
  expect(orderProductBuilds(products,new Map())).toEqual(products);
});

test('saved durations merge across builds and corrupt/unwritable hints never block work',()=>{
  const root=fixture();expect(readProductBuildTimes(root).size).toBe(0);
  recordProductBuildTimes(root,new Map([['large',10]]));
  recordProductBuildTimes(root,new Map([['small',1]]));
  recordProductBuildTimes(root,new Map());
  expect([...readProductBuildTimes(root)]).toEqual([['large',10],['small',1]]);
  const file=resolve(root,'.build-times',`${process.platform}-${process.arch}.json`);
  writeFileSync(file,'{"version":1,"products":{"large":-1}}');
  expect(readProductBuildTimes(root).size).toBe(0);
  const broken=resolve(root,'not-a-directory');writeFileSync(broken,'not a cache');
  expect(()=>recordProductBuildTimes(broken,new Map([['small',1]]))).not.toThrow();
  expect(readProductBuildTimes(broken).size).toBe(0);
  mkdirSync(resolve(root,'other')); // The fixture remains usable after refused metadata.
});

test('strict validation seeds an empty runner without overwriting an observed build',()=>{
  const root=fixture(),jobs=[{name:'small'},{name:'large'},{name:'new'}];
  recordProductBuildTimes(root,new Map(),new Map([['small',1],['large',10]]));
  expect(orderProductBuilds(jobs,readProductBuildTimes(root)).map(row=>row.name)).toEqual(['large','small','new']);
  recordProductBuildTimes(root,new Map([['large',20]]),new Map([['large',2],['new',5]]));
  recordProductBuildTimes(root,new Map(),new Map([['large',1],['small',0.1],['new',0.1]]));
  expect([...readProductBuildTimes(root)]).toEqual([['large',20],['small',1],['new',5]]);
});

test('observed queue avoids a long final tail under the same six-worker bound',async()=>{
  vi.useFakeTimers();const products=Array.from({length:7},(_,i)=>({name:String(i),cost:i===6?10:1}));
  const costs=new Map(products.map(row=>[row.name,row.cost]));
  const run=async(ordered:typeof products)=>{
    let active=0,peak=0,elapsed=0;const completed:string[]=[],start=Date.now();
    const work=runShardBuildPool(ordered,async row=>{
      active++;peak=Math.max(peak,active);
      await new Promise(_resolve=>{setTimeout(_resolve,row.cost);});
      active--;completed.push(row.name);elapsed=Date.now()-start;
    });
    await vi.advanceTimersByTimeAsync(11);await work;
    expect(peak).toBe(6);expect(active).toBe(0);expect(completed.sort()).toEqual(products.map(row=>row.name));
    return elapsed;
  };
  expect(await run(orderProductBuilds(products,costs))).toBeLessThan(await run(products));
});
