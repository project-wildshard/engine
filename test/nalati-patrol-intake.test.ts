// oxlint-disable-next-line import/no-nodejs-modules -- The native comparison uses the unchanged shipped physics bytes.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {snapshotSimHost} from '../src/shared/engine/sim/snapshot';
import {nativePopulationOf} from '../src/server/game/riding/nativePopulation';
import {builtFolder} from './fixtures/builtFolder';
import {createNativeProofResident,prepareFolderPlan as prepareHeadlessRuntime} from './fixtures/headless-native';
import {prepareNalatiWorld} from './fixtures/nalati-world';
import {readPatrolIntake,readPatrolPoses} from '../src/server/game/boss/patrolNative';
import {canonicalSimDigest} from './fake/simState';
import {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import {NativeCreaturePose} from '../src/shared/game/plugin/animation';
import {Vector3} from 'three';
import * as v from 'valibot';
import {TimedEncountersSchema} from '@wildshard/format/encounterRows';

test('admitting conditional patrol recipes preserves the complete page-joined initial population and every RNG draw',async()=>{
  const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);if(descriptor===undefined)throw new Error('Missing admitted native inventory');
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const input=await readPatrolIntake(product,{rows:'combat/timed-encounters.json',actors:'actors/sheep.json'}),original=JSON.stringify(input);
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm')),preparation={shard,assets,rapier,product};
  const before=await createNativeProofResident(preparation,prepareHeadlessRuntime);
  let after:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
  try{
    after=await createNativeProofResident(preparation,context=>prepareNalatiWorld(context,input));
    const originalPopulation=nativePopulationOf(before.host),extended=nativePopulationOf(after.host);
    if(originalPopulation===undefined||extended===undefined)throw new Error('Missing original native population owners');
    expect(canonicalSimDigest(snapshotSimHost(after.host))).toBe(canonicalSimDigest(snapshotSimHost(before.host)));
    expect(after.host.rng.snapshot()).toEqual(before.host.rng.snapshot());
    expect(extended.rng.snapshot()).toEqual(originalPopulation.rng.snapshot());
    expect(extended.available()).toBe(originalPopulation.available());
    for(const row of input.recipes){
      expect(()=>originalPopulation.validateSpawn(row.kind,row.variant)).toThrow('Foreign');
      extended.validateSpawn(row.kind,row.variant);
    }
    // Recipe admission is deliberately inert: no ghost body, identity, guest
    // tick or random draw is paid until the real patrol decides to spawn.
    expect(canonicalSimDigest(snapshotSimHost(after.host))).toBe(canonicalSimDigest(snapshotSimHost(before.host)));
    expect(extended.rng.snapshot()).toEqual(originalPopulation.rng.snapshot());
    expect(JSON.stringify(input)).toBe(original);
    for(let tick=0;tick<60;tick++){
      before.step([]);after.step([]);
      expect(after.host.rng.snapshot()).toEqual(before.host.rng.snapshot());
    }
    expect(canonicalSimDigest(snapshotSimHost(after.host))).toBe(canonicalSimDigest(snapshotSimHost(before.host)));
  }finally{after?.dispose();before.dispose();}
},30_000);

test('patrol contact seats use admitted moving joints and preserve their quiet continuation',async()=>{
  const product=await loadHeadlessFolder(builtFolder('nalati-grasslands'));
  const [intake,poses,encounters]=await Promise.all([readPatrolIntake(product,{rows:'combat/timed-encounters.json',actors:'actors/sheep.json'}),readPatrolPoses(product,{rows:'combat/timed-encounters.json',actors:'actors/sheep.json',looks:'actors/species-looks.json'}),
    product.json<unknown>('combat/timed-encounters.json').then(value=>v.parse(TimedEncountersSchema,value))]);
  expect(poses.rows.map(row=>[row.kind,row.variant])).toEqual(intake.recipes.map(row=>[row.kind,row.variant]));
  const original=JSON.stringify(poses.rows),wind={x:-.8,z:.6,strength:.5};
  for(const row of poses.rows){
    const recipe=intake.recipes.find(candidate=>candidate.kind===row.kind&&candidate.variant===row.variant);
    if(recipe===undefined)throw new Error('Missing actual patrol body recipe');
    const body=new AnimalSim(recipe,101,1,`patrol:${row.variant}`,{heightAt:()=>0,random:()=>.5});
    const pose=new NativeCreaturePose(body,row.pose),atRest=new Vector3(),moving=new Vector3();
    pose.jointPoint(encounters.ride.figure.bone,encounters.ride.seat,atRest);
    // A real actor owns the gait and numerical horse overlays. The contact
    // point changes only after their explicit publication, as on the page.
    body.setMotion(.25,8,2.4);
    for(let tick=1;tick<=60;tick++){
      pose.advance(1/60,tick/60,true);poses.postPose(pose.context,wind);pose.publish();
    }
    pose.jointPoint(encounters.ride.figure.bone,encounters.ride.seat,moving);
    expect(moving.toArray().every(Number.isFinite)).toBe(true);
    expect(moving.equals(atRest)).toBe(false);
    const saved=pose.snapshot(),restoredBody=new AnimalSim(recipe,101,1,body.entityId,{heightAt:()=>0,random:()=>.5});
    restoredBody.restore(body.snapshot());
    const restored=new NativeCreaturePose(restoredBody,row.pose);restored.restore(saved);
    const resumed=new Vector3();restored.jointPoint(encounters.ride.figure.bone,encounters.ride.seat,resumed);
    expect(resumed.toArray()).toEqual(moving.toArray());
    expect(restored.snapshot()).toBe(saved);
    expect(pose.snapshot()).toBe(saved);
    for(let tick=61;tick<=90;tick++){
      for(const current of [pose,restored]){current.advance(1/60,tick/60,true);poses.postPose(current.context,wind);current.publish();}
      expect(restored.snapshot()).toBe(pose.snapshot());
    }
  }
  expect(JSON.stringify(poses.rows)).toBe(original);
});
