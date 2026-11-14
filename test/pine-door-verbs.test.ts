import { sceneLivingBytes } from '@wildshard/format/worldScenePages';
// @vitest-environment node
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {openFolderSession} from './fixtures/headless/folderSession';
import type {HeadlessTapeObservation} from '../src/shared/host/headlessTape';
import {ForestPageSchema} from '@wildshard/format/forestPage';
import VERBS from '../docs/plans/foundations/verbs/pine-hollow.json' with {type:'json'};

const doorsSchema=v.array(v.object({id:v.string(),open:v.boolean(),t:v.number(),enabled:v.boolean(),handle:v.number()}));
function doors(row:HeadlessTapeObservation|undefined){
  const adapter=row?.adapters[0];if(adapter===undefined)throw new Error('Missing admitted door owner');
  return v.parse(doorsSchema,JSON.parse(adapter.state));
}

test('Pine walks from spawn and opens and closes the actual cabin leaf; remote use does nothing',async()=>{
  const fixture=await openFolderSession('pine-hollow','pine-verbs');
  try{
    const page=v.parse(ForestPageSchema,await fixture.product.json('world/forest-page.json'));
    const profile=page.buildings.variants.find(row=>row.tier==='phone'&&!row.shadow&&!row.shared);
    if(profile===undefined)throw new Error('Missing phone cabin profile');
    const living=sceneLivingBytes(await fixture.product.file(profile.file),profile);
    const target=VERBS.verbs.find(verb=>verb.id==='door')?.at;
    if(target===undefined||target===null)throw new Error('Missing listed door');
    const index=living.life.doors.findIndex(row=>Math.hypot(row.at[0]-target.x,row.at[2]-target.z)<2);
    const declared=living.life.doors[index];if(declared===undefined)throw new Error('Missing actual cabin door');
    const use={kind:'script' as const,actorId:'pine.door',value:index};
    const swing=Math.ceil(page.buildings.life.door.seconds*60)+1;
    const report=await fixture.sim.verbTape({version:1,observe:['pine.doors'],segments:[
      {id:'remote-use',ticks:1,commands:[use]},
      {id:'walk-to-porch',ticks:6000,commands:[],route:[[0,-190],[-8,-150],[-30,-95],[-12,-52],[-1,-40],[-5.71,-31.7],[-7.99,-35.02],[-9.56,-34.66]].map(([x,z])=>{
        if(x===undefined||z===undefined)throw new Error('Missing porch waypoint');return {x,z};
      })},
      {id:'open',ticks:1,commands:[use]},
      {id:'open-complete',ticks:swing,commands:[]},
      {id:'close',ticks:1,commands:[use]},
      {id:'close-complete',ticks:swing,commands:[]},
    ]});
    const [remote,approached,opening,opened,closing,closed]=report.observations.map(row=>doors(row)[index]);
    if(remote===undefined||approached===undefined||opening===undefined||opened===undefined||closing===undefined||closed===undefined)throw new Error('Incomplete door observations');
    expect(remote.id).toBe(declared.id);expect(remote.open).toBe(false);expect(remote.t).toBe(0);
    expect(approached.open).toBe(false);expect(approached.handle).toBe(remote.handle);
    expect(opening.open).toBe(true);expect(opening.t).toBeGreaterThan(0);expect(opening.t).toBeLessThan(1);expect(opening.enabled).toBe(false);
    expect(opened.open).toBe(true);expect(opened.t).toBe(1);expect(opened.enabled).toBe(true);
    expect(closing.open).toBe(false);expect(closing.t).toBeLessThan(1);expect(closing.enabled).toBe(false);
    expect(closed.open).toBe(false);expect(closed.t).toBe(0);expect(closed.enabled).toBe(true);expect(closed.handle).toBe(remote.handle);
    expect(report.observations.every(row=>row.flags.length===0)).toBe(true);
    expect(fixture.sim.quarantined).toBe(false);
  }finally{await fixture.sim.dispose();}
},30_000);
