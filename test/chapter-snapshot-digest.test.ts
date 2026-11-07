// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Read the unchanged native physics binary for exact continuation controls.
import {readFileSync} from 'node:fs';
import {beforeAll,expect,test} from 'vitest';
import {loadRapier,type Rapier} from '../src/shared/engine/physics/rapier';
import {createSimHost} from '../src/server/engine/sim';
import {decodeSimSnapshot,decodeSimSnapshotBytes,serializeSimSnapshot,snapshotSimHostBytes} from '../src/shared/engine/sim/snapshot';
import {chapterSnapshotDigest} from './fixtures/headless/chapterHandoff';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import { leadSnapshot } from '@wildshard/engine/sim/snapshot';

let rapier:Rapier;
beforeAll(async()=>{rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));});

test('chapter digest retains every field and numeric bit for array, bytes and stored wire',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  try{
    host.step();const saved=snapshotSimHostBytes(host);leadSnapshot(saved).yaw=-0;
    const wire=serializeSimSnapshot(saved),array=decodeSimSnapshot(wire),bytes=decodeSimSnapshotBytes(wire);
    expect(Object.is(leadSnapshot(bytes).yaw,-0)).toBe(true);
    const expected=chapterSnapshotDigest(array);
    expect(chapterSnapshotDigest(saved)).toBe(expected);
    expect(chapterSnapshotDigest(bytes)).toBe(expected);
    expect(chapterSnapshotDigest(wire)).toBe(expected);
    leadSnapshot(bytes).yaw=0;expect(chapterSnapshotDigest(bytes)).not.toBe(expected);
    leadSnapshot(bytes).yaw=Number.EPSILON;expect(chapterSnapshotDigest(bytes)).not.toBe(chapterSnapshotDigest({...saved,players:[{...leadSnapshot(saved),yaw:0}]}));
  }finally{host.dispose();}
});

test('independent native physics still affects the digest and input bytes remain owned',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  try{
    host.physics.world.createRigidBody(rapier.RigidBodyDesc.dynamic());
    host.step();const saved=snapshotSimHostBytes(host),original=saved.physics.slice(),expected=chapterSnapshotDigest(saved);
    let moved=0;
    host.physics.world.forEachRigidBody(body=>{const position=body.translation();body.setTranslation({...position,x:position.x+1},true);moved++;});
    expect(moved).toBeGreaterThan(0);
    expect(chapterSnapshotDigest({...saved,physics:host.physics.world.takeSnapshot()})).not.toBe(expected);
    expect(saved.physics).toEqual(original);
    expect(chapterSnapshotDigest(saved)).toBe(expected);
  }finally{host.dispose();}
});

test('wire accounting preserves malformed framing, checksum and unknown-field refusals',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  try{
    host.step();const wire=serializeSimSnapshot(snapshotSimHostBytes(host));
    const corrupt=wire.replace(/"checksum":(\d+)/u,(_match,digits:string)=>`"checksum":${Number(digits)===0?1:0}`);
    expect(corrupt).not.toBe(wire);
    const foreign=wire.replace('"levelId":','"foreign":0,"levelId":');expect(foreign).not.toBe(wire);
    for(const rejected of [wire.slice(0,-1),corrupt,foreign]){
      let expected:unknown;
      try{decodeSimSnapshot(rejected);}catch(error){expected=error;}
      expect(expected).toBeInstanceOf(Error);
      if(!(expected instanceof Error))throw new Error('Original decoder accepted the corrupt control');
      expect(()=>chapterSnapshotDigest(rejected)).toThrow(expected.message);
    }
  }finally{host.dispose();}
});
