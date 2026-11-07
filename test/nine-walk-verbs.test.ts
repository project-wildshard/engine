// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The player verb document supplies the actual route goals.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {openProductSession} from './fixtures/headless/productSession';
import type {HeadlessTapePlan} from '../src/shared/host/headlessTape';

const walkDocs=v.parse(v.object({verbs:v.array(v.object({id:v.string(),
  input:v.object({walkMs:v.optional(v.number())}),
  at:v.nullable(v.object({x:v.number(),z:v.number(),yaw:v.optional(v.number())})),
  expect:v.object({to:v.optional(v.tuple([v.number(),v.number(),v.number()]))}),
}))}),JSON.parse(readFileSync('docs/plans/foundations/verbs/nine-dragon-stack.json','utf8')));

for(const id of ['stairs','street','well-rim'])test(`Nine ${id} follows the listed route on actual capsule collision`,async()=>{
  const verb=walkDocs.verbs.find(row=>row.id===id),goal=verb?.expect.to,ms=verb?.input.walkMs;
  if(verb===undefined||goal===undefined||ms===undefined)throw new Error(`Missing listed Nine route ${id}`);
  const f=await openProductSession('nine-dragon-stack');
  try{
    const spawn=f.product.shardfile.spawn,ticks=Math.round(ms*60/1000);
    let plan:HeadlessTapePlan;
    if(id==='well-rim'){
      const yaw=verb.at?.yaw;if(yaw===undefined)throw new Error('Missing listed well heading');
      const commands=[{kind:'player' as const,moveX:-Math.sin(yaw),moveZ:-Math.cos(yaw),yaw}];
      plan={version:1,observe:[],segments:[{id,ticks,commands},{id:'held-at-rim',ticks:120,commands}]};
    }else plan={version:1,observe:[],segments:[{id,ticks,commands:[],route:[{x:spawn.x,z:spawn.z},{x:goal[0],z:goal[2]}]}]};
    // Observe the actual entered motor before the listed route, without
    // resetting its pose or granting a saved discovery/quest state.
    plan.segments.unshift({id:'entered',ticks:1,commands:[]});
    const report=await f.sim.verbTape(plan),entered=report.observations[0],arrived=report.observations[1],last=report.observations.at(-1);
    if(entered===undefined)throw new Error('Missing actual spawn observation');
    expect(Math.hypot(entered.position[0]-spawn.x,entered.position[2]-spawn.z)).toBeLessThan(.01);
    expect(Math.abs(entered.position[1]-spawn.y)).toBeLessThan(1);
    // The listed place walks have no talk/shop/quest owner or discovery
    // reward in either mode. Check admitted owners and actual native output.
    expect(f.product.shardfile.quests.quests).toEqual([]);
    expect(f.product.shardfile.questNpcs??[]).toEqual([]);
    expect(f.product.shardfile.questHost??null).toBeNull();
    expect(report.observations.every(row=>row.quests.length===0&&row.effects.length===0&&row.flags.length===0)).toBe(true);
    if(arrived===undefined||last===undefined)throw new Error('Missing native route observation');
    expect(Math.hypot(arrived.position[0]-goal[0],arrived.position[2]-goal[2])).toBeLessThan(.8);
    expect(Math.abs(arrived.position[1]-goal[1])).toBeLessThan(1);
    expect(arrived.grounded).toBe(true);expect(f.sim.quarantined).toBe(false);
    if(id==='well-rim')expect(Math.hypot(last.position[0]-arrived.position[0],last.position[2]-arrived.position[2])).toBeLessThan(.1);
    else expect(report.ticks).toBeLessThan(ticks);
  }finally{await f.sim.dispose();}
},30_000);
