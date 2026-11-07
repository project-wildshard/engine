import * as v from 'valibot';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {HeadlessJourneyPlanSchema} from '../src/shared/host/headlessJourney';
import {beginProductSession,type openProductSession} from './fixtures/headless/productSession';
import {physicsRoutes} from './fixtures/headless/physicsRoutes';
import {ownedSetup} from './fixtures/ownedSetup';

describe('driftwood-isle',{concurrent:false,shuffle:false},()=>{
let session:Awaited<ReturnType<typeof openProductSession>>|undefined;
const setup=ownedSetup(async()=>{
  const start=performance.now(),phase=(name:string):void=>{console.info(JSON.stringify({diagnostic:'native-physics-setup',slug:'driftwood-isle',phase:name,elapsedMs:Math.round(performance.now()-start)}));};
  phase('start');
  const pending=await beginProductSession('driftwood-isle');phase('product-and-worker-started');
  const ready={sim:await pending.ready(),product:pending.product};phase('worker-ready');
  return ready;
},async({sim})=>{
  await sim.dispose();await expect(sim.step()).rejects.toThrow();
});
beforeAll(async()=>{session=await setup.open();});
afterAll(async()=>{await setup.close();});
// The maintained browser ruler runs the legs in order in one living world.
for(const {slug,leg} of physicsRoutes.filter(row=>row.slug==='driftwood-isle'))it(`${leg.name}: completes native physics route without a snag`,async()=>{
  if(session===undefined)throw new Error('Missing native Driftwood physics world');
  const {sim}=session;
  const plan=v.parse(HeadlessJourneyPlanSchema,{ticks:Math.ceil(leg.timeout*60),start:leg.start,once:true,holdActors:true,
    points:[{x:leg.start.x,z:leg.start.z},...leg.waypoints],...(leg.inside===undefined?{}:{inside:leg.inside})});
  const report=await sim.walkLeg(plan),diagnostic=JSON.stringify({slug,leg:leg.name,...report});
  expect(report.stuck,diagnostic).toEqual([]);
  expect(report.out,diagnostic).toBe(0);
  expect(report.complete,diagnostic).toBe(true);
  expect(report.final.position.every(Number.isFinite)).toBe(true);
  expect(sim.quarantined).toBe(false);
},60_000);
});
