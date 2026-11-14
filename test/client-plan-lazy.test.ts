import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import type {ShardContext} from '../src/client/game/plugin/context';
import {CLIENT_FEATURES,installClientPhase} from '../src/client/game/shardfile/clientPlan';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {emptyShardfile} from '../src/shared/host/author';
import * as meadow from '../src/client/game/shardfile/clientMeadow';
import * as scenes from '../src/client/game/shardfile/worldScenes';

function fixture(){
  const root=new Scope('feature.root'),scope=root.child('entered'),resident=new Scope('feature.resident');
  const source=emptyShardfile({slug:'cold-feature',name:'Cold feature',author:'Fixture',revision:1,seed:357});
  const product=createShardFolder({slug:source.identity.slug,revision:1,shardfile:source,sections:new Map(),files:new Map(),read:()=>Promise.reject(new Error('No file expected'))});
  const ctx={scope,product} as ShardContext;
  return {root,scope,resident,ctx};
}
test('unused rows install nothing and ancestor retirement during import prevents installation',async()=>{
  const f=fixture(),install=vi.spyOn(meadow,'installClientMeadow').mockResolvedValue();
  try{
    await installClientPhase(f.ctx,{features:[]},'world',f.resident);
    expect(install).not.toHaveBeenCalled();
    const pending=CLIENT_FEATURES['world.meadow'].install(f.ctx,{kind:'world.meadow',file:'meadow.json'},f.resident);
    f.root.disposeSteps().next();
    await expect(pending).rejects.toThrow('Client feature owner is disposed');
    expect(install).not.toHaveBeenCalled();
  }finally{install.mockRestore();f.root.dispose();f.resident.dispose();}
});
test('loaded features retain phase order, actual owners and one installation per selected row',async()=>{
  const f=fixture(),order:string[]=[];
  const strings=vi.spyOn(CLIENT_FEATURES['strings.register'],'install').mockImplementation(()=>{order.push('strings');});
  const install=vi.spyOn(meadow,'installClientMeadow').mockImplementation(()=>{order.push('meadow');return Promise.resolve();});
  try{
    await installClientPhase(f.ctx,{features:[{kind:'world.meadow',file:'meadow.json'},{kind:'strings.register'}]},'world',f.resident);
    expect(order).toEqual(['strings','meadow']);
    expect(install).toHaveBeenCalledExactlyOnceWith(f.ctx,{kind:'world.meadow',file:'meadow.json'},f.resident);
  }finally{strings.mockRestore();install.mockRestore();f.root.dispose();f.resident.dispose();}
});

for(const change of ['resident','product'] as const){
  test(`${change} replacement during import refuses before feature installation`,async()=>{
    const f=fixture(),other=fixture(),install=vi.spyOn(meadow,'installClientMeadow').mockResolvedValue();
    try{
      const pending=CLIENT_FEATURES['world.meadow'].install(f.ctx,{kind:'world.meadow',file:'meadow.json'},f.resident);
      if(change==='resident')f.resident.disposeSteps().next();
      else Object.defineProperty(f.ctx,'product',{value:other.ctx.product});
      await expect(pending).rejects.toThrow('Client feature owner is disposed');
      expect(install).not.toHaveBeenCalled();
    }finally{install.mockRestore();f.root.dispose();f.resident.dispose();other.root.dispose();other.resident.dispose();}
  });
}

test('a retired original scene owner refuses before the newly loaded constructor runs', async () => {
  const f = fixture(), install = vi.spyOn(scenes, 'installWorldScenes').mockRejectedValue(new Error('Must not install'));
  try {
    const pending = CLIENT_FEATURES['world.scenes'].install(f.ctx, {kind:'world.scenes'}, f.resident);
    f.root.disposeSteps().next();
    await expect(pending).rejects.toThrow('Client feature owner is disposed');
    expect(install).not.toHaveBeenCalled();
  } finally { install.mockRestore(); f.root.dispose(); f.resident.dispose(); }
});
