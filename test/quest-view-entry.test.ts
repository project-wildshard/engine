import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { fixtureProductFile, fixtureJsonCheck } from './fixtures/productFile';
import { installEntryQuestViews } from '../src/client/game/shardfile/clientQuestComposition';
import { admitClientPlan, CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { QuestPageViews } from '../src/client/game/quest/questPageViews';
import type { ShardContext } from '../src/client/game/plugin/context';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

// This partial input exercises entry ordering before the mocked view host.
// It is not a registered QuestStory document.
const row={kind:'quest.views',file:'fixture/quest-views.json'} as const;
afterEach(()=>vi.restoreAllMocks());
function fixture(scope=new Scope('quest-entry'),read?:()=>Promise<Uint8Array>){
  const input={quest:'actual-owner',spawns:'actual-spawns'},bytes=new TextEncoder().encode(JSON.stringify(input));
  const files=new Map([[row.file,fixtureProductFile(row.file,{hash:'view',url:'https://fixture.invalid/view.json'})]]);
  const source=emptyShardfile({slug:'quest-entry',name:'Quest entry',author:'Fixture',revision:1,seed:1});
  const product=createShardProduct({slug:source.identity.slug,revision:1,shardfile:source,jsonCheck:fixtureJsonCheck,
    sections:new Map([['world/scenes',{version:1,libraries:[],materials:[],steps:[]}]]),files,read:read??(()=>Promise.resolve(bytes))});
  // Only this partial entry-ordering projection is a test byte port. The
  // separate registered-story negative below still uses real product intake.
  const named = product.json.bind(product);
  vi.spyOn(product, 'json').mockImplementation(async name => {
    if (name !== row.file) return named(name);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await product.file(name)));
    return value;
  });
  return {scope,input,bytes,files,ctx:legacyDouble<ShardContext>({scope,product})};
}

test('quest view rows keep the original host before the remaining play consumers',async()=>{
  const f=fixture(),stop=new Error('host reached'),install=vi.spyOn(QuestPageViews,'install').mockRejectedValue(stop);
  try{
    expect(admitClientPlan({version:1,features:[row]},f.ctx.product).features).toEqual([row]);
    expect(CLIENT_FEATURES['quest.views'].phase).toBe('play');
    expect(CLIENT_FEATURES['quest.views'].rank).toBeLessThan(CLIENT_FEATURES['view.program'].rank);
    await expect(installEntryQuestViews(f.ctx,row)).rejects.toBe(stop);
    expect(install).toHaveBeenCalledTimes(1); expect(install.mock.calls[0]?.[0]).toBe(f.ctx); expect(install.mock.calls[0]?.[1]).toEqual(f.input);
    f.files.clear();expect(()=>admitClientPlan({version:1,features:[row]},f.ctx.product)).toThrow('admitted data file');
  }finally{f.scope.dispose();}
});

test('leaving during view JSON admission constructs no presentation owner',async()=>{
  let finish=(_bytes:Uint8Array):void=>undefined;
  const waiting=new Promise<Uint8Array>(resolve=>{finish=resolve;});
  const f=fixture(undefined,()=>waiting),install=vi.spyOn(QuestPageViews,'install');
  const pending=installEntryQuestViews(f.ctx,row),rejected=expect(pending).rejects.toThrow('Entry left');
  f.scope.dispose();finish(f.bytes);await rejected;expect(install).not.toHaveBeenCalled();
});

test('a child of a retiring construction refuses before even reading view data',async()=>{
  const construction=new Scope('construction'),scope=construction.child('entry'),read=vi.fn(()=>Promise.resolve(new Uint8Array()));
  const f=fixture(scope,read),install=vi.spyOn(QuestPageViews,'install');construction.onDispose(()=>undefined);
  const retirement=construction.disposeSteps();retirement.next();
  try{
    expect(scope.disposed).toBe(false);expect(scope.disposing).toBe(true);
    await expect(installEntryQuestViews(f.ctx,row)).rejects.toThrow('Entry left');
    expect(read).not.toHaveBeenCalled();expect(install).not.toHaveBeenCalled();
  }finally{for(const step of retirement)void step;construction.dispose();}
});

test('partial view input cannot claim the registered story contract',async()=>{
  const f=fixture(),name='quests/story.json',source=emptyShardfile({slug:'view-contract',name:'View',author:'Fixture',revision:1,seed:1});
  const product=createShardProduct({slug:source.identity.slug,revision:1,shardfile:source,jsonCheck:fixtureJsonCheck,sections:new Map(),
    files:new Map([[name,fixtureProductFile(name,{hash:'view',url:'https://fixture.invalid/view.json'})]]),read:()=>Promise.resolve(f.bytes)});
  try{await expect(product.json(name)).rejects.toThrow('refuses its schema');}
  finally{f.scope.dispose();}
});
