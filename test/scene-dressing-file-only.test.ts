import {expect,test,vi} from 'vitest';
import {SceneDressing} from '../src/client/game/shardfile/sceneDressing';
import type {ShardContext} from '../src/client/game/plugin/context';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

const row={attrs:[['position','f32',3,false]],count:1,index:null,indexCount:0,box:false,expand:false};
const inline={kind:'inline',data:'eJxjYEAAAAAMAAE=',row};
const named={kind:'file',file:'shape.bin',row};

test.each([false,true])('inline geometry refuses before owner, product or cache access (named prefix=%s)',async prefix=>{
  const reached=vi.fn(()=>{throw new Error('Owner capability reached');});
  const ctx=legacyDouble<ShardContext>({get scope(){return reached();},get product(){return reached();}});
  const geometry=prefix?{first:named,last:inline}:{first:inline};
  await expect(SceneDressing.install(ctx,{name:'file-only',geometry,materials:{},catalogues:[],packs:{},layers:[],statics:[],animations:[]}))
    .rejects.toThrow('Scene geometry requires named files');
  expect(reached).not.toHaveBeenCalled();
});
