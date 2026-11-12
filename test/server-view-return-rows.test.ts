// SERVER-PARITY SS12 (SS7's follow-up): the server never loads a `view` return row; only the page runs it.
import {expect,test,vi} from 'vitest';
import * as v from 'valibot';
import {DecisionScriptsSchema} from '@wildshard/format/decisionScripts';
import {prepareReturns,serverReturnRows} from '../src/server/game/shardfile/nativeRuntimeLoans';
import {simDecisionRow} from '../src/server/engine/script/decision';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {emptyShardfile} from '../src/shared/host/author';
import type {SimHost} from '@wildshard/engine/sim';
import {Scope} from '../src/shared/engine/app/scope';

const [sim,view]=v.parse(DecisionScriptsSchema,[
  {id:'return.sim',abi:'1.0',side:'sim',module:`blobs/wasm/${'a'.repeat(64)}.wasm`,source:'behaviour/sim.as',binding:{shard:true},onFail:'hold',
    on:['start'],reads:[],commands:[],stateVersion:1,state:[],params:{}},
  {id:'made.up.view',abi:'1.0',side:'view',module:`blobs/wasm/${'b'.repeat(64)}.wasm`,source:'behaviour/view.as',binding:{shard:true},onFail:'hold',
    on:['start'],reads:[],commands:[],stateVersion:1,state:[],params:{}},
]);
if(sim===undefined||view===undefined)throw new Error('fixture rows');

test('a made-up view return row is dropped before the server prepares or lends return modules',async()=>{
  expect(serverReturnRows([sim,view]).map(row=>row.id)).toEqual([sim.id]);
  const source=emptyShardfile({slug:'view-place',name:'View',author:'Fixture',revision:1,seed:7});
  const product=createShardProduct({slug:'view-place',revision:1,shardfile:source,
    sections:new Map([['actors/return-scripts',[sim,view]]]),files:new Map(),read:()=>Promise.reject(new Error('no read'))});
  const prepare=vi.spyOn(ReturnProgram,'prepareModules').mockResolvedValue();
  const lend=vi.spyOn(ReturnProgram,'lendModules').mockReturnValue();
  const scope=new Scope('server.returns');
  try{
    const install=await prepareReturns({product,assets:new Map()});
    install({scope} as unknown as SimHost);
    expect(prepare.mock.calls[0]?.[2].map(row=>row.id)).toEqual([sim.id]);
    expect(lend.mock.calls[0]?.[2].map(row=>row.id)).toEqual([sim.id]);
  }finally{prepare.mockRestore();lend.mockRestore();scope.dispose();}
});

test('sim/scripts and spawn rows narrow to sim and refuse a view row by name',()=>{
  expect(simDecisionRow(sim).side).toBe('sim');
  expect(()=>simDecisionRow(view)).toThrow('Decision script made.up.view is a view row');
});
