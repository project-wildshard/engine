import {expect,test} from 'vitest';
import * as v from 'valibot';
import {runNalatiFieldTaming} from './fixtures/headless/nalati-taming-run';
import {prepareHeadlessRuntime} from './fixtures/nalati-verbs';
import {withNalatiCompanions} from './fixtures/nalati-companions-native';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';

const press=(actorId:string):HeadlessCommand=>({kind:'script',actorId,value:1});
const away:HeadlessCommand={kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,sprint:true,
  steer:{keyX:0,keyY:1,stickX:0,stickY:0}};
const postBondCommands:readonly (readonly HeadlessCommand[])[]=[
  [press('nalati.whistle')],[press('nalati.companion.use')],
  ...Array.from({length:90},()=>[away]),[press('nalati.whistle')],...Array.from({length:240},()=>[]),
];

test('the entry walk earns a living stallion prompt and all five native bucking rounds',async()=>{
  expect(typeof window).toBe('undefined');expect(typeof document).toBe('undefined');
  let verified=false;
  // FAST-SLOW-TESTS FS4: after the real walk the player stands 6 m west of the grazing stallion rather than chasing it
  // for 5,900 ticks; the stallion still shies, and the prompt is still earned by the real approach law. The earned
  // checkpoint falls mid-round 4 (rounds are 210 ticks), so the restored world still rides a round and a half and adopts.
  const report=await runNalatiFieldTaming({prepare:withNalatiCompanions(prepareHeadlessRuntime),postBondCommands,
    approach:{x:-6,z:0},checkpointAt:735,verifyBonded:(first,restored)=>{
    expect(first.phase).toBe('bonded');expect(first.upgraded).toBe(false);
    for(const flag of ['tamed:horse','talked:elder','won:kokpar','quest:tulpar','quest:golden-king','quest:father-wind'])expect(first.flags).not.toContain(flag);
    expect(first.quests.find(quest=>quest.id==='tulpar')).toMatchObject({started:false,complete:false,current:null});
    expect(first.companion).not.toBeNull();expect(first.companions).not.toBeNull();
    const called=v.parse(v.object({lastCalled:v.string(),calledDistance:v.number()}),JSON.parse(first.companions??'null'));
    expect(called.lastCalled).toBe(first.companion?.id);expect(called.calledDistance).toBeGreaterThan(5);
    if(first.companion===null)throw new Error('Missing earned companion');
    const distance=Math.hypot(first.companion.x-first.player.x,first.companion.z-first.player.z);
    expect(distance).toBeLessThan(called.calledDistance);expect(distance).toBeLessThan(4);
    expect(restored).toEqual(first);verified=true;
  }});
  expect(verified).toBe(true);
  expect(report.approachTicks).toBeGreaterThan(0);expect(report.breakingTicks).toBeGreaterThan(0);
  expect(report.checkpointTick).toBeGreaterThan(report.approachTicks);expect(report.rounds).toBe(5);
// The existing native taming/checkpoint proof uses this same finite bound. J112's walk and a second try take CI past 180 s.
},450_000);
