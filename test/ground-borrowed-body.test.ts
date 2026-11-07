// oxlint-disable-next-line import/no-nodejs-modules -- The proof uses official product and physics bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { builtProduct } from './fixtures/builtProduct';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import type { SimValue } from '@wildshard/engine/sim';
import { snapshotSimHost } from '@wildshard/engine/sim/snapshot';
import { borrowedDecisionControl } from '@wildshard/engine/game/shardfile/borrowedDecisions';
import { outputDescriptor } from '@wildshard/engine/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '@wildshard/engine/host/headlessProduct';
import { createNativeProofResident, prepareProductPlan } from './fixtures/headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const savedControl = v.object({ version:v.literal(1),actor:v.string(),phase:v.number(),fighting:v.boolean(),decision:v.string(),strike:v.unknown() });
const logical = v.object({ decision: v.object({ bindings: v.array(v.object({ failures: v.number() })) }) });
function record(value:SimValue):Record<string,SimValue> {
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Missing continuation record');return value;
}
for (const [slug,kind] of [['driftwood-isle','captain'],['pine-hollow','antler-king']] as const) {
  test(`${kind} uses the same native body through guest phases and restore`, async () => {
    const directory=builtProduct(slug),product=await loadHeadlessProduct(directory),descriptor=outputDescriptor(product.shardfile);
    if(descriptor===undefined)throw new Error('Missing verified product');
    const rapier=await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
    const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
      Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
    const preparation={product,shard:product.shardfile,assets,rapier},resident=await createNativeProofResident(preparation,prepareProductPlan);
    let resumed:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
    try {
      const host=resident.host,spawn=product.shardfile.runtime?.spawns?.bosses.find(row=>row.kind===kind);
      if(spawn===undefined)throw new Error('Missing retained boss row');
      const incoming: number[] = [];
      host.events.answer('damage.modify',request=>{
        if(request?.target!==leadPlayer(host).health)return request;
        if(request.cause?.kind===kind)incoming.push(request.amount);
        return null;
      },host.scope);
      leadPlayer(host).position.set(spawn.at[0]+4,host.groundHeightAt(spawn.at[0],spawn.at[1])+.1,spawn.at[1]);
      if(kind==='captain')host.flags.set('used:altar');else host.dayClock?.setTime('night');
      for(let i=0;i<600;i++)resident.step([]);
      const body=[...host.entities.values()].find(actor=>actor.kind===kind);
      if(body===undefined)throw new Error('Missing existing encounter body');
      const control=borrowedDecisionControl(body),policy=()=>v.parse(savedControl,JSON.parse(v.parse(v.string(),control.snapshot())));
      expect(control.fighting).toBe(true);
      for(const [index,fraction] of [.6,.3].entries()) {
        body.hp=body.maxHp*fraction;
        for(let i=0;i<300;i++)resident.step([]);
        expect(host.entities.get(body.entityId)).toBe(body);
        expect(v.parse(logical,JSON.parse(policy().decision)).decision.bindings[0]?.failures,policy().decision).toBe(0);
        const encounter=host.adapters.get(kind==='captain'?'driftwood.captain':'pine.king')?.snapshot();
        expect(v.parse(v.object({boss:v.object({phase:v.number()})}),JSON.parse(v.parse(v.string(),encounter))).boss.phase).toBe(index+1);
      }
      expect(incoming.length).toBeGreaterThan(0);
      const damage=kind==='captain'?[16,24]:[9,20,24,32];
      expect(incoming.every(amount=>damage.includes(amount)),JSON.stringify(incoming)).toBe(true);
      body.startAttack(1.4);
      const attacking = await createNativeProofResident(preparation, prepareProductPlan, snapshotSimHost(host));
      try {
        expect(attacking.host.entities.get(body.entityId)?.snapshot()).toEqual(body.snapshot());
      } finally { attacking.dispose(); }
      body.stagger(new Vector3(1, 0, 0), 1);
      expect(body.stunned).toBe(true);
      const saved=snapshotSimHost(host),before=control.snapshot();
      resumed=await createNativeProofResident(preparation,prepareProductPlan,saved);
      { const live = resumed; live.host.events.answer('damage.modify',request=>request?.target===leadPlayer(live.host).health?null:request,live.host.scope); }
      const restored=resumed.host.entities.get(body.entityId);if(restored===undefined)throw new Error('Missing restored body');
      expect(borrowedDecisionControl(restored).snapshot()).toBe(before);
      for(let i=0;i<90;i++){
        resident.step([]);resumed.step([]);
        expect(borrowedDecisionControl(restored).snapshot()).toBe(control.snapshot());
      }
      const decode=(wire:unknown)=>{const decoded=v.parse(savedControl,JSON.parse(v.parse(v.string(),wire)));const decision:unknown=JSON.parse(decoded.decision);return {...decoded,decision};};
      expect(decode(borrowedDecisionControl(restored).snapshot())).toEqual(decode(control.snapshot()));
      const legacy=structuredClone(saved),entryState=legacy.entities.find(row=>row.id===body.entityId);
      if(entryState===undefined)throw new Error('Missing old body continuation');
      if(kind==='captain') {
        const island=legacy.adapters.find(row=>row.id==='driftwood.island');if(island===undefined)throw new Error('Missing v8 keeper');
        record(record(island.state)['captain']??null)['policy']=false;
        for(const [oldName,newName] of [['subT','subt'],['poolX','pool-x'],['poolZ','pool-z'],['burstX','burst-x'],['burstZ','burst-z']]) {
          if(oldName===undefined||newName===undefined)throw new Error('Missing old field mapping');
          entryState.state.mem[oldName]=entryState.state.mem[newName]??0;delete entryState.state.mem[newName];
        }
      } else {
        const king=legacy.adapters.find(row=>row.id==='pine.king');if(king===undefined)throw new Error('Missing old King');
        const wire=v.parse(v.record(v.string(),v.unknown()),JSON.parse(v.parse(v.string(),king.state))),fight=v.parse(v.record(v.string(),v.unknown()),wire['fight']);
        delete fight['decision'];wire['fight']=fight;king.state=JSON.stringify(wire);
        for(const name of Object.keys(entryState.state.mem))if(name.startsWith('king.'))delete entryState.state.mem[name];
      }
      const upgraded=await createNativeProofResident(preparation,prepareProductPlan,legacy);
      try {for(let i=0;i<30;i++)upgraded.step([]);
        const actor=upgraded.host.entities.get(body.entityId);if(actor===undefined)throw new Error('Old continuation lost its body');
        const migrated=v.parse(savedControl,JSON.parse(v.parse(v.string(),borrowedDecisionControl(actor).snapshot())));
        expect(migrated.fighting).toBe(true);
        expect(v.parse(logical,JSON.parse(migrated.decision)).decision.bindings[0]?.failures).toBe(0);
      }finally{upgraded.dispose();}
      const outcomes: string[] = [];
      host.events.on('boss.attempt',event=>{outcomes.push(event.outcome);},host.scope);
      body.hp=0;body.alive=false;
      for(let i=0;i<40;i++)resident.step([]);
      expect(outcomes).toEqual(['won']);
    } finally {resumed?.dispose();resident.dispose();}
  },120_000);
}
