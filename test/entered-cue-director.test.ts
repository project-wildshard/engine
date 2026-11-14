import { expect,test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { Game } from '../src/client/engine/core/Game';
import type { ShardContext } from '../src/client/game/plugin/context';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { clientNativeBook } from '../src/client/game/shardfile/clientNativeBook';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

test('entered cue identities stay isolated by product and entered lifetime',()=>{
  const scope=new Scope('cue-entry'),other=new Scope('other-cue-entry');
  const product=(slug:string)=>createShardFolder({slug,revision:1,shardfile:emptyShardfile({slug,name:slug,author:'Wildshard',revision:1,seed:1}),sections:new Map(),files:new Map(),read:()=>Promise.reject(new Error('No asset reads'))});
  const firstFolder=product('first-cue'),secondFolder=product('second-cue');
  const first=legacyDouble<ShardContext>({scope,product:firstFolder}),second=legacyDouble<ShardContext>({scope,product:secondFolder});
  const reentered=legacyDouble<ShardContext>({scope:other,product:firstFolder});
  const rows={version:1,fields:[],rows:[]},game=legacyDouble<Game>({levelScope:scope});
  const a=new CueDirector(game,rows,scope),b=new CueDirector(game,rows,scope);
  try{
    clientNativeBook(first).presentations.set('night',a);clientNativeBook(second).presentations.set('night',b);
    expect(CueDirector.entered(first,'night')).toBe(a);expect(CueDirector.entered(second,'night')).toBe(b);
    expect(CueDirector.entered(first,'missing')).toBeUndefined();expect(CueDirector.entered(reentered,'night')).toBeUndefined();
    scope.dispose();expect(()=>CueDirector.entered(first,'night')).toThrow('living entered scope');
    expect(CueDirector.entered(reentered,'night')).toBeUndefined();
  }finally{scope.dispose();other.dispose();}
});
