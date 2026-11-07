// Regression: source-span publication must never turn an unknown census into zero.
// oxlint-disable-next-line import/no-nodejs-modules -- Own isolated ruler publication fixtures.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixture files beneath the repository scratch root.
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { componentInventory } from '../scripts/shard-components.mjs';
import { componentSpanReports } from '../scripts/shard-component-spans.mjs';

const shard='nalati-grasslands';
const empty={customSources:[],conversion:{customRuntimeLines:0}};

test('publishes the existing census for every shard, including zero-native rows',()=>{
  const native=['native',...Array.from({length:22},(_,index)=>`native-${index}`)];
  const rows=componentSpanReports('',{
    ...Object.fromEntries(native.map(slug=>[slug,empty])),
    [shard]:{customSources:[{path:'src/server/game/population/pageGroups.ts',kind:'sole-export',name:'PagePopulationPlanner',lines:7}],conversion:{customRuntimeLines:7}},
  },[shard,...native],null);
  expect(Object.keys(rows)).toEqual([shard,...native]);
  expect(Object.keys(rows)).toHaveLength(24);
  // G667 retired this host's C4 override; supplied census lines still publish in full under its C9 fallback.
  expect(rows[shard]).toMatchObject({total:7,counts:{C4:0,C9:7},spans:[{symbol:'PagePopulationPlanner',component:'C9',lines:7}]});
  expect(rows['native']).toMatchObject({total:0,spans:[],measurementError:null});
  expect(()=>componentSpanReports('',{},[shard],null)).toThrow('missing source spans');
});

test('retains class and method symbols without changing any counted line',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ruler-symbols-'));
  const path='src/shards/nalati-grasslands/runtime/facts.ts';
  try {
    mkdirSync(dirname(resolve(root,path)),{recursive:true});
    writeFileSync(resolve(root,path),'export class Runtime {\n  begin() {\n    return 1;\n  }\n}\n');
    const row=componentInventory(root,shard,[{path,kind:'runtime-ts',lines:5}],5);
    expect(row.total).toBe(5);expect(row.counts.C9).toBe(5);
    expect(row.spans.map(entry=>[entry.symbol,entry.start,entry.end,entry.lines])).toEqual([
      ['Runtime',1,1,1],['Runtime.begin',2,4,3],['Runtime',5,5,1],
    ]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('keeps failed census measurements explicitly unknown',()=>{
  const rows=componentSpanReports('',{},[shard],'Incomplete verified products');
  expect(rows[shard]).toMatchObject({total:null,counts:null,spans:null,unknown:null,measurementError:'Incomplete verified products'});
});
