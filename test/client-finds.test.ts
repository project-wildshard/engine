// @vitest-environment happy-dom
import { expect,test,vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { Flags } from '../src/shared/engine/world/interact/flags';
import { QuestState } from '../src/shared/engine/quest/core';
import { Owned } from '../src/shared/game/loot/Owned';
import { publishBoundQuest } from '../src/shared/game/quest/boundState';
import { installClientFinds } from '../src/client/game/shardfile/clientFinds';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import {fixtureJsonCheck,fixtureFolderFile} from './fixtures/folderFile';

test('orchard finds render the native quest flags without authored view/read hooks',async()=>{
  const scope=new Scope('orchard.finds'),flags=new Flags('orchard.finds'),fragment=vi.fn<ShardContext['bag']['fragment']>();
  const rows={counters:[{label:'Seeds',flags:['orchard.apple']}],sections:[{title:'Harvest',items:[{label:'Apple',icon:'pin',flag:'orchard.apple'}]}]};
  const quest=new QuestState({id:'orchard.quest',title:'Seeds',completeFlag:'orchard.done',steps:[{id:'pick',objective:'Pick',done:{all:['orchard.apple']}}]},flags,undefined,scope);
  publishBoundQuest(scope,quest);
  const runtime=legacyDouble<ShardRuntime>({play:legacyDouble<NonNullable<ShardRuntime['play']>>({owned:new Owned('orchard')}),hooks:{}});
  const product=createShardFolder({slug:'orchard',revision:1,jsonCheck:fixtureJsonCheck,
    shardfile:emptyShardfile({slug:'orchard',name:'Orchard',author:'Fixture',revision:1,seed:1}),sections:new Map(),
    files:new Map([['quests/finds.json',fixtureFolderFile('quests/finds.json',{hash:'finds',url:'/finds.json'})]]),
    read:()=>Promise.resolve(new TextEncoder().encode(JSON.stringify(rows))),check:true});
  const ctx=legacyDouble<ShardContext>({scope,product,game:legacyDouble<ShardContext['game']>({runtime}),bag:legacyDouble<ShardContext['bag']>({fragment})}),feature={kind:'bag.finds',id:'orchard.finds',quest:'orchard.quest',file:'quests/finds.json'};
  try{
    const row=parseClientPlan({version:1,features:[feature]}).features[0];if(row===undefined)throw new Error('Missing finds feature');
    await installClientFinds(ctx,row);const view=fragment.mock.calls[0]?.[1];if(view===undefined)throw new Error('Missing native fragment');
    const panel=document.createElement('div');view.render(panel);expect(panel.querySelectorAll('.found')).toHaveLength(0);
    flags.set('orchard.apple');view.render(panel);expect(panel.querySelectorAll('.found')).toHaveLength(1);expect(panel.textContent).toContain('Apple');
    expect(runtime.hooks.questFlags?.()).toContain('orchard.apple');
    expect(()=>parseClientPlan({version:1,features:[{...feature,render:()=>undefined}]})).toThrow();
  }finally{scope.dispose();}
});

// P0 (f84c97e85e boot smoke, Nalati level.play): the finds borrow the quest the chapter view binds, so they install after it
test('finds install after the chapter view that binds their quest',()=>{
  const finds=CLIENT_FEATURES['bag.finds'],chapter=CLIENT_FEATURES['quest.chapter-view'];
  expect(finds.phase).toBe(chapter.phase);
  expect(finds.rank).toBeGreaterThan(chapter.rank);
});
