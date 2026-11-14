import {expect,test,vi} from 'vitest';
import {SceneDressing} from '../../../client/game/shardfile/sceneDressing';
import {Scope} from '@wildshard/engine/app/scope';
import type {ShardContext} from '../../../client/game/plugin/context';
import type {ShardFolder} from '../../../shared/game/shardfile/shardFolder';
import type {ShardRuntime} from '../../../shared/game/shard/runtime';
import type {ShardWorld} from '../shard/world';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

const rows={name:'pending-contacts',catalogues:[],packs:{},layers:[],animations:[],
  geometry:{shape:{kind:'file',file:'unread.bin',row:{attrs:[],count:0,index:null,indexCount:0,box:false,expand:false}}},
  materials:{paint:{kind:'painterly',rim:.2,bands:.5}},
  staticModels:[{model:{id:'fixture/contact-file',name:'Contact',file:'src/server/game/shardfile/scene-contact-files.test.ts',category:'props',pipeline:'code',defaults:{}},geometry:'shape',material:'paint'}],
  statics:[{name:'contact',tris:0,geometry:{shape:'shape'},materials:{paint:'paint'},recipe:{version:1,root:'mesh',materials:[{kind:'port',id:'paint',source:'paint'}],nodes:[{kind:'mesh',id:'mesh',geometry:'shape',material:'paint',missing:'empty'}]},
    members:[{model:'fixture/contact-file',draw:'single',placements:[{x:0,y:0,z:0}],boxes:[-.5,-.5,-.5,.5,.5,.5],contacts:{kind:'packed-hulls',file:'contacts.bin',origins:[[0,0,0,12]],surface:'rock'}}]}]};
function fixture(){
  const parent=new Scope('contacts-parent'),scope=parent.child('contacts');
  let finish:(bytes:Uint8Array)=>void=()=>{throw new Error('Missing pending contact read');};
  const pending=new Promise<Uint8Array>(resolve=>{finish=resolve;}),read=vi.fn(()=>pending);
  const product={hasFile:()=>true,file:read},runtime={world:legacyDouble<ShardWorld>({})};
  const game={runtime:legacyDouble<ShardRuntime>(runtime)},system=vi.fn();
  const surface={scope,product:legacyDouble<ShardFolder>(product),game:legacyDouble<ShardContext['game']>(game),system},ctx=legacyDouble<ShardContext>(surface);
  return{parent,scope,product,runtime,game,surface,ctx,read,system,finish};
}

test('missing declared contact files refuse before any byte read or owner publication',async()=>{
  const f=fixture();f.product.hasFile=()=>false;
  try{await expect(SceneDressing.install(f.ctx,rows)).rejects.toThrow('Missing scene contact file');
    expect(f.read).not.toHaveBeenCalled();expect(f.system).not.toHaveBeenCalled();expect(()=>SceneDressing.current(f.ctx)).toThrow('not installed');
  }finally{f.parent.dispose();}
});

test.each(['scope','product','reader','hasFile','world','retired','ancestor'] as const)('contact file intake refuses replaced %s before native allocation',async kind=>{
  const f=fixture(),loading=SceneDressing.install(f.ctx,rows);expect(f.read).toHaveBeenCalledTimes(1);
  const replacement=new Scope('replacement');
  if(kind==='scope')f.surface.scope=replacement;
  else if(kind==='product')f.surface.product=legacyDouble<ShardFolder>({hasFile:()=>true,file:vi.fn(()=>Promise.resolve(new Uint8Array()))});
  else if(kind==='reader')f.product.file=vi.fn(()=>Promise.resolve(new Uint8Array()));
  else if(kind==='hasFile')f.product.hasFile=()=>true;
  else if(kind==='world')f.runtime.world=legacyDouble<ShardWorld>({});
  else if(kind==='retired')f.scope.dispose();
  else{f.parent.onDispose(()=>undefined);f.parent.disposeSteps().next();}
  f.finish(new Uint8Array());
  try{await expect(loading).rejects.toThrow('owner changed or retired');expect(f.system).not.toHaveBeenCalled();}
  finally{replacement.dispose();f.parent.dispose();}
});
