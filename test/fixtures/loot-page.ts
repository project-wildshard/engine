import {enteredLootPresentation} from '../../src/client/game/loot/runtime';
import {parseRows} from '@wildshard/format/rows';
import type {declaredLootEconomy} from '../../src/shared/game/shard/declaredRows';
import type {Scope} from '../../src/shared/engine/app/scope';
import {QuestState} from '../../src/shared/engine/quest/core';
import type {Flags} from '../../src/shared/engine/world/interact/flags';
import type {Owned} from '../../src/shared/game/loot/Owned';
import type {Audio} from '../../src/client/engine/audio/Audio';
import {publishBoundQuest} from '../../src/shared/game/quest/boundState';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import type {ShardContext} from '../../src/client/game/plugin/context';
import type {ShardRuntime} from '../../src/shared/game/shard/runtime';
import {createShardProduct} from '../../src/shared/game/shardfile/shardProduct';
import {emptyShardfile} from '../../src/shared/host/author';
import { DRIFTWOOD_LOOT as LOOT } from '../../src/shards/driftwood-isle/generators/loot';

/** Real saved flags/health/ownership, under a page whose unused services refuse. */
export function fixtureLootPresentation(o:{scope:Scope;economy:ReturnType<typeof declaredLootEconomy>;adventure:{flags:Flags};owned:Owned;health:{readonly attributes:{readonly maxHealth:number}};audio:{readonly voices:Pick<Audio['voices'],'play'>}}){
 const rows=parseRows({strikes:[],weather:[],days:[],species:[],looks:[],compendiums:[],loot:[{...LOOT,economy:o.economy}]}),view=o.economy.presentation;
 if(view===undefined)throw new Error('Missing admitted shipping loot view');
 const quest=new QuestState({id:view.quest,title:'Shipping loot',completeFlag:'fixture.done',steps:[{id:'wait',objective:'Wait',done:{all:['fixture.never']}}]},o.adventure.flags,undefined,o.scope);publishBoundQuest(o.scope,quest);
 const play=legacyDouble<NonNullable<ShardRuntime['play']>>({owned:o.owned,audio:legacyDouble<NonNullable<ShardRuntime['play']>['audio']>({voices:legacyDouble<Audio['voices']>(o.audio.voices)}),cues:legacyDouble<NonNullable<ShardRuntime['play']>['cues']>({cue:()=>false})});
 const product=createShardProduct({slug:'driftwood-isle',revision:1,shardfile:{...emptyShardfile({slug:'driftwood-isle',name:'Driftwood Isle',author:'Fixture',revision:1,seed:1}),rows},sections:new Map([['economy/loot',{rows:{loot:rows.loot}}]]),files:new Map(),read:()=>Promise.reject(new Error('Unexpected loot file read')),check:true});
 const health=legacyDouble<NonNullable<ShardContext['app']['player']>>({attributes:legacyDouble<NonNullable<ShardContext['app']['player']>['attributes']>(o.health.attributes)});
 const ctx=legacyDouble<ShardContext>({scope:o.scope,product,app:legacyDouble<ShardContext['app']>({player:health}),game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<ShardRuntime>({play})})});
 return Promise.resolve(enteredLootPresentation(ctx,LOOT.id,{presentation:view,progression:o.economy.progression,finds:o.economy.finds,marks:o.economy.marks}));
}
