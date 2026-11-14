// @vitest-environment node
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {openFolderSession} from './fixtures/headless/folderSession';
import {parseNativeFirearmProfile} from '@wildshard/format/weaponProfiles';
import type {HeadlessTapeObservation} from '../src/shared/host/headlessTape';
import VERBS from '../docs/plans/foundations/verbs/pine-hollow.json' with {type:'json'};

const stateSchema=v.object({loaded:v.boolean(),quiver:v.number(),reloading:v.boolean(),bolts:v.array(v.object({active:v.boolean()}))});
function ammunition(row:HeadlessTapeObservation|undefined){
  const adapter=row?.adapters[0];if(adapter===undefined)throw new Error('Missing native crossbow observation');
  return v.parse(stateSchema,JSON.parse(adapter.state));
}

test('Pine fires once, auto-reloads and exhausts the real crossbow over the listed five-minute session',async()=>{
  const fixture=await openFolderSession('pine-hollow');
  try{
    const source=fixture.product.shardfile,row=source.items.rows.find(item=>item.id==='weapon.crossbow');
    if(row?.kind!=='weapon'||row.ranged===undefined)throw new Error('Missing admitted crossbow owner');
    const profile=parseNativeFirearmProfile(row.profile,'bolt'),policy=row.ranged;
    const minutes=VERBS.verbs.find(verb=>verb.id==='crossbow')?.input.loopMinutes;
    if(minutes===undefined)throw new Error('Missing listed crossbow session');
    const ticks=minutes*60*60,reload=Math.ceil((profile.autoReload+profile.reload)*60)+3,aimed=Math.floor(ticks/2)-2-reload;
    const report=await fixture.sim.verbTape({version:1,observe:[policy.step],segments:[
      {id:'ready',ticks:1,commands:[{kind:'player',moveX:0,moveZ:0,yaw:source.spawn.yaw}]},
      {id:'fire-once',ticks:1,commands:[{kind:'launcher',slot:policy.slot,ads:1,pitch:0,fire:true}]},
      {id:'auto-reload',ticks:reload,commands:[]},
      {id:'aimed-bursts',ticks:aimed,commands:[{kind:'launcher',slot:policy.slot,ads:1,pitch:0,fire:true}]},
      {id:'hip-fire',ticks:ticks/2,commands:[{kind:'launcher',slot:policy.slot,ads:0,pitch:0,fire:true}]},
    ]});
    const [ready,fired,reloaded,aimedOut,hipOut]=report.observations.map(ammunition);
    if(ready===undefined||fired===undefined||reloaded===undefined||aimedOut===undefined||hipOut===undefined)throw new Error('Incomplete native session');
    expect(report.ticks).toBe(ticks);
    expect(ready.quiver).toBe(profile.magazine+profile.reserve);expect(ready.loaded).toBe(true);
    expect(fired.quiver).toBe(ready.quiver-1);expect(fired.loaded).toBe(false);
    expect(fired.bolts.some(bolt=>bolt.active)).toBe(true);
    expect(reloaded.quiver).toBe(fired.quiver);expect(reloaded.loaded).toBe(true);expect(reloaded.reloading).toBe(false);
    for(const state of [aimedOut,hipOut]){
      expect(state.quiver).toBe(0);expect(state.loaded).toBe(false);expect(state.reloading).toBe(false);
      expect(state.bolts).toHaveLength(ready.bolts.length);expect(state.bolts.every(bolt=>!bolt.active)).toBe(true);
    }
    expect(fixture.sim.quarantined).toBe(false);
  }finally{await fixture.sim.dispose();}
},30_000);
